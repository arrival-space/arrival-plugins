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

// Written to the workspace ROOT on pull (outside space/, so it's never pushed or mistaken for an
// asset). Makes the layout + the assets token scheme discoverable even for a space that has no
// plugins/assets yet — empty dirs don't survive the pull zip, so without this there's nothing to
// see. Backticks are literal here (double-quoted lines), no escaping needed.
const WORKSPACE_README = [
    "# Arrival space workspace",
    "",
    "This folder is an Arrival.Space space checked out as files. Edit anything under `space/`,",
    "then run `arrival validate` and `arrival push`. This README and `.arrival/` are generated —",
    "don't edit them.",
    "",
    "## Layout",
    "",
    "- `space/room.json`       — the space itself (title, privacy, …)",
    "- `space/entities/*.json` — one file per entity in the space",
    "- `space/plugins/`        — plugin code: `<name>.mjs` (ArrivalScript), or a folder `<name>/`",
    "                            with an `index.mjs` for a multi-file plugin",
    "- `space/assets/`         — images / models / audio that a plugin or entity uses",
    "",
    "## Assets (textures, models, audio)",
    "",
    "Drop a file in `space/assets/` with a flat name, e.g. `space/assets/wood.webp`. Reference it",
    'as the **literal string** "assets/wood.webp" in plugin source or in an entity\'s data (e.g. a',
    "param). On `arrival push` the file is uploaded to the CDN and every \"assets/<name>\" reference",
    "is replaced with the real URL automatically.",
    "",
    "- Prefer `.webp` (smallest download); `.png` / `.jpg` / `.glb` / … also work. Max 25 MB each.",
    "- Only real asset files belong in `space/assets/` — a `.md` / `.gitkeep` / etc. there will fail",
    "  validation. Plugin code goes in `space/plugins/`, not here.",
    "",
    "## Commands",
    "",
    "- `arrival validate` — server-side dry-run (catch problems before applying)",
    "- `arrival push`     — apply your edits to the live space (`--force` to confirm deletions)",
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

// Extract a pull archive (space/** + .materialize-manifest.json) into destDir; store the manifest
// as the .arrival/manifest.json baseline. Returns the manifest.
function extractPull(zipBuffer, destDir) {
    const zip = new AdmZip(zipBuffer);
    fs.mkdirSync(destDir, { recursive: true });
    let manifest = null;
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/\\/g, "/").replace(/^\/+/, "");
        if (name.includes("..") || path.isAbsolute(name)) continue;
        if (name === ".materialize-manifest.json") {
            manifest = JSON.parse(entry.getData().toString("utf8"));
            continue;
        }
        if (!name.startsWith("space/")) continue;
        const data = entry.getData();
        const abs = path.join(destDir, name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, data);
        // Mirror into .arrival/base/ — the pristine "index" that `status`/`diff` compare the
        // working tree against (and the source of per-file deltas for a future changeset push).
        const baseAbs = path.join(destDir, ".arrival", "base", name);
        fs.mkdirSync(path.dirname(baseAbs), { recursive: true });
        fs.writeFileSync(baseAbs, data);
    }
    if (manifest) writeManifest(destDir, manifest);
    // Always present the standard skeleton dirs + a guide, even for a space with no plugins/assets
    // yet (empty dirs don't survive the pull zip). The README is at the workspace root, OUTSIDE
    // space/, so it is never zipped back on push.
    for (const d of ["entities", "plugins", "assets"]) fs.mkdirSync(path.join(destDir, "space", d), { recursive: true });
    fs.writeFileSync(path.join(destDir, "README.md"), WORKSPACE_README);
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
