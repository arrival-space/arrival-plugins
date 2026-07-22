// Thin HTTP client for the Arrival REST API (Node 18+ global fetch). Bearer = the stored token.

const config = require("./config");

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

module.exports = { listSpaces, pull, apply, applyChangeset };
