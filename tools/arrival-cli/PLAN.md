# `arrival` CLI — plan & design (space-as-code)

A CLI that manages an Arrival.Space "space" as local files (`pull` / `status` / `push` /
`validate`), reusing the backend's **materialize → validate → syncBack** pipeline
(`backend_git/user_server/space_code_agent/*`) — the same one the in-app space agent uses, minus
the LLM. This doc covers what's **implemented** (phase 1), the **changeset redesign** of the
transport + assets model, and the **security gate** surfaced by review.

Reviewed by an adversarial pass (fable) covering both this design and the phase-1 code; its
findings are folded in below (Parts D + E especially).

---

## Part A — Implemented (phase 1, on dev, tested)

### Server (backend_git)
- `space_code_agent/deps.js` — extracted injected S3/DB factories (shared by CLI + agent).
- `space_code_agent/workspace_service.js` — stateless `materializeForUser` (pull) / `applyForUser`
  (push): validate → delete-confirm gate → `agent_lock.tryAcquire` → snapshot → syncBack → returns
  advanced manifest.
- `space_code_agent/agent_lock.js` — `tryAcquire` (symmetric CLI↔agent mutual exclusion).
- `space_code_agent/materialize.js` — `includeReference:false` for CLI pulls.
- `api/spaces_cli.js` — `POST /api/v1/spaces/:id/pull` (materialize → **zip**) and `POST …/apply`
  (**zip** body). Auth `authenticateAPI` + `canEditSpace`; `safeUnzipToDir` guards zip entry names.

### CLI (arrival-plugins-public/tools/arrival)
- `login` (loopback-PKCE OAuth), `spaces`, `pull`, `validate` (server dry-run), `push`, `logout`.
- `lib/workspace.js` (zip↔workspace, CRLF→LF, skeleton dirs + workspace README), `process.exitCode`
  (not `process.exit`, which crashed on Windows via undici teardown).

### Tests
- Unit across both repos; integration `backend_test/index.js` → `arrival-cli` (12/12 on dev).
- **Gap (review):** the integration test runs owner-only — no negative-authz, no hostile-manifest,
  no re-read after 409/422. It would not catch the security holes below.

### Known limitations → the reason for the redesign
1. **Whole-repo zip transport** — a one-line edit re-uploads the whole space.
2. **25 MB per-asset cap** (`syncback.js` `MAX_ASSET_BYTES`) — blocks splats/large models.
3. **Last-writer-wins** — no conflict detection.
4. No `status`/`diff`; binary files inside a multi-file plugin dir don't round-trip.

---

## Part B — Changeset (delta) transport

Replace the whole-repo zip **push** with a git/svn-style **changeset**: send only changed files +
explicit deletes + a base version. Not just efficiency — it makes large assets + precise conflicts
fall out, and explicit deletes retire phase-1's shaky file-absence delete inference.

- **Baseline manifest = the index.** Per-file path + sha (+ url/size for assets).
- **`status` / `diff` are local** — working files vs baseline manifest → added/modified/deleted.
- **`push` sends** `{ baseVersion, puts:[{path, sha, content|s3ref}], deletes:[path…] }`.
- **Per-file transport:** small (entities/plugins/text) inline; large (splat/model/video) →
  presigned PUT to S3, referenced by `s3ref`. No 25 MB cap, no re-zipping to change a comment.
- **Server = a changeset endpoint** (not N granular REST calls — ordering/atomicity matter,
  `syncback.js:87–293`). Reuses syncBack's per-item apply, drops the "diff a whole workspace off
  disk" part (the only reason the zip exists). Also removes the zip-slip surface.
- **`pull` stays a full bundle** (`git clone`); large assets land as pointers (Part C).

### Corrections from review (must design before building)
- **Canonical content, or conflicts are noise (D1).** There is no server-side canonical byte form
  today: materialized entity files include live multiplayer `state` (`materialize.js:203`), and
  bytes are *per-user* (asset index + plugin names depend on the puller — `deps.js:99`,
  `materialize.js:54`). Fix: **workspace entity files carry `{id,type,data}` only (drop `state`)**;
  token mapping + plugin names come from an **owner-scoped** persisted index; and the server
  **persists a per-space version/sha record at apply** so "current sha" is knowable without a
  per-user re-materialize.
- **Delete-direction dangling can't come from a cheap DB inventory (D2).** References at rest are
  URL-substituted, not tokens (`syncback.js:165,246`); the token form only exists after materialize.
  So "does deleting `assets/x` / `plugins/foo` orphan an *untouched* file?" needs a **persisted
  reference index** (token/plugin-key → referencing entity ids), maintained at apply — or S3 fetches
  of referencing sources on delete-bearing changesets. Pick the reference index.
- **Not atomic (D5).** Apply is S3 puts + N DB writes; keep syncBack's per-item + partial-failure +
  version-advance model. Validate-all is the only atomic part. Don't promise all-or-nothing.
- **Conflicts: refuse the whole changeset if ANY file conflicts (D6)** — no per-file `--force`;
  coupled changes (plugin rename = delete+add+entity edit) tear otherwise. svn "update first".
