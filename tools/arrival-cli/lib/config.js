// CLI config: ~/.arrival/config.json — { server, token, clientId }. Written 0600 (it holds the
// API key). The token IS the user's Arrival API key (the OAuth access_token), shared with MCP
// connectors — so `arrival logout` must NOT revoke it server-side, only forget it locally.

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_DIR = path.join(os.homedir(), ".arrival");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const DEFAULT_SERVER = "https://api-live.arrival.space";

function load() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch {
        return {};
    }
}

function save(cfg) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { fs.chmodSync(CONFIG_FILE, 0o600); } catch { /* non-POSIX fs */ }
}

function serverUrl(cfg) {
    return ((cfg && cfg.server) || DEFAULT_SERVER).replace(/\/+$/, "");
}

function requireToken(cfg) {
    if (!cfg || !cfg.token) {
        throw new Error("Not logged in. Run `arrival login` first.");
    }
    return cfg.token;
}

module.exports = { load, save, serverUrl, requireToken, CONFIG_FILE, CONFIG_DIR, DEFAULT_SERVER };
