const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const api = require("./api");

const CFG = { server: "https://api-test.arrival.space", token: "tok" };
const realFetch = globalThis.fetch;

// Stub fetch and record what the CLI sent. Returns the calls array.
function stubFetch(reply) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        const { status = 201, body = {} } = typeof reply === "function" ? reply(url, init) : reply;
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
    return calls;
}

afterEach(() => { globalThis.fetch = realFetch; });

test("createSpace posts title/description/privacy/space_type and returns the new id", async () => {
    const calls = stubFetch({ status: 201, body: { status: "ok", data: { spaceId: "45637586_1234", roomId: "custom.travel.center.45637586_1234", title: "Photo wall" } } });

    const out = await api.createSpace(CFG, { title: "Photo wall", description: "d", privacy: "Open", spaceType: "hub" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api-test.arrival.space/api/v1/spaces");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(calls[0].init.body), { title: "Photo wall", description: "d", privacy: "Open", space_type: "hub" });
    assert.deepEqual(out, { spaceId: "45637586_1234", roomId: "custom.travel.center.45637586_1234", title: "Photo wall" });
});

test("createSpace omits unset optionals so the server applies its own defaults", async () => {
    const calls = stubFetch({ body: { data: { spaceId: "1_0001" } } });
    await api.createSpace(CFG, { title: "Bare" });
    assert.deepEqual(JSON.parse(calls[0].init.body), { title: "Bare" });
});

test("createSpace tolerates an unwrapped response shape", async () => {
    stubFetch({ body: { spaceId: "1_0002" } });
    const out = await api.createSpace(CFG, { title: "T" });
    assert.equal(out.spaceId, "1_0002");
    assert.equal(out.title, "T"); // echoed back from the request when the server omits it
});

test("createSpace surfaces the server's error message", async () => {
    stubFetch({ status: 400, body: { status: "error", message: "title is required" } });
    await assert.rejects(() => api.createSpace(CFG, { title: "" }), /title is required/);
});

test("createSpace fails loudly when the response carries no spaceId", async () => {
    stubFetch({ body: { status: "ok", data: {} } });
    await assert.rejects(() => api.createSpace(CFG, { title: "T" }), /no spaceId/);
});

test("createSpace requires a token before it hits the network", async () => {
    const calls = stubFetch({ body: {} });
    await assert.rejects(() => api.createSpace({ server: CFG.server }, { title: "T" }), /Not logged in/);
    assert.equal(calls.length, 0);
});
