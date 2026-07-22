// Browser OAuth login for the CLI: loopback-redirect Authorization Code + PKCE, reusing the
// Arrival MCP OAuth provider (dynamic client registration + /authorize + /token). The returned
// access_token IS the user's API key.
//
// Flow: start a localhost callback server on an ephemeral port -> (register a public client if we
// don't have a client_id) -> open the browser to /authorize -> the Firebase login page redirects
// back to 127.0.0.1 with a code -> exchange it at /token with the PKCE verifier.

const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

function b64url(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openBrowser(url) {
    try {
        if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    } catch { /* fall back to the printed URL */ }
}

// Register a PUBLIC client (token_endpoint_auth_method: "none"). A confidential registration would
// be issued a client_secret that expires in 30 days, silently breaking future logins.
async function registerClient(server, redirectUri) {
    const res = await fetch(server + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_name: "Arrival CLI",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
            scope: "mcp:tools",
        }),
    });
    if (!res.ok) throw new Error(`Client registration failed (${res.status}): ${await res.text()}`);
    const j = await res.json();
    if (!j.client_id) throw new Error("Registration response had no client_id");
    return j.client_id;
}

function successPage(msg) {
    return `<!doctype html><meta charset=utf-8><title>Arrival CLI</title>` +
        `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#fff;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center">` +
        `<div style="text-align:center"><h2 style="margin:0 0 8px">Arrival.Space</h2><p style="color:#9aa">${msg}</p></div>`;
}

function startCallbackServer(expectedState) {
    return new Promise((resolve) => {
        let resolveCode, rejectCode;
        const waitForCode = new Promise((rc, rj) => { resolveCode = rc; rejectCode = rj; });
        const server = http.createServer((req, res) => {
            const u = new URL(req.url, "http://127.0.0.1");
            if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
            const code = u.searchParams.get("code");
            const state = u.searchParams.get("state");
            const err = u.searchParams.get("error");
            res.writeHead(err || !code ? 400 : 200, { "Content-Type": "text/html" });
            if (err) { res.end(successPage(`Sign-in failed: ${err}`)); rejectCode(new Error(err)); return; }
            if (!code || state !== expectedState) { res.end(successPage("Sign-in failed: bad response")); rejectCode(new Error("bad callback (state mismatch)")); return; }
            res.end(successPage("Signed in — close this tab and return to the terminal."));
            resolveCode(code);
        });
        server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, waitForCode }));
    });
}

// Returns { token, clientId }. Reuses an existing clientId if provided (avoids re-registering).
async function login(server, existingClientId) {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const { server: httpServer, port, waitForCode } = await startCallbackServer(state);
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    try {
        const clientId = existingClientId || (await registerClient(server, redirectUri));

        const authUrl = server + "/authorize?" + new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirectUri,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
            scope: "mcp:tools",
        }).toString();

        console.log("\nOpening your browser to sign in. If it doesn't open, visit:\n  " + authUrl + "\n");
        openBrowser(authUrl);

        const code = await waitForCode;

        const res = await fetch(server + "/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: verifier,
            }).toString(),
        });
        if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
        const j = await res.json();
        if (!j.access_token) throw new Error("Token response had no access_token");
        return { token: j.access_token, clientId };
    } finally {
        httpServer.close();
    }
}

module.exports = { login };
