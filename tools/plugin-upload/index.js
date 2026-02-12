#!/usr/bin/env node

/**
 * Arrival.Space Plugin Upload CLI
 *
 * One-shot tool to upload or update .mjs plugins in a space via the REST API.
 *
 * Login (one-time — opens browser):
 *   node index.js init [--server <url>]
 *
 * Upload a new plugin:
 *   node index.js upload <file.mjs> --space <spaceId>
 *
 * Update an existing plugin entity:
 *   node index.js upload <file.mjs> --space <spaceId> --entity <entityId>
 *
 * List plugins in a space:
 *   node index.js list --space <spaceId>
 *
 * Show stored config:
 *   node index.js config
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { program } = require("commander");

const pkg = require("./package.json");

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(__dirname, ".arrival-api.json");

const DEFAULT_SERVER = "https://user.arrival.space";

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
        return {};
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
};

const log = {
    info: (msg) => console.log(`${c.blue}i${c.reset} ${msg}`),
    ok: (msg) => console.log(`${c.green}+${c.reset} ${msg}`),
    err: (msg) => console.error(`${c.red}x${c.reset} ${msg}`),
    warn: (msg) => console.log(`${c.yellow}!${c.reset} ${msg}`),
    dim: (msg) => console.log(`${c.dim}${msg}${c.reset}`),
};

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiRequest(server, apiKey, method, endpoint, body = null) {
    const url = `${server}/api/v1${endpoint}`;
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const json = await res.json();

    if (!res.ok || json.status === "error") {
        const msg = json.message || json.msg || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}

// ── OAuth PKCE helpers ──────────────────────────────────────────────────────

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function openBrowser(url) {
    const platform = process.platform;
    try {
        if (platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
        else if (platform === "darwin") execSync(`open "${url}"`, { stdio: "ignore" });
        else execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    } catch {
        log.warn("Could not open browser automatically.");
        console.log(`  Open this URL manually:\n  ${c.cyan}${url}${c.reset}\n`);
    }
}

/**
 * Start a temporary local HTTP server to catch the OAuth redirect.
 * Returns a promise that resolves with the auth code.
 */
function waitForOAuthCallback(port) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${port}`);
            if (url.pathname === "/callback") {
                const code = url.searchParams.get("code");
                const error = url.searchParams.get("error");

                res.writeHead(200, { "Content-Type": "text/html" });
                if (code) {
                    res.end("<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Logged in!</h2><p>You can close this tab and return to the terminal.</p></body></html>");
                    resolve(code);
                } else {
                    res.end("<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Login failed</h2><p>" + (error || "Unknown error") + "</p></body></html>");
                    reject(new Error(error || "OAuth callback received no code"));
                }
                setTimeout(() => server.close(), 500);
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        server.listen(port, "127.0.0.1");

        // Timeout after 2 minutes
        setTimeout(() => {
            server.close();
            reject(new Error("Login timed out (2 minutes). Try again."));
        }, 120000);
    });
}

// ── Commands ────────────────────────────────────────────────────────────────

/**
 * init — OAuth login via browser, saves API key automatically
 */
async function cmdInit(opts) {
    const server = opts.server || DEFAULT_SERVER;

    // If --key is provided, just store it directly
    if (opts.key) {
        log.info("Verifying API key...");
        try {
            const res = await fetch(`${server}/api/v1/files`, {
                headers: { Authorization: `Bearer ${opts.key}` },
            });
            if (res.status === 401 || res.status === 403) {
                log.err("Invalid API key.");
                process.exit(1);
            }
        } catch {
            log.warn(`Could not reach ${server} to verify key. Saving anyway.`);
        }
        saveConfig({ server, apiKey: opts.key });
        log.ok("API key saved.");
        return;
    }

    // ── OAuth PKCE flow ─────────────────────────────────────────────────
    const port = 18492 + Math.floor(Math.random() * 100);
    const redirectUri = `http://localhost:${port}/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(8).toString("hex");

    // Step 1: Register dynamic OAuth client (server generates the client_id)
    log.info("Registering OAuth client...");
    const regRes = await fetch(`${server}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_name: "Plugin Upload CLI",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
        }),
    });
    if (!regRes.ok) {
        const text = await regRes.text();
        throw new Error(`Client registration failed (${regRes.status}): ${text.substring(0, 200)}`);
    }
    const regData = await regRes.json();
    const clientId = regData.client_id;

    // Step 2: Start local server + open browser
    const callbackPromise = waitForOAuthCallback(port);

    const authorizeUrl =
        `${server}/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256` +
        `&state=${state}` +
        `&scope=mcp:tools`;

    log.info("Opening browser for login...");
    openBrowser(authorizeUrl);
    log.dim("  Waiting for login (timeout: 2 minutes)...");

    // Step 3: Wait for the redirect with the auth code
    const code = await callbackPromise;

    // Step 4: Exchange code for access token (= API key)
    log.dim("  Exchanging code for API key...");
    const tokenRes = await fetch(`${server}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: codeVerifier,
        }).toString(),
    });

    if (!tokenRes.ok) {
        const text = await tokenRes.text();
        throw new Error(`Token exchange failed (${tokenRes.status}): ${text.substring(0, 200)}`);
    }

    const tokenData = await tokenRes.json();
    const apiKey = tokenData.access_token;

    if (!apiKey) {
        throw new Error("No access_token in token response");
    }

    saveConfig({ server, apiKey });

    log.ok("Logged in and API key saved to .arrival-api.json");
    log.dim(`  Server : ${server}`);
    log.dim(`  Key    : ${apiKey.substring(0, 8)}...`);
}

