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

function fail(err) {
    console.error("✗ " + (err && err.message ? err.message : String(err)));
    process.exit(1);
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
            console.log(`  edit files under space/, then \`arrival push\` (run from ${dir === process.cwd() ? "here" : dir})`);
        } catch (e) { fail(e); }
    });

program.command("validate")
    .description("Server-side dry-run: validate the current workspace without applying")
    .option("--dir <path>", "workspace directory (default: current)")
    .action(async (opts) => {
        const cfg = config.load();
        const dir = path.resolve(opts.dir || ".");
        try {
            const spaceId = ws.readManifest(dir).spaceId;
            const zip = ws.buildApplyZip(dir);
            const { status, json } = await api.apply(cfg, spaceId, zip, { dryRun: true });
            if (status === 200) { console.log(json.noChanges ? "✓ Valid — no changes to apply." : "✓ Valid."); return; }
            if (status === 422) { printValidationErrors(json); process.exit(1); }
            fail(new Error(json.message || `Validate failed (${status})`));
        } catch (e) { fail(e); }
    });

program.command("push")
    .description("Apply the current workspace to the live space")
    .option("--dir <path>", "workspace directory (default: current)")
    .option("--force", "confirm deletions / take last-writer-wins")
    .option("--dry-run", "validate only, don't apply")
    .action(async (opts) => {
        const cfg = config.load();
        const dir = path.resolve(opts.dir || ".");
        try {
            const spaceId = ws.readManifest(dir).spaceId;
            const zip = ws.buildApplyZip(dir);
            const { status, json } = await api.apply(cfg, spaceId, zip, { dryRun: opts.dryRun, force: opts.force });

            if (status === 200) {
                if (json.noChanges) { console.log("✓ Nothing to push — workspace matches the live space."); return; }
                if (json.dryRun) { console.log("✓ Valid (dry run) — not applied."); return; }
                const applied = json.applied || [];
                console.log(`✓ Pushed — ${applied.length} change${applied.length === 1 ? "" : "s"}${json.status === "partial" ? " (some writes failed)" : ""}`);
                for (const a of applied) console.log(`  ${String(a.op).replace(/_/g, " ")} ${a.target}`);
                for (const f of (json.failed || [])) console.log(`  ! ${String(f.op).replace(/_/g, " ")} ${f.target}: ${f.error}`);
                if (json.manifest) ws.writeManifest(dir, json.manifest); // persist the advanced baseline
                if (json.status === "partial") process.exit(1);
                return;
            }
            if (status === 422) { printValidationErrors(json); process.exit(1); }
            if (status === 409) {
                console.error(`✗ This push would DELETE ${(json.plannedDeletes || []).length} entit${(json.plannedDeletes || []).length === 1 ? "y" : "ies"}:`);
                for (const id of (json.plannedDeletes || [])) console.error(`    - ${id}`);
                console.error("  If that's intended, re-run with --force.");
                process.exit(1);
            }
            if (status === 423) { fail(new Error(json.message || "Space is locked by another session — try again shortly.")); }
            fail(new Error(json.message || `Push failed (${status})`));
        } catch (e) { fail(e); }
    });

function printValidationErrors(json) {
    console.error("✗ Validation failed:");
    for (const e of (json.validationErrors || [])) console.error(`  ${e.file}: ${e.message}`);
}

program.parseAsync(process.argv);
