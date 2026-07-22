// Local workspace <-> archive helpers for the space-as-code flow.
//
// A pulled workspace looks like:
//   <dir>/space/room.json, entities/*.json, plugins/<name>.mjs|<dir>/, assets/<name>, README.md
//   <dir>/.arrival/manifest.json   (the pull baseline: per-file SHAs the server diffs against)
//
// Edit files under space/ with your own editor + git; `arrival push` zips them back.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

const MANIFEST_REL = path.join(".arrival", "manifest.json");

// Minimal fallback AGENTS.md, written only when the server didn't bundle one (older backend). The
// full guide + reference/ docs come from the server on pull. Double-quoted lines, backticks literal.
const FALLBACK_AGENTS_MD = [
    "# AGENTS.md — working on this Arrival.Space space",
    "",
    "A checked-out Arrival space. Edit files under `space/`, then `arrival validate` and `arrival push`",
    "(`--force` to confirm deletions). Don't edit `.arrival/`.",
    "",
    "- `space/room.json`, `space/entities/*.json` — the space's entities (`{ id, type, data }`)",
    "- `space/plugins/<name>.mjs` — plugins (ArrivalScript)",
    "- `space/assets/<name>` — files referenced from source/data as the literal `\"assets/<name>\"`",
    "- Large splat / model / image → `arrival upload <file>` → set an entity's `glbUrl`",
    "- `space/README.md` — the map of this space",
    "",
    "Full plugin docs + examples ship under `reference/` when you pull against an updated server;",
    "meanwhile see https://github.com/arrival-space/arrival-plugins .",
    "",
].join("\n");

// Text file types are LF-normalized on push. The server computes byte-exact SHAs over the LF
// bytes materialize wrote; a stray CRLF from a Windows editor / git autocrlf would otherwise make
// every file look "changed" and clobber the whole space. Binary assets are left untouched.
const TEXT_EXT = new Set([
    ".json", ".mjs", ".js", ".ts", ".tsx", ".jsx", ".md", ".txt", ".path",
    ".css", ".html", ".xml", ".yaml", ".yml", ".svg", ".csv",
]);

function normalizeToLF(buf, ext) {
    if (!TEXT_EXT.has(ext)) return buf;
    const s = buf.toString("utf8");
    if (!s.includes("\r")) return buf;
    return Buffer.from(s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}

// Extract a pull archive into destDir: space/** + .materialize-manifest.json, plus AGENTS.md /
// CLAUDE.md / reference/** when the server bundled agent docs. space/ is mirrored into the
// .arrival/base baseline that status/diff compare against; the agent context is read-only. Returns
// the manifest.
function extractPull(zipBuffer, destDir) {
    const zip = new AdmZip(zipBuffer);
    fs.mkdirSync(destDir, { recursive: true });
    let manifest = null;
    let gotAgentsMd = false;
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/\\/g, "/").replace(/^\/+/, "");
        if (name.includes("..") || path.isAbsolute(name)) continue;
        if (name === ".materialize-manifest.json") {
            manifest = JSON.parse(entry.getData().toString("utf8"));
            continue;
        }
        // space/** is the editable space (mirrored into .arrival/base); AGENTS.md/CLAUDE.md/reference/**
        // are read-only agent context. Ignore anything else.
        const isSpace = name.startsWith("space/");
        const isContext = name === "AGENTS.md" || name === "CLAUDE.md" || name.startsWith("reference/");
        if (!isSpace && !isContext) continue;
        const data = entry.getData();
        const abs = path.join(destDir, name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, data);
        if (isSpace) {
            // Mirror into .arrival/base/ — the pristine "index" that status/diff/push diff against.
            const baseAbs = path.join(destDir, ".arrival", "base", name);
            fs.mkdirSync(path.dirname(baseAbs), { recursive: true });
            fs.writeFileSync(baseAbs, data);
        }
        if (name === "AGENTS.md") gotAgentsMd = true;
    }
    if (manifest) writeManifest(destDir, manifest);
    // Skeleton dirs so an empty space still shows where plugins/assets go (empty dirs don't survive
    // the zip). If the server didn't bundle an AGENTS.md (older backend), write a minimal fallback.
    // Both live at the workspace root — outside space/, so never pushed back.
    for (const d of ["entities", "plugins", "assets"]) fs.mkdirSync(path.join(destDir, "space", d), { recursive: true });
    if (!gotAgentsMd) fs.writeFileSync(path.join(destDir, "AGENTS.md"), FALLBACK_AGENTS_MD);
    return manifest;
}