/**
 * upload — Upload a plugin file and create/update the entity
 */
async function cmdUpload(filePath, opts) {
    const cfg = loadConfig();
    const server = opts.server || cfg.server || DEFAULT_SERVER;
    const apiKey = opts.key || cfg.apiKey;
    const spaceId = opts.space;
    const entityId = opts.entity;

    if (!apiKey) {
        log.err("No API key. Run 'init' first or pass --key.");
        process.exit(1);
    }
    if (!spaceId) {
        log.err("--space is required");
        process.exit(1);
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        log.err(`File not found: ${resolvedPath}`);
        process.exit(1);
    }

    const fileName = path.basename(resolvedPath);
    const fileBuffer = fs.readFileSync(resolvedPath);
    const fileSize = fileBuffer.length;

    log.info(`Uploading ${c.cyan}${fileName}${c.reset} (${(fileSize / 1024).toFixed(1)} KB) to space ${c.cyan}${spaceId}${c.reset}`);

    // ── Step 1: Request presigned upload URL ────────────────────────────
    log.dim("  1/4 Requesting upload URL...");
    const uploadRes = await apiRequest(server, apiKey, "POST", "/files/upload", {
        file_name: fileName,
        file_size: fileSize,
        content_type: "application/javascript",
    });

    const { params } = uploadRes.data;

    // ── Step 2: PUT file bytes to presigned S3 URL ──────────────────────
    log.dim("  2/4 Uploading to S3...");
    const s3Res = await fetch(params.url, {
        method: params.method,
        headers: params.headers,
        body: fileBuffer,
    });
    if (!s3Res.ok) {
        const text = await s3Res.text();
        throw new Error(`S3 upload failed (${s3Res.status}): ${text.substring(0, 200)}`);
    }

    // ── Step 3: Confirm upload → get resource_key ───────────────────────
    log.dim("  3/4 Confirming upload...");
    const fileUrl = params.url.split("?")[0]; // strip presigned query params
    const completeRes = await apiRequest(server, apiKey, "POST", "/files/upload-complete", {
        status: "success",
        extra_info: { file_url: fileUrl },
    });

    let resourceKey;
    if (completeRes.status === "processing") {
        const pollUrl = completeRes.data.poll_url;
        log.info("Server is processing file, polling...");
        resourceKey = await pollJob(server, apiKey, pollUrl);
    } else {
        resourceKey = completeRes.data.resource_key;
    }

    log.dim(`  resource_key: ${resourceKey}`);

    // ── Step 4: Create or update entity ─────────────────────────────────
    // Use the create endpoint for both cases — createOrUpdateEntity in the
    // backend does an upsert, so passing an existing entity_id updates it.
    // This lets the server construct the glbUrl from resource_key properly.
    const action = entityId ? "Updating" : "Creating";
    log.dim(`  4/4 ${action} entity...`);

    const createBody = { resource_key: resourceKey };
    if (entityId) createBody.entity_id = entityId;

    const createRes = await apiRequest(server, apiKey, "POST", `/spaces/${spaceId}/entities`, createBody);
    const verb = entityId ? "updated" : "created";
    log.ok(`Plugin ${verb}: ${c.cyan}${createRes.data.entity_id}${c.reset}`);
    log.dim(`  glbUrl: ${createRes.data.entity_data?.glbUrl}`);
    console.log(`\n  ${c.cyan}https://arrival.space/${spaceId}${c.reset}\n`);
}

/**
 * list — List plugin entities in a space
 */