- **RoomInfo needs special handling (D7).** Server systems write RoomInfo `data` out-of-band
  (enrichment, screenshots, flags), so a whole-`room.json` sha conflicts chronically → field-level
  merge/exclusion for RoomInfo.

---

## Part C — Assets model (unified with the changeset)

One reference model, size-transparent:
- **Reference:** always the `assets/<name>` token (already unified for users + agents).
- **Small asset** → real bytes in `space/assets/<name>`.
- **Large asset** → a **pointer** — kept **out of the `space/assets/` file namespace** (in the
  manifest / a single `space/assets.json` sidecar), because everything under `space/assets/` is
  treated as an asset today and `isValidAssetName("x.link")` passes (`assets.js:61`), so an in-band
  `.link` file would be uploaded as an asset and flag the real one missing.
- The persisted index grows to `{name,url,size,sha}` (today `{name,url}`, `syncback.js:300`) so
  materialize can decide pointer-vs-bytes without a HEAD, and moves to **owner/space keying**
  (fixes the per-user divergence, `deps.js:99`) before pointers become source of truth.
- **Adding a file:** transparent — `push` routes by size (small inline, large presigned). Explicit
  `arrival upload <file>` is an escape hatch, same machinery. Pointer `url` resolution stays pinned
  to `mainDB.getS3Key` (own bucket) — never a plain fetch (SSRF).
- **Agents:** `generate_image` (small) / `upload_file_from_url` (any size). Reference tokens; never
  decide transport.
- Pointers make `space/assets/` reflect what a space actually uses (existing `glbUrl`/`videoURL`
  media show as pointers); `--with-assets` hydrates bytes locally on demand.

---

## Part D — Decisions

**Resolved (from review):**
- Changeset endpoint over granular REST. Deletes are explicit in the changeset.
- Entities canonical = `{id,type,data}` (no `state`). Owner-scoped token/asset index. Persist a
  per-space version + a reference index at apply.
- Conflict policy = refuse the whole changeset on any per-file conflict; RoomInfo special-cased.
- Apply is per-item best-effort (not atomic); validate-all is atomic.
- Pointers live out-of-band (manifest/sidecar), not as `space/assets/*.link`.
- Version the endpoint: keep the zip `/apply` until the changeset path has ≥ the current 12-check
  coverage **plus** negative-authz + hostile-manifest tests.

**Still open:**
- Exact per-space version representation (monotonic int vs content-hash-of-manifest).
- RoomInfo field-level merge policy (which `data.*` keys are server-owned).
- Dir-plugin change granularity (whole-dir vs per-file; likely whole-dir via `dirHash`).

---

## Part E — Security gate (fix before this goes anywhere near live)

Found by review; **not urgent (endpoints are dev-only, not live)** but blockers before a live
deploy and before the changeset endpoint ships. The changeset design should be built so these can't
recur (server-derived paths, no client-trusted `file`).

- **C1 — manifest `file` path traversal → arbitrary server-file read + CDN upload.**
  `syncback.js:93` / `validate.js:69` / `workspace_service.js:65` `path.join(workspaceDir,
  <client file>)` with no containment. Fix: reject any manifest `file` not resolving inside
  `workspaceDir` AND under `space/`, in `applyForUser` before anything reads the manifest. (The
  changeset model drops client `file` paths entirely — the real fix.)
- **C2 — esbuild dir-plugin bundles arbitrary server files** (no resolve boundary/timeout,
  `plugin_bundle.js:75`). Fix: esbuild `onResolve` boundary at `workspaceDir` + a build timeout.
- **H1 — decompression-bomb check runs after `entry.getData()`** (`spaces_cli.js:42`). Check
  `entry.header.size` before inflating.
- **H4 — `mcp-oauth.js` `completeOAuthFlow` never re-validates `redirect_uri`** against the
  registered client → forged `cb` can steal a login's code (`mcp-oauth.js:242`). Validate it + name
  the client on the login page. (Pre-existing; the CLI login makes it worth fixing.)
- Also: delete-gate ≠ syncBack delete definition (H2), `pull --force` doesn't clean (H3),
  per-server clientId (M1), owner-scoped index (M3), dryRun hides planned deletes (M4).

---

## Part F — Phasing

- **Phase 0 (now):** local `arrival status` — the "what will push send" preview off the baseline
  manifest (added/modified/deleted). No server changes; foundation for the changeset.
- **Phase 1:** the Part E security patches to the existing zip path (before any live deploy).
- **Phase 2:** the canonical model — entities sans `state`, owner-scoped token/asset index, a
  persisted per-space version + reference index at apply. (Prerequisite for conflicts + pointers.)
- **Phase 3:** the changeset endpoint — explicit deletes, per-file transport, presigned large
  assets, out-of-band pointers, whole-changeset conflict refuse. Version alongside the zip path.
- **Phase 4:** delta-pull, `arrival dev` (fold in the client `_cli` browser bridge), `open`/`logs`,
  live deploy, npm publish.
