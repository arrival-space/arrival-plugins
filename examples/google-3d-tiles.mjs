/**
 * Google Photorealistic 3D Tiles
 *
 * Streams Google's Photorealistic 3D Tiles (the Google Earth dataset) and
 * renders the entire globe as PlayCanvas meshes. Enter a longitude/latitude
 * and the world re-centers so that location sits at this entity's origin,
 * ground-aligned (East -> +X, Up -> +Y, North -> -Z) — the city streams in
 * and builds up around the player.
 *
 * How it works:
 *   1. Fetches https://tile.googleapis.com/v1/3dtiles/root.json?key=...
 *   2. Caches Google's session token and lazily traverses the nested
 *      tileset JSONs that make up the planet-wide tile tree
 *   3. Distance-based LOD: tiles expand into their children while the
 *      camera is within a multiple of their bounding-box size and collapse
 *      again when it leaves (traversal adapted from playcanvas/earthatile, MIT)
 *   4. Tile GLBs load via ArrivalSpace.loadGLB under a rotated/offset anchor,
 *      so re-centering on a new coordinate never re-downloads tiles
 *
 * Requires a Google Maps Platform API key with the "Map Tiles API" enabled
 * (billing required): https://developers.google.com/maps/documentation/tile/3d-tiles
 *
 * Tips:
 *   - "Ground Altitude" is the WGS84 ellipsoid height placed at the entity
 *     origin: terrain elevation + geoid undulation, NOT the map altitude
 *     (Stephansplatz Vienna ~ 216 m = 171 m terrain + 45 m geoid; London
 *     ~ 70 m, NYC ~ 30 m). Tweak until the street lines up with your floor.
 *   - Lower "Scale" (e.g. 0.000002) turns the dataset into a tabletop globe.
 *   - Raise "Detail" for sharper buildings at the cost of more tile loads.
 *   - "Altitude Adaptive Cam" (on by default) makes clip planes and fly
 *     speed follow the camera's height above ground:
 *       near = max(Near Clip, altitude/200) up to 50 km
 *       far  = max(Far Clip, 1.5x physical horizon distance) up to 20,000 km
 *       free cam speed = altitude/2 (Google Earth style — descend to land,
 *       climb to cross continents), scroll-wheel acts as a multiplier on
 *       top, "Free Cam Max Speed" is the hard ceiling (client >= 1.11.2).
 *     Street level gives the baselines; from orbit near exceeds 1,000 m and
 *     far reaches the millions, keeping the depth ratio healthy everywhere.
 *     Toggle OFF and the camera simply uses Near/Far Clip as fixed values
 *     with scroll-only speed control.
 */

const TILE_API = "https://tile.googleapis.com/";

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

/**
 * Minimal Google 3D Tiles tree — traversal adapted from playcanvas/earthatile
 * (MIT). Nodes expand while the camera is within `lodFactor` times their
 * bounding-box size and collapse when it leaves; `.json` content references
 * are fetched lazily and spliced into the tree as children.
 */
class TileTree {
    session = null;

    lodFactor = 4;

    expanded = new Set();

    contentHidden = new Map();

    constructor(apiKey, handlers) {
        this.apiKey = apiKey;
        this.handlers = handlers;
    }

