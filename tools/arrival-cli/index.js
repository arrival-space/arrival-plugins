#!/usr/bin/env node
// Arrival.Space CLI — manage your spaces as local files.
//
//   arrival login                 sign in with your browser (OAuth)
//   arrival spaces                list your spaces
//   arrival pull <spaceId>        download a space into ./<spaceId>/
//   arrival validate              server-side dry-run of the current workspace
//   arrival push                  apply the current workspace to the live space
//
// A pulled workspace is a git-friendly repo of files under space/. Edit them with your own
// editor, `arrival validate`, then `arrival push`. See ../arrival-cli phase notes / ARRIVAL_CLI_PLAN.

const fs = require("fs");
const path = require("path");
const { program } = require("commander");
const config = require("./lib/config");
const api = require("./lib/api");
const ws = require("./lib/workspace");
const oauth = require("./lib/oauth");
const pkg = require("./package.json");

// Set exitCode instead of process.exit(): calling process.exit() synchronously after a fetch can
// trip a libuv assertion (UV_HANDLE_CLOSING) on Windows while undici's keep-alive socket is still
// closing. Letting the event loop drain naturally exits cleanly (undici unrefs its idle sockets).
function fail(err) {
    console.error("✗ " + (err && err.message ? err.message : String(err)));
    process.exitCode = 1;
}

function summarizeManifest(m) {
    return `${(m.entities || []).length} entit${(m.entities || []).length === 1 ? "y" : "ies"}, ` +
        `${(m.plugins || []).length} plugin${(m.plugins || []).length === 1 ? "" : "s"}, ` +
        `${(m.assets || []).length} asset${(m.assets || []).length === 1 ? "" : "s"}`;
}

program
    .name("arrival")
    .description("Arrival.Space CLI — manage your spaces as local files")
    .version(pkg.version);

program.command("login")
    .description("Sign in with your browser and store the API token")
    .option("--server <url>", "backend server URL (default: api-live.arrival.space)")
    .action(async (opts) => {
        const cfg = config.load();
        if (opts.server) cfg.server = opts.server;
        const server = config.serverUrl(cfg);
        try {
            const { token, clientId } = await oauth.login(server, cfg.clientId);
            cfg.token = token;
            cfg.clientId = clientId;
            cfg.server = server;
            config.save(cfg);
            console.log(`\n✓ Logged in to ${server}\n  token saved to ${config.CONFIG_FILE}`);
        } catch (e) { fail(e); }
    });

program.command("logout")
    .description("Forget the stored token locally (does NOT revoke it server-side)")
    .action(() => {
        const cfg = config.load();
        delete cfg.token;
        config.save(cfg);
        console.log("✓ Logged out locally. (The API key still exists — manage keys in your account.)");
    });

program.command("spaces")
    .description("List your spaces")
    .option("--search <text>", "filter by title/description")
    .action(async (opts) => {
        const cfg = config.load();
        try {
            const spaces = await api.listSpaces(cfg, { search: opts.search });
            if (!spaces.length) { console.log("(no spaces)"); return; }
            const w = Math.max(...spaces.map((s) => (s.id || "").length), 8);
            for (const s of spaces) {
                console.log(`${(s.id || "").padEnd(w)}  ${s.privacy ? `[${s.privacy}] ` : ""}${s.title || "Untitled"}`);
            }
        } catch (e) { fail(e); }
    });

program.command("pull")
    .description("Download a space into a local workspace")
    .argument("<spaceId>", "space id, e.g. 45637586_1234")
    .option("--dir <path>", "target directory (default: ./<spaceId>)")
    .option("--force", "overwrite a non-empty target directory")
    .action(async (spaceId, opts) => {
        const cfg = config.load();
        const dir = path.resolve(opts.dir || spaceId);
        try {
            if (fs.existsSync(dir) && fs.readdirSync(dir).length && !opts.force) {
                throw new Error(`${dir} exists and is not empty — pass --force to overwrite`);
            }
            const buf = await api.pull(cfg, spaceId);
            const manifest = ws.extractPull(buf, dir);
            console.log(`✓ Pulled ${spaceId} → ${dir}`);
            if (manifest) console.log(`  ${summarizeManifest(manifest)}`);
            console.log(`  layout + how plugins & assets work: ${path.join(dir, "README.md")}`);
            console.log(`  edit files under space/, then \`arrival validate\` / \`arrival push\``);
        } catch (e) {
            fail(e);
            if (/\b404\b|not found/i.test(e.message || "")) {
                console.error(`  (targeting ${config.serverUrl(cfg)} — check the space id looks like "userId_1234", and that you're logged into the right server: \`arrival login --server https://api-dev.arrival.space\`)`);
            }
        }
    });

program.command("status")
    .description("Show what `push` would change since your last pull (added / modified / deleted) — local, no network")
    .option("--dir <path>", "workspace directory (default: current)")
    .action((opts) => {
        const dir = path.resolve(opts.dir || ".");
        try {
            const st = ws.computeStatus(dir);
            const total = st.modified.length + st.added.length + st.deleted.length;
            if (!total) {
                console.log("✓ Clean — nothing to push.");
            } else {
                for (const p of st.modified) console.log(`  ~ ${p}`);
                for (const p of st.added) console.log(`  + ${p}`);
                for (const p of st.deleted) console.log(`  - ${p}`);
                console.log(`\n${total} change${total === 1 ? "" : "s"} — \`arrival validate\` to dry-run, \`arrival push\` to apply.`);
            }
            if (st.dirPlugins.length) {
                console.log(`  note: ${st.dirPlugins.length} multi-file plugin${st.dirPlugins.length === 1 ? "" : "s"} present but not line-diffed here — use git for those.`);
            }
        } catch (e) { fail(e); }
    });

