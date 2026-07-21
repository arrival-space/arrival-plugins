// Local workspace <-> archive helpers for the space-as-code flow.
//
// A pulled workspace looks like:
//   <dir>/space/room.json, entities/*.json, plugins/<name>.mjs|<dir>/, assets/<name>, README.md
//   <dir>/.arrival/manifest.json   (the pull baseline: per-file SHAs the server diffs against)
//
// Edit files under space/ with your own editor + git; `arrival push` zips them back.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const MANIFEST_REL = path.join(".arrival", "manifest.json");

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
        const abs = path.join(destDir, name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, entry.getData());
    }
    if (manifest) writeManifest(destDir, manifest);
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

module.exports = { extractPull, readManifest, writeManifest, buildApplyZip, normalizeToLF, MANIFEST_REL };