    async fetchJson(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    /**
     * Google returns content URIs in two formats:
     *   1. With a session:  v1/.../file.glb?session=xxx  -> append &key=yyy
     *   2. Without one:     v1/.../file.glb              -> append ?key=yyy&session=zzz
     * The session token from format 1 is cached and reused for format 2.
     */
    buildTileUrl(uri) {
        uri = uri.replace(/^\//, "");
        if (uri.includes("?")) {
            const url = `${TILE_API}${uri}&key=${this.apiKey}`;
            if (!this.session) {
                this.session = new URL(url).searchParams.get("session");
            }
            return url;
        }
        let url = `${TILE_API}${uri}?key=${this.apiKey}`;
        if (this.session) url += `&session=${this.session}`;
        return url;
    }

    async start() {
        const json = await this.fetchJson(`${TILE_API}v1/3dtiles/root.json?key=${this.apiKey}`);
        this.root = json.root;
        await this.expandNode(this.root);
    }

    /**
     * Camera is in the Y-up flip of ECEF: (x, z, -y). Boxes are Z-up ECEF.
     *
     * Range is measured from the camera to the box's bounding sphere, not
     * its center — center distance misjudges planet-scale tiles, where the
     * camera is always ~one earth radius from the center, leaving them
     * flickering at the expand/collapse boundary (a collapse there drops a
     * whole-earth-face mesh on top of the streamed city).
     */
    inRange(node, cam, slack = 1) {
        const box = node.boundingVolume?.box;
        if (!box) return true;
        const [bx, by, bz, xx, xy, xz, yx, yy, yz, zx, zy, zz] = box;
        const dist = len3(bx - cam[0], bz - cam[1], -by - cam[2]);
        const lx = len3(xx, xy, xz), ly = len3(yx, yy, yz), lz = len3(zx, zy, zz);
        const size = Math.max(lx, ly, lz, 100);
        const radius = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const surface = Math.max(0, dist - radius);
        return surface < size * Math.max(this.lodFactor - 1, 1) * slack;
    }

    async loadContent(node) {
        const uri = node.content?.uri;
        if (!uri) return;
        if (uri.includes(".glb")) {
            await this.handlers.load(node);
            if (this.contentHidden.get(uri)) this.handlers.hide(node);
        } else if (uri.includes(".json")) {
            if (!node.children) {
                const json = await this.fetchJson(this.buildTileUrl(uri));
                // The spliced root carries THIS node's LOD-level geometry
                // (unlike real children, which are one level below)
                json.root._isSpliceRoot = true;
                node.children = [json.root];
            }
            // Load the sub-tileset root's geometry too — without it, this
            // subtree is a hole along the LOD transition border ("only some
            // children of the parent are drawn") until it expands further.
            await this.loadContent(node.children[0]);
        }
    }

    /** Recursively unload a child subtree's level geometry (descends through .json refs). */
    unloadContent(node) {
        const uri = node.content?.uri;
        if (!uri) return;
        if (uri.includes(".glb")) {
            this.handlers.unload(node);
        } else if (uri.includes(".json") && node.children) {
            this.unloadContent(node.children[0]);
        }
    }

    /**
     * Expanding a node loads all of its children's content, then hides the
     * node's own content. If any child fails (network hiccup, quota), the
     * node is collapsed again so a later update() retries it.
     */
    async expandNode(node) {
        if (this.expanded.has(node)) return;
        this.expanded.add(node);

        if (node.children) {
            const results = await Promise.allSettled(node.children.map(c => this.loadContent(c)));
            // Collapsed while the children were loading (player moved on) —
            // they were unloaded, so don't hide this node over a hole.
            if (!this.expanded.has(node)) return;
            const failed = results.find(r => r.status === "rejected");
            if (failed) {
                console.warn("GoogleTiles: expand failed, will retry:", failed.reason?.message);
                this.collapseNode(node);
                return;
            }
        }

        if (node.content?.uri.includes(".glb")) {
            this.handlers.hide(node);
            this.contentHidden.set(node.content.uri, true);
        }
    }

    /**
     * Collapsing unloads the children's GLB content and re-shows the node's
     * own (already loaded) content. Fetched sub-tileset JSON is kept as a
     * cache — descendants that were expanded collapse themselves later.
     */
    collapseNode(node) {
        if (node.children) {
            for (const child of node.children) {
                // A splice root is this node's own LOD level, not the level
                // below — it must survive the collapse
                if (child._isSpliceRoot) continue;
                this.unloadContent(child);
            }
        }
        if (node.content?.uri.includes(".glb")) {
            this.handlers.show(node);
            this.contentHidden.set(node.content.uri, false);
        }
        this.expanded.delete(node);
    }

    update(cameraPos) {
        for (const node of Array.from(this.expanded)) {
            // 1.15 slack = hysteresis so nodes at the boundary don't churn
            if (!this.inRange(node, cameraPos, 1.15)) {
                this.collapseNode(node);
                continue;
            }
            if (!node.children) continue;
            for (const child of node.children) {
                if (child.children && !this.expanded.has(child) && this.inRange(child, cameraPos)) {
                    this.expandNode(child).catch(err => console.warn("GoogleTiles:", err.message));
                }
            }
        }
    }
}

export class GoogleTiles extends ArrivalScript {
    static scriptName = "Google 3D Tiles";

    apiKey = "";
    latitude = 48.20849;
    longitude = 16.37208;
    groundAltitude = 216;
    detail = 4;
    tileScale = 1.0;
    altitudeAdaptive = true;
    cameraNearClip = 0.1;
    cameraFarClip = 30000;
    freeCamMaxSpeed = 1000;
    showStatus = true;

    static properties = {
        apiKey: { title: "Google Maps API Key" },
        latitude: { title: "Latitude", min: -90, max: 90, step: 0.00001 },
        longitude: { title: "Longitude", min: -180, max: 180, step: 0.00001 },
        groundAltitude: { title: "Ground Altitude (m)", min: -500, max: 9000, step: 1 },
        detail: { title: "Detail", min: 2, max: 6, step: 0.5 },
        tileScale: { title: "Scale", min: 0.000001, max: 1, step: 0.000001 },
        altitudeAdaptive: { title: "Altitude Adaptive Cam" },
        cameraNearClip: { title: "Near Clip (m)", min: 0.01, max: 100, step: 0.01 },
        cameraFarClip: { title: "Far Clip (m)", min: 1000, max: 20000000, step: 1000 },
        freeCamMaxSpeed: { title: "Free Cam Max Speed (m/s)", min: 50, max: 1000000, step: 50 },
        showStatus: { title: "Show Status" },
    };

    // ── Internal state ──
    _anchor = null;
    _tileRoot = null;
    _tree = null;
    _records = new Map(); // tile node -> { entity, asset, dead }
    _sessionId = 0;
    _updateTimer = 0;
    _loadSlots = 0;
    _loadQueue = [];
    _statusEl = null;
    _lastStatus = "";
    _origNearClip = null;
    _origFarClip = null;
    _lastCameraMode = null;
    _targetRadius = 6378137; // geocentric radius of the anchor point (tile meters)
    _speedMult = 1;          // user's scroll preference relative to the auto speed
    _lastAutoSpeed = null;

    // Concurrent GLB downloads. Movement triggers expand cascades; without a
    // cap, hundreds of parallel loads choke the main thread and the stream
    // appears to stall.
    static MAX_CONCURRENT_LOADS = 10;

    // ────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────

    initialize() {
        this._applyCameraClips();

        // this.entity -> _anchor (ENU rotation + scale) -> _tileRoot (-ECEF offset) -> tiles
        this._anchor = new pc.Entity("google-tiles-anchor");
        this.entity.addChild(this._anchor);
        this._tileRoot = new pc.Entity("google-tiles-root");
        this._anchor.addChild(this._tileRoot);
        this._applyOrigin();

        this._makeAttribution();

        if (!this.apiKey) {
            this._status("Enter a Google Maps Platform API key\n(\"Map Tiles API\" must be enabled)");
            return;
        }
        this._start();
    }

    update(dt) {
        if (!this._tree) return;

        this._updateTimer += dt;
        if (this._updateTimer < 0.1) return;
        this._updateTimer = 0;

        const viewer = ArrivalSpace.getCamera() || ArrivalSpace.getPlayer();
        if (!viewer) return;

        // Uncap the free cam's scroll-wheel speed when free mode is entered
        // (the stock cap of 50 m/s is room-scale; useless for flying a city).
        // Requires client VERSION >= 1.11.2; older clients keep the default.
        const mode = ArrivalSpace.getCameraMode?.();
        if (mode !== this._lastCameraMode) {
            this._lastCameraMode = mode;
            this._lastAutoSpeed = null;
            if (mode === "free") {
                ArrivalSpace.setFreeCamSpeed?.(null, this.freeCamMaxSpeed);
            }
        }

        // Camera position in the tile frame (Y-up flipped ECEF, in meters —
        // the inverse world transform also folds in tileScale)
        const local = this._tileRoot.getWorldTransform().clone().invert()
            .transformPoint(viewer.getPosition());

        if (this.altitudeAdaptive) {
            const altitude = Math.max(
                0, (len3(local.x, local.y, local.z) - this._targetRadius) * this.tileScale
            );
            this._updateDynamicClips(viewer, altitude);
            if (mode === "free") this._updateFreeCamSpeed(altitude);
        } else if (viewer.camera &&
                   (viewer.camera.farClip !== this.cameraFarClip ||
                    viewer.camera.nearClip !== this.cameraNearClip)) {
            // static clips — re-assert if a camera mode switch reset them
            this._applyCameraClips();
        }

        this._tree.update([local.x, local.y, local.z]);

        if (this.showStatus) {
            const queued = this._loadQueue.length;
            this._status(
                `${this._records.size} tiles · ${this._loadSlots} loading` +
                (queued ? ` · ${queued} queued` : "")
            );
        }
    }

    onPropertyChanged(name) {
        switch (name) {
            case "apiKey":
                if (this.apiKey) this._start();
                break;
            case "latitude":
            case "longitude":
            case "groundAltitude":
            case "tileScale":
                // Re-anchors the already-streamed globe — no re-download
                this._applyOrigin();
                break;
            case "detail":
                if (this._tree) this._tree.lodFactor = this.detail;
                break;
            case "cameraNearClip":
            case "cameraFarClip":
                this._applyCameraClips();
                break;
            case "altitudeAdaptive":
                if (!this.altitudeAdaptive) {
                    // back to plain static behavior: baseline clips, scroll-only speed
                    this._applyCameraClips();
                    this._speedMult = 1;
                    this._lastAutoSpeed = null;
                }
                break;
            case "freeCamMaxSpeed":
                if (ArrivalSpace.getCameraMode?.() === "free") {
                    ArrivalSpace.setFreeCamSpeed?.(null, this.freeCamMaxSpeed);
                }
                break;
            case "showStatus":
                if (this._statusEl) {
                    this._statusEl.style.display = this.showStatus ? "block" : "none";
                }
                break;
        }
    }

    destroy() {
        this._sessionId++;
        this._tree = null;
        this._clearTiles();
        const cam = ArrivalSpace.getCamera()?.camera;
        if (cam) {
            if (this._origNearClip !== null) cam.nearClip = this._origNearClip;
            if (this._origFarClip !== null) cam.farClip = this._origFarClip;
        }
        this.removeUI();
        this._statusEl = null;
    }

    // ────────────────────────────────────────────
    // Anchoring
    // ────────────────────────────────────────────

    /**
     * Position and orient the tile hierarchy so the target lat/lon sits at
     * this entity's origin with the local East/Up/North axes mapped to
     * +X/+Y/-Z. Tiles (and 3D Tiles bounding boxes) live in a Y-up flip of
     * ECEF: pc = (ecef.x, ecef.z, -ecef.y).
     */
    _applyOrigin() {
        const lat = this.latitude * Math.PI / 180;
        const lon = this.longitude * Math.PI / 180;
        const sLat = Math.sin(lat), cLat = Math.cos(lat);
        const sLon = Math.sin(lon), cLon = Math.cos(lon);

        // WGS84 geodetic -> ECEF
        const a = 6378137;
        const e2 = 0.00669437999014;
        const N = a / Math.sqrt(1 - e2 * sLat * sLat);
        const alt = this.groundAltitude;
        const ex = (N + alt) * cLat * cLon;
        const ey = (N + alt) * cLat * sLon;
        const ez = (N * (1 - e2) + alt) * sLat;

        // ENU basis at the target, expressed in the Y-up flipped ECEF frame
        const east = [-sLon, 0, -cLon];
        const up = [cLat * cLon, sLat, -cLat * sLon];
        const south = [sLat * cLon, -cLat, -sLat * sLon];

        // Rotation with rows [east, up, south] maps the tile frame to local
        // ENU. pc.Mat4.set takes column-major data.
        const m = new pc.Mat4();
        m.set([
            east[0], up[0], south[0], 0,
            east[1], up[1], south[1], 0,
            east[2], up[2], south[2], 0,
            0, 0, 0, 1,
        ]);
        const q = new pc.Quat();
        q.setFromMat4(m);

        this._anchor.setLocalRotation(q);
        const s = this.tileScale;
        this._anchor.setLocalScale(s, s, s);
        this._tileRoot.setLocalPosition(-ex, -ez, ey);

        // geocentric radius of the ground at the anchor — reference for the
        // altitude-adaptive clip planes
        this._targetRadius = len3(ex, ey, ez);
    }

    /**
     * Apply the baseline clip planes (used at init, when the properties
     * change, and as the fixed values when altitudeAdaptive is off).
     */
    _applyCameraClips() {
        const cam = ArrivalSpace.getCamera()?.camera;
        if (!cam) return;
        if (this._origNearClip === null) this._origNearClip = cam.nearClip;
        if (this._origFarClip === null) this._origFarClip = cam.farClip;
        cam.nearClip = this.cameraNearClip;
        cam.farClip = this.cameraFarClip;
    }

    /**
     * Altitude-adaptive clip planes (altitudeAdaptive on). The properties are
     * the GROUND-LEVEL baselines; both planes grow with the camera's height
     * above the anchor ground so the far/near depth ratio stays healthy:
     *   near = max(baseline, altitude / 200), capped at 50 km
     *   far  = max(baseline, 1.5 x horizon distance), capped at 20,000 km
     * At street level you get the baselines; from orbit (altitude in the
     * millions) near exceeds 1,000 m and far reaches the planet scale.
     * Heights come from the camera's geocentric radius in the tile frame,
     * so this stays correct for a scaled-down tabletop globe too.
     */
    _updateDynamicClips(viewer, altitude) {
        const cam = viewer.camera;
        if (!cam) return;

        const earthRadius = 6378137 * this.tileScale;
        const horizon = Math.sqrt(2 * earthRadius * altitude + altitude * altitude);

        const near = Math.min(50000, Math.max(this.cameraNearClip, altitude / 200));
        const far = Math.min(20000000, Math.max(this.cameraFarClip, (horizon + altitude) * 1.5));

        if (this._origNearClip === null) this._origNearClip = cam.nearClip;
        if (this._origFarClip === null) this._origFarClip = cam.farClip;

        // only write on >1% change to avoid redundant projection updates
        if (Math.abs(cam.nearClip - near) > near * 0.01) cam.nearClip = near;
        if (Math.abs(cam.farClip - far) > far * 0.01) cam.farClip = far;
    }

    /**
     * Altitude-proportional fly speed (Google Earth feel): speed = altitude/2,
     * so descending automatically eases you into a landing and from orbit you
     * cross continents. The user's scroll-wheel input is preserved as a
     * multiplier on top of the auto speed instead of being stomped.
     * Requires client VERSION >= 1.11.2 (getFreeCamSpeed/setFreeCamSpeed).
     */
    _updateFreeCamSpeed(altitude) {
        const info = ArrivalSpace.getFreeCamSpeed?.();
        if (!info) return;

        // detect scroll-wheel changes since our last write
        if (this._lastAutoSpeed !== null &&
            Math.abs(info.speed - this._lastAutoSpeed) > this._lastAutoSpeed * 0.01) {
            this._speedMult *= info.speed / this._lastAutoSpeed;
            this._speedMult = Math.min(20, Math.max(0.05, this._speedMult));
        }

        const auto = Math.max(15, altitude / 2);
        const target = Math.min(this.freeCamMaxSpeed, Math.max(1, auto * this._speedMult));
        ArrivalSpace.setFreeCamSpeed?.(target, this.freeCamMaxSpeed);
        this._lastAutoSpeed = target;
    }

    // ────────────────────────────────────────────
    // Streaming
    // ────────────────────────────────────────────

    async _start() {
        const session = ++this._sessionId;
        this._clearTiles();

        const tree = new TileTree(this.apiKey, {
            load: node => this._loadTile(node, tree, session),
            unload: node => this._unloadTile(node),
            show: node => this._setTileVisible(node, true),
            hide: node => this._setTileVisible(node, false),
        });
        tree.lodFactor = this.detail;
        this._tree = tree;

        this._status("Connecting to Google 3D Tiles...");
        try {
            await tree.start();
        } catch (err) {
            if (session !== this._sessionId) return;
            this._tree = null;
            this._status(
                `Failed to load root tileset: ${err.message}\n` +
                `Check the API key and that "Map Tiles API" is enabled.`
            );
        }
    }

    /**
     * Wait for a download slot. The queue is drained newest-first (LIFO):
     * while the player moves, the most recent expands are the nearest tiles,
     * and stale queued loads usually get tombstoned before they ever run.
     */
    _acquireSlot() {
        if (this._loadSlots < GoogleTiles.MAX_CONCURRENT_LOADS) {
            this._loadSlots++;
            return Promise.resolve();
        }
        return new Promise(resolve => this._loadQueue.push(resolve))
            .then(() => { this._loadSlots++; });
    }

    _releaseSlot() {
        this._loadSlots--;
        const next = this._loadQueue.pop();
        if (next) next();
    }

    async _loadTile(node, tree, session) {
        const existing = this._records.get(node);
        if (existing && !existing.dead) return; // already loaded or loading

        // Record exists before any await so an unload during the download
        // can tombstone it (dead flag) instead of leaking the entity
        const rec = { entity: null, asset: null, dead: false };
        this._records.set(node, rec);
        try {
            await this._acquireSlot();
            try {
                if (session !== this._sessionId || rec.dead) return;
                const url = tree.buildTileUrl(node.content.uri);
                const { entity, asset } = await ArrivalSpace.loadGLB(url, {
                    parent: this._tileRoot,
                    name: "google-tile",
                    castShadows: false,
                });

                if (session !== this._sessionId || rec.dead) {
                    this._disposeTile(entity, asset);
                    return;
                }

                rec.entity = entity;
                rec.asset = asset;
            } finally {
                this._releaseSlot();
            }
        } finally {
            // tombstoned or failed loads leave no record behind
            if (this._records.get(node) === rec && !rec.entity) {
                this._records.delete(node);
            }
        }
    }

    _unloadTile(node) {
        const rec = this._records.get(node);
        if (!rec) return;
        this._records.delete(node);
        rec.dead = true;
        this._disposeTile(rec.entity, rec.asset);
    }

    /**
     * Free BOTH the scene entity and its container asset.
     *
     * Each tile's geometry is resident twice: PlayCanvas keeps the client-side
     * ArrayBuffer (VertexBuffer/IndexBuffer.storage) after uploading to the GPU
     * and only releases it on the buffer's destroy() — true on both the WebGL
     * and WebGPU backends (neither nulls .storage post-upload), so a tile costs
     * ~2x its GPU footprint plus its textures. Destroying only the entity tears
     * down the mesh instances but leaves the container asset — and thus both the
     * CPU copies and the GPU buffers/textures — alive in app.assets. (loadGLB
     * containers aren't referenced via render.asset, so disposeEntity({
     * destroyAssets }) misses them too.) Across a long flight that double pool
     * balloons; remove and unload the container explicitly to reclaim it.
     */
    _disposeTile(entity, asset) {
        try { entity?.destroy(); } catch (_) { /* already gone */ }
        if (asset) {
            try {
                this.app.assets.remove(asset);
                asset.unload();
            } catch (_) { /* already gone */ }
        }
    }

    _setTileVisible(node, visible) {
        const rec = this._records.get(node);
        if (rec?.entity) rec.entity.enabled = visible;
    }

    _clearTiles() {
        for (const node of Array.from(this._records.keys())) {
            this._unloadTile(node);
        }
        // Wake queued waiters — they bail on the session/tombstone check
        for (const resolve of this._loadQueue.splice(0)) resolve();
    }

    // ────────────────────────────────────────────
    // UI
    // ────────────────────────────────────────────

    _status(msg) {
        if (msg === this._lastStatus) return;
        this._lastStatus = msg;
        try {
            if (!this._statusEl) {
                this._statusEl = this.createUI("div");
                if (this._statusEl) {
                    Object.assign(this._statusEl.style, {
                        position: "fixed",
                        bottom: "32px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(10,15,25,0.82)",
                        color: "#6fdf6f",
                        padding: "8px 14px",
                        fontFamily: "monospace",
                        fontSize: "13px",
                        borderRadius: "6px",
                        maxWidth: "420px",
                        whiteSpace: "pre-wrap",
                        lineHeight: "1.4",
                        textAlign: "center",
                        zIndex: "999",
                        pointerEvents: "none",
                    });
                    this._statusEl.style.display = this.showStatus ? "block" : "none";
                }
            }
            if (this._statusEl) this._statusEl.textContent = msg;
        } catch (_) { /* UI not available */ }
    }

    /** Google's terms require visible attribution while tiles are displayed */
    _makeAttribution() {
        try {
            const el = this.createUI("div");
            if (!el) return;
            el.textContent = "Map data © Google";
            Object.assign(el.style, {
                position: "fixed",
                bottom: "8px",
                right: "12px",
                color: "#fff",
                textShadow: "0 0 3px rgba(0,0,0,0.9)",
                fontFamily: "sans-serif",
                fontSize: "11px",
                zIndex: "999",
                pointerEvents: "none",
            });
        } catch (_) { /* UI not available */ }
    }
}