function readManifest(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_REL), "utf8"));
    } catch {
        throw new Error(`not an arrival workspace (no ${MANIFEST_REL}) — run \`arrival pull <spaceId>\` first`);
    }
}

function writeManifest(dir, manifest) {
    fs.mkdirSync(path.join(dir, ".arrival"), { recursive: true });
    fs.writeFileSync(path.join(dir, MANIFEST_REL), JSON.stringify(manifest, null, 2));
}

// Build the apply archive from a workspace dir: space/** (text LF-normalized) + the baseline
// manifest as .materialize-manifest.json at the root.
function buildApplyZip(dir) {
    const spaceDir = path.join(dir, "space");
    if (!fs.existsSync(spaceDir)) {
        throw new Error("no space/ directory here — run this inside an `arrival pull` workspace (or pass --dir)");
    }
    const zip = new AdmZip();
    const walk = (absDir, rel) => {
        for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
            const abs = path.join(absDir, e.name);
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(abs, r);
            else if (e.isFile()) {
                const data = normalizeToLF(fs.readFileSync(abs), path.extname(e.name).toLowerCase());
                zip.addFile(`space/${r}`, data);
            }
        }
    };
    walk(spaceDir, "");
    zip.addFile(".materialize-manifest.json", Buffer.from(JSON.stringify(readManifest(dir)), "utf8"));
    return zip.toBuffer();
}

// List files recursively under a dir as posix-relative paths.
function listFilesRec(root) {
    const out = [];
    const walk = (absDir) => {
        let ents;
        try { ents = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            const abs = path.join(absDir, e.name);
            if (e.isDirectory()) walk(abs);
            else if (e.isFile()) out.push(path.relative(root, abs).replace(/\\/g, "/"));
        }
    };
    walk(root);
    return out;
}

// What `push` would change: the working space/ tree vs the pristine .arrival/base/space mirror
// captured at pull. Byte-exact after LF-normalization (matching what push sends), precise for every
// file — including files inside multi-file plugin directories. Falls back to a manifest-sha compare
// for workspaces pulled before baselines existed (re-pull for full precision + `diff`).
function computeStatus(dir) {
    const baseSpace = path.join(dir, ".arrival", "base", "space");
    const workSpace = path.join(dir, "space");
    if (!fs.existsSync(baseSpace)) return computeStatusFromManifest(dir);

    const baseFiles = new Set(listFilesRec(baseSpace));
    const workFiles = new Set(listFilesRec(workSpace));
    const read = (rootAbs, rel) => normalizeToLF(fs.readFileSync(path.join(rootAbs, rel)), path.extname(rel).toLowerCase());

    const modified = [], added = [], deleted = [];
    for (const rel of workFiles) {
        if (!baseFiles.has(rel)) { added.push("space/" + rel); continue; }
        if (!read(workSpace, rel).equals(read(baseSpace, rel))) modified.push("space/" + rel);
    }
    for (const rel of baseFiles) if (!workFiles.has(rel)) deleted.push("space/" + rel);

    modified.sort(); added.sort(); deleted.sort();
    return { modified, added, deleted, dirPlugins: [] };
}

// Base + working content of a text file for `diff`. Binary files → { binary: true }.
function readForDiff(dir, rel) {
    const ext = path.extname(rel).toLowerCase();
    if (!TEXT_EXT.has(ext)) return { binary: true };
    const read = (p) => { try { return normalizeToLF(fs.readFileSync(p), ext).toString("utf8"); } catch { return null; } };
    return { base: read(path.join(dir, ".arrival", "base", rel)), work: read(path.join(dir, rel)) };
}