program.command("diff")
    .description("Show line-level changes since your last pull — local, no network")
    .option("--dir <path>", "workspace directory (default: current)")
    .action((opts) => {
        const dir = path.resolve(opts.dir || ".");
        try {
            const st = ws.computeStatus(dir);
            if (!(st.modified.length + st.added.length + st.deleted.length)) { console.log("✓ Clean — nothing to push."); return; }
            let diffLines = null;
            try { ({ diffLines } = require("diff")); } catch { /* dep missing — fall back to headers only */ }
            const c = { red: "\x1b[31m", green: "\x1b[32m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };
            const show = (rel, mark) => {
                console.log(`${c.cyan}${mark} ${rel}${c.reset}`);
                const { base, work, binary } = ws.readForDiff(dir, rel);
                if (binary) { console.log(`  ${c.dim}(binary file)${c.reset}`); return; }
                if (!diffLines) { console.log(`  ${c.dim}(run \`npm install\` for line diffs, or use \`git diff\`)${c.reset}`); return; }
                for (const part of diffLines(base || "", work || "")) {
                    if (!part.added && !part.removed) continue; // skip unchanged context for compactness
                    const col = part.added ? c.green : c.red, sign = part.added ? "+" : "-";
                    for (const line of part.value.replace(/\n$/, "").split("\n")) console.log(`  ${col}${sign} ${line}${c.reset}`);
                }
            };
            for (const rel of st.modified) show(rel, "~");
            for (const rel of st.added) show(rel, "+");
            for (const rel of st.deleted) show(rel, "-");
        } catch (e) { fail(e); }
    });

program.command("validate")
    .description("Server-side dry-run: validate the pending changes without applying")
    .option("--dir <path>", "workspace directory (default: current)")
    .action(async (opts) => {
        const cfg = config.load();
        const dir = path.resolve(opts.dir || ".");
        try {
            const spaceId = ws.readManifest(dir).spaceId;
            const cs = ws.buildChangeset(dir);
            const { status, json } = await api.applyChangeset(cfg, spaceId, { puts: cs.puts, deletes: cs.deletes }, { dryRun: true });
            if (status === 200) { console.log(json.noChanges ? "✓ Valid — no changes to apply." : "✓ Valid."); return; }
            if (status === 422) { printValidationErrors(json); process.exitCode = 1; return; }
            fail(new Error(json.message || `Validate failed (${status})`));
        } catch (e) { fail(e); }
    });

program.command("push")
    .description("Push your changes to the live space — only changed files are sent")
    .option("--dir <path>", "workspace directory (default: current)")
    .option("--force", "confirm deletions")
    .option("--dry-run", "validate only, don't apply")
    .action(async (opts) => {
        const cfg = config.load();
        const dir = path.resolve(opts.dir || ".");
        try {
            const spaceId = ws.readManifest(dir).spaceId;
            const cs = ws.buildChangeset(dir);
            const st = cs.status;
            const total = st.modified.length + st.added.length + st.deleted.length;
            if (!total) { console.log("✓ Nothing to push — workspace matches your last pull."); return; }

            // Deletions are confirmed on the client before they're sent.
            if (st.deleted.length && !opts.force && !opts.dryRun) {
                console.error(`✗ This push would DELETE ${st.deleted.length} file${st.deleted.length === 1 ? "" : "s"}:`);
                for (const p of st.deleted) console.error(`    - ${p}`);
                console.error("  If that's intended, re-run with --force.");
                process.exitCode = 1;
                return;
            }

            const { status, json } = await api.applyChangeset(cfg, spaceId, { puts: cs.puts, deletes: cs.deletes }, { dryRun: opts.dryRun });
            if (status === 200) {
                if (json.dryRun) { console.log("✓ Valid (dry run) — not applied."); return; }
                if (json.noChanges) { console.log("✓ Nothing to push."); return; }
                const applied = json.applied || [];
                console.log(`✓ Pushed ${total} local change${total === 1 ? "" : "s"} → ${applied.length} server op${applied.length === 1 ? "" : "s"}${json.status === "partial" ? " (some writes failed)" : ""}`);
                for (const a of applied) console.log(`  ${String(a.op).replace(/_/g, " ")} ${a.target}`);
                for (const f of (json.failed || [])) console.log(`  ! ${String(f.op).replace(/_/g, " ")} ${f.target}: ${f.error}`);
                ws.commitBase(dir); // the pushed state is the new baseline (status/diff read clean)
                if (json.status === "partial") process.exitCode = 1;
                return;
            }
            if (status === 422) { printValidationErrors(json); process.exitCode = 1; return; }
            if (status === 423) { fail(new Error(json.message || "Space is locked by another session — try again shortly.")); return; }
            fail(new Error(json.message || `Push failed (${status})`));
        } catch (e) { fail(e); }
    });

function printValidationErrors(json) {
    console.error("✗ Validation failed:");
    for (const e of (json.validationErrors || [])) console.error(`  ${e.file}: ${e.message}`);
}

program.parseAsync(process.argv).catch((e) => {
    console.error("✗ " + (e && e.message ? e.message : e));
    process.exitCode = 1;
});