async function cmdList(opts) {
    const cfg = loadConfig();
    const server = opts.server || cfg.server || DEFAULT_SERVER;
    const apiKey = opts.key || cfg.apiKey;
    const spaceId = opts.space;

    if (!apiKey) {
        log.err("No API key. Run 'init' first or pass --key.");
        process.exit(1);
    }
    if (!spaceId) {
        log.err("--space is required");
        process.exit(1);
    }

    log.info(`Listing entities in space ${c.cyan}${spaceId}${c.reset}...`);

    let cursor = null;
    let allEntities = [];

    do {
        const qs = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : "?limit=200";
        const res = await apiRequest(server, apiKey, "GET", `/spaces/${spaceId}/entities${qs}`);
        allEntities = allEntities.concat(res.data.entities);
        cursor = res.data.hasMore ? res.data.nextCursor : null;
    } while (cursor);

    // Filter to UserModelEntity with .mjs glbUrl (plugins)
    const plugins = allEntities.filter((e) => {
        if (e.entity_type !== "UserModelEntity") return false;
        const url = e.entity_data?.glbUrl || "";
        return url.endsWith(".mjs");
    });

    const others = allEntities.filter((e) => !plugins.includes(e));

    if (plugins.length === 0) {
        log.warn("No plugin entities (.mjs) found in this space.");
    } else {
        console.log(`\n${c.bright}Plugins (${plugins.length}):${c.reset}`);
        for (const p of plugins) {
            const url = p.entity_data?.glbUrl || "";
            const name = url.split("/").pop().split("?")[0];
            console.log(`  ${c.green}*${c.reset} ${c.bright}${p.entity_id}${c.reset}`);
            console.log(`    ${c.dim}file: ${name}${c.reset}`);
            console.log(`    ${c.dim}url:  ${url}${c.reset}`);
        }
    }

    if (others.length > 0) {
        console.log(`\n${c.dim}Other entities (${others.length}):${c.reset}`);
        for (const e of others) {
            console.log(`  ${c.dim}${e.entity_id} (${e.entity_type})${c.reset}`);
        }
    }

    console.log();
}

/**
 * config — Show stored configuration
 */
function cmdConfig() {
    const cfg = loadConfig();
    if (!cfg.apiKey) {
        log.warn("No config found. Run 'init' first.");
        return;
    }
    console.log(`\n${c.bright}Stored config:${c.reset} ${CONFIG_FILE}`);
    console.log(`  Server : ${cfg.server}`);
    console.log(`  API Key: ${cfg.apiKey.substring(0, 8)}...\n`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function pollJob(server, apiKey, pollUrl, maxWaitMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const res = await apiRequest(server, apiKey, "GET", pollUrl.replace("/api/v1", ""));
            if (res.data?.job_status === "completed") {
                return res.data.result.resource_key;
            }
            if (res.data?.job_status === "failed") {
                throw new Error(`Job failed: ${res.data.error || "unknown"}`);
            }
            log.dim(`  polling... ${res.data?.progress || 0}%`);
        } catch (e) {
            if (e.message.includes("not found")) {
                throw new Error("Job disappeared during polling");
            }
        }
    }
    throw new Error("Job timed out");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

program.name("plugin-upload").description("Upload/update Arrival.Space plugins via REST API").version(pkg.version);

program
    .command("init")
    .description("Login via browser and store API key (one-time setup)")
    .option("--key <apiKey>", "Manually provide an API key instead of browser login")
    .option("--server <url>", "Server URL", DEFAULT_SERVER)
    .action(async (opts) => {
        try {
            await cmdInit(opts);
        } catch (e) {
            log.err(e.message);
            process.exit(1);
        }
    });

program
    .command("upload <file>")
    .description("Upload a plugin .mjs file to a space")
    .requiredOption("--space <spaceId>", "Space ID (e.g. 12345678_1234)")
    .option("--entity <entityId>", "Existing entity ID to update (omit to create new)")
    .option("--key <apiKey>", "API key (overrides stored config)")
    .option("--server <url>", "Server URL (overrides stored config)")
    .action(async (file, opts) => {
        try {
            await cmdUpload(file, opts);
        } catch (e) {
            log.err(e.message);
            process.exit(1);
        }
    });

program
    .command("list")
    .description("List plugin entities in a space")
    .requiredOption("--space <spaceId>", "Space ID (e.g. 12345678_1234)")
    .option("--key <apiKey>", "API key (overrides stored config)")
    .option("--server <url>", "Server URL (overrides stored config)")
    .action(async (opts) => {
        try {
            await cmdList(opts);
        } catch (e) {
            log.err(e.message);
            process.exit(1);
        }
    });

program
    .command("config")
    .description("Show stored configuration")
    .action(() => cmdConfig());

program.parse();
