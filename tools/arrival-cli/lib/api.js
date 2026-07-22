// Thin HTTP client for the Arrival REST API (Node 18+ global fetch). Bearer = the stored token.

const fs = require("fs");
const path = require("path");
const config = require("./config");

function mimeFromExt(ext) {
    const map = {
        ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
        ".ply": "application/octet-stream", ".spz": "application/octet-stream", ".sog": "application/octet-stream",
        ".lcc": "application/octet-stream", ".lcc2": "application/octet-stream",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
        ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
        ".zip": "application/zip", ".json": "application/json", ".mjs": "application/javascript",
    };
    return map[ext] || "application/octet-stream";
}

async function request(cfg, method, apiPath, { body, headers, raw } = {}) {
    const url = config.serverUrl(cfg) + apiPath;
    const token = config.requireToken(cfg);
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(headers || {}) },
        body,
    });
    if (raw) return { res, buffer: Buffer.from(await res.arrayBuffer()) };
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { res, json };
}

async function listSpaces(cfg, { limit = 100, search } = {}) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (search) qs.set("search", search);
    const { res, json } = await request(cfg, "GET", `/api/v1/spaces?${qs.toString()}`);
    if (!res.ok) throw new Error((json && json.message) || `Listing spaces failed (${res.status})`);
    // Tolerate wrapper shape variations: { data: { spaces } } | { data: [...] } | { spaces }.
    return (json && json.data && json.data.spaces) || (json && json.spaces) || (json && Array.isArray(json.data) ? json.data : []) || [];
}

async function pull(cfg, spaceId) {
    const { res, buffer } = await request(cfg, "POST", `/api/v1/spaces/${encodeURIComponent(spaceId)}/pull`, { raw: true });
    if (!res.ok) {
        let msg = `Pull failed (${res.status})`;
        try { msg = JSON.parse(buffer.toString("utf8")).message || msg; } catch { /* keep default */ }
        throw new Error(msg);
    }
    return buffer;
}

async function apply(cfg, spaceId, zipBuffer, { dryRun, force } = {}) {
    const qs = [];
    if (dryRun) qs.push("dryRun=1");
    if (force) qs.push("force=1");
    const apiPath = `/api/v1/spaces/${encodeURIComponent(spaceId)}/apply${qs.length ? "?" + qs.join("&") : ""}`;
    const { res, json } = await request(cfg, "POST", apiPath, {
        body: zipBuffer,
        headers: { "Content-Type": "application/zip" },
    });
    return { status: res.status, json: json || {} };
}

// Per-file changeset apply. Sent as application/octet-stream so the backend's global JSON parser
// (100 kb limit) doesn't claim it — the server collects the raw body and parses it.
async function applyChangeset(cfg, spaceId, changeset, { dryRun } = {}) {
    const apiPath = `/api/v1/spaces/${encodeURIComponent(spaceId)}/changeset${dryRun ? "?dryRun=1" : ""}`;
    const { res, json } = await request(cfg, "POST", apiPath, {
        body: Buffer.from(JSON.stringify(changeset), "utf8"),
        headers: { "Content-Type": "application/octet-stream" },
    });
    return { status: res.status, json: json || {} };
}

// Upload a file to the CDN via the presigned flow: the bytes go client -> S3 directly (they
// never pass through user-server). Returns { url, resource_key }. Reuses /files/upload +
// /files/upload-complete (the same flow the editor and MCP use), so no server changes to the
// space pipeline. Handles the async job path (zip/transform) by polling.
async function uploadFile(cfg, filePath) {
    const name = path.basename(filePath);
    const buf = fs.readFileSync(filePath);
    const contentType = mimeFromExt(path.extname(name).toLowerCase());

    const step1 = await request(cfg, "POST", "/api/v1/files/upload", {
        body: JSON.stringify({ file_name: name, file_size: buf.length, content_type: contentType }),
        headers: { "Content-Type": "application/json" },
    });
    if (!step1.res.ok || !step1.json || step1.json.status !== "ok") {
        throw new Error((step1.json && step1.json.message) || `Presign failed (${step1.res.status})`);
    }
    const params = step1.json.data.params;

    // PUT straight to S3 — no Authorization header (the presigned URL carries its own auth).
    const put = await fetch(params.url, { method: params.method || "PUT", headers: params.headers || {}, body: buf });
    if (!put.ok) throw new Error(`Direct-to-S3 upload failed (${put.status})`);
    const fileUrl = params.url.split("?")[0];

    const done = await request(cfg, "POST", "/api/v1/files/upload-complete", {
        body: JSON.stringify({ status: "success", extra_info: { file_url: fileUrl } }),
        headers: { "Content-Type": "application/json" },
    });
    if (done.res.status === 200 && done.json && done.json.status === "confirmed") {
        return { url: done.json.data.url || null, resource_key: done.json.data.resource_key };
    }
    if (done.res.status === 202 && done.json && done.json.data && done.json.data.job_id) {
        const jobId = done.json.data.job_id;
        for (let i = 0; i < 150; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const poll = await request(cfg, "GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
            const jd = (poll.json && poll.json.data) || poll.json || {};
            if (jd.job_status === "completed") return { url: (jd.result && jd.result.url) || null, resource_key: jd.result && jd.result.resource_key };
            if (jd.job_status === "failed") throw new Error(jd.error || jd.message || "Upload processing failed");
        }
        throw new Error("Upload processing timed out");
    }
    throw new Error((done.json && done.json.message) || `Upload finalize failed (${done.res.status})`);
}

module.exports = { listSpaces, pull, apply, applyChangeset, uploadFile };
