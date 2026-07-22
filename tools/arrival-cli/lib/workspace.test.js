const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const ws = require("./workspace");

function tmp() {
    const d = path.join(os.tmpdir(), `arrival-ws-${crypto.randomUUID()}`);
    fs.mkdirSync(d, { recursive: true });
    return d;
}

test("extractPull writes space/ + baseline manifest; buildApplyZip round-trips", () => {
    const src = new AdmZip();
    src.addFile("space/room.json", Buffer.from('{"id":"RoomInfo"}'));
    src.addFile("space/entities/e1.json", Buffer.from('{"id":"e1"}'));
    src.addFile(".materialize-manifest.json", Buffer.from(JSON.stringify({ spaceId: "1_0001", entities: [{ id: "RoomInfo" }], plugins: [], assets: [] })));

    const dir = tmp();
    const manifest = ws.extractPull(src.toBuffer(), dir);
    assert.equal(manifest.spaceId, "1_0001");
    assert.ok(fs.existsSync(path.join(dir, "space", "room.json")));
    assert.ok(fs.existsSync(path.join(dir, ".arrival", "manifest.json")), "baseline manifest stored");

    const zip = new AdmZip(ws.buildApplyZip(dir));
    const names = zip.getEntries().map((e) => e.entryName).sort();
    assert.deepEqual(names, [".materialize-manifest.json", "space/entities/e1.json", "space/room.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("buildApplyZip normalizes CRLF to LF in text files (SHA-stability)", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "space"), { recursive: true });
    fs.writeFileSync(path.join(dir, "space", "room.json"), '{\r\n  "id": "RoomInfo"\r\n}');
    ws.writeManifest(dir, { spaceId: "x", entities: [], plugins: [], assets: [] });
    const zip = new AdmZip(ws.buildApplyZip(dir));
    const data = zip.getEntry("space/room.json").getData().toString("utf8");
    assert.ok(!data.includes("\r"), "CRLF normalized to LF before zipping");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("extractPull always creates assets/plugins skeleton + a workspace README (not pushed)", () => {
    const src = new AdmZip();
    src.addFile("space/room.json", Buffer.from('{"id":"RoomInfo"}'));
    src.addFile(".materialize-manifest.json", Buffer.from(JSON.stringify({ spaceId: "1_0001", entities: [], plugins: [], assets: [] })));
    const dir = tmp();
    ws.extractPull(src.toBuffer(), dir);
    assert.ok(fs.existsSync(path.join(dir, "space", "assets")), "space/assets/ created even with no assets");
    assert.ok(fs.existsSync(path.join(dir, "space", "plugins")), "space/plugins/ created");
    assert.ok(fs.existsSync(path.join(dir, "README.md")), "workspace README written");
    // the README is at the workspace root (outside space/) — it must never end up in the apply zip
    const zip = new AdmZip(ws.buildApplyZip(dir));
    assert.ok(!zip.getEntries().some((e) => e.entryName.replace(/\\/g, "/") === "README.md"), "workspace README is not pushed");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("computeStatus reports modified / added / deleted vs the baseline manifest", () => {
    const sha = (s) => crypto.createHash("sha256").update(Buffer.from(s)).digest("hex");
    const room = '{"id":"RoomInfo"}';
    const e1 = '{"id":"e1"}';
    const src = new AdmZip();
    src.addFile("space/room.json", Buffer.from(room));
    src.addFile("space/entities/e1.json", Buffer.from(e1));
    src.addFile(".materialize-manifest.json", Buffer.from(JSON.stringify({
        spaceId: "1_0001",
        entities: [
            { id: "RoomInfo", type: "RoomInfo", file: "space/room.json", sha: sha(room) },
            { id: "e1", type: "Simple", file: "space/entities/e1.json", sha: sha(e1) },
        ],
        plugins: [], assets: [],
    })));
    const dir = tmp();
    ws.extractPull(src.toBuffer(), dir);

    // clean right after pull (the generated README/skeleton dirs must not register as changes)
    let st = ws.computeStatus(dir);
    assert.deepEqual([st.modified, st.added, st.deleted], [[], [], []], "clean after pull");

    // modify e1, add e2, delete room.json
    fs.writeFileSync(path.join(dir, "space", "entities", "e1.json"), '{"id":"e1","x":1}');
    fs.writeFileSync(path.join(dir, "space", "entities", "e2.json"), '{"id":"e2"}');
    fs.rmSync(path.join(dir, "space", "room.json"));
    st = ws.computeStatus(dir);
    assert.deepEqual(st.modified, ["space/entities/e1.json"]);
    assert.deepEqual(st.added, ["space/entities/e2.json"]);
    assert.deepEqual(st.deleted, ["space/room.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("extractPull stores a .arrival/base mirror; readForDiff returns base vs work", () => {
    const src = new AdmZip();
    src.addFile("space/entities/e1.json", Buffer.from('{"a":1}'));
    src.addFile(".materialize-manifest.json", Buffer.from(JSON.stringify({ spaceId: "x", entities: [], plugins: [], assets: [] })));
    const dir = tmp();
    ws.extractPull(src.toBuffer(), dir);
    assert.ok(fs.existsSync(path.join(dir, ".arrival", "base", "space", "entities", "e1.json")), "base mirror written");

    fs.writeFileSync(path.join(dir, "space", "entities", "e1.json"), '{"a":2}');
    const d = ws.readForDiff(dir, "space/entities/e1.json");
    assert.equal(d.base, '{"a":1}');
    assert.equal(d.work, '{"a":2}');
    // status uses the base mirror → e1 is modified
    assert.deepEqual(ws.computeStatus(dir).modified, ["space/entities/e1.json"]);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("normalizeToLF leaves binary extensions untouched", () => {
    const buf = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
    assert.equal(ws.normalizeToLF(buf, ".glb"), buf);
});