// Legacy fallback: compare working files to the baseline manifest's per-file SHAs (no base mirror).
// Precise for flat files; multi-file plugins are surfaced but not diffed.
function computeStatusFromManifest(dir) {
    const manifest = readManifest(dir);
    const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
    const norm = (rel) => String(rel).replace(/\\/g, "/");

    const entries = [
        ...(manifest.entities || []),
        ...(manifest.plugins || []),
        ...(manifest.assets || []),
    ].filter((e) => e && e.file);
    const tracked = new Set(entries.map((e) => norm(e.file)));
    const dirPluginDirs = (manifest.plugins || []).filter((p) => p && p.isDir && p.file).map((p) => norm(p.file));

    const modified = [], deleted = [], added = [], dirPlugins = [];
    for (const e of entries) {
        const rel = norm(e.file);
        const abs = path.join(dir, e.file);
        if (e.isDir) {
            if (!fs.existsSync(abs)) deleted.push(rel);
            else dirPlugins.push(rel);
            continue;
        }
        let buf;
        try { buf = fs.readFileSync(abs); } catch { deleted.push(rel); continue; }
        if (sha(normalizeToLF(buf, path.extname(rel).toLowerCase())) !== e.sha) modified.push(rel);
    }

    const spaceDir = path.join(dir, "space");
    const walk = (absDir) => {
        let ents;
        try { ents = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const de of ents) {
            const abs = path.join(absDir, de.name);
            const rel = norm(path.relative(dir, abs));
            if (de.isDirectory()) { walk(abs); continue; }
            if (!de.isFile()) continue;
            if (tracked.has(rel)) continue;
            if (rel === "space/README.md" || rel === "space/logs.md") continue;      // server-generated
            if (dirPluginDirs.some((dp) => rel.startsWith(dp + "/"))) continue;      // inside a tracked dir plugin
            added.push(rel);
        }
    };
    if (fs.existsSync(spaceDir)) walk(spaceDir);

    modified.sort(); added.sort(); deleted.sort();
    return { modified, added, deleted, dirPlugins };
}

// Build a per-file changeset from the workspace: puts (modified + added; text LF-normalized,
// binary base64) + explicit deletes. Reuses computeStatus, so it's precise for every file
// (including files inside multi-file plugin directories).
function buildChangeset(dir) {
    const st = computeStatus(dir);
    const puts = [];
    for (const rel of [...st.modified, ...st.added]) {
        const ext = path.extname(rel).toLowerCase();
        const raw = fs.readFileSync(path.join(dir, rel));
        if (TEXT_EXT.has(ext)) puts.push({ path: rel, content: normalizeToLF(raw, ext).toString("utf8") });
        else puts.push({ path: rel, encoding: "base64", content: raw.toString("base64") });
    }
    return { puts, deletes: st.deleted, status: st };
}

// After a successful push the working tree IS the new server state — refresh the .arrival/base
// mirror so status/diff read clean again. (A re-pull re-syncs anything the server normalized.)
function commitBase(dir) {
    const baseSpace = path.join(dir, ".arrival", "base", "space");
    const workSpace = path.join(dir, "space");
    fs.rmSync(baseSpace, { recursive: true, force: true });
    const copy = (src, dst) => {
        fs.mkdirSync(dst, { recursive: true });
        for (const e of fs.readdirSync(src, { withFileTypes: true })) {
            const s = path.join(src, e.name), d = path.join(dst, e.name);
            if (e.isDirectory()) copy(s, d);
            else if (e.isFile()) fs.copyFileSync(s, d);
        }
    };
    if (fs.existsSync(workSpace)) copy(workSpace, baseSpace);
}

module.exports = { extractPull, readManifest, writeManifest, buildApplyZip, computeStatus, readForDiff, buildChangeset, commitBase, normalizeToLF, MANIFEST_REL };
