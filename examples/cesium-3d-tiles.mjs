/**
 * Cesium 3D Tiles
 *
 * Streams 3D Tiles from Cesium Ion and renders them as PlayCanvas meshes.
 *
 * How it works:
 *   1. Authenticates with Cesium Ion to get a streaming endpoint + temp token
 *   2. Fetches tileset.json and traverses the tile tree
 *   3. Spatially culls tiles, keeping only those near the target lat/lon
 *   4. Fetches b3dm/glb content, parses b3dm headers to extract embedded GLB
 *   5. Converts ECEF tile transforms → local ENU → PlayCanvas Y-up coords
 *   6. Loads GLB via blob URLs through ArrivalSpace.loadGLB
 *
 * Supports: b3dm and glb tile formats, region/box/sphere bounding volumes,
 * external tileset references, REPLACE and ADD refinement, RTC_CENTER offsets.
 *
 * Note: Implicit tiling (used by Google Photorealistic 3D Tiles) is not yet
 * supported. Works best with explicit tilesets (Cesium OSM Buildings,
 * photogrammetry uploads, city scans, etc.).
 */
export class CesiumTiles extends ArrivalScript {
    static scriptName = "Cesium 3D Tiles";

    cesiumIonToken = "";
    assetId = "";
    latitude = 40.748817;
    longitude = -73.985428;
    maxTiles = 48;
    lodBias = 1.0;
    tileScale = 1.0;
    maxDepth = 20;
    cameraFarClip = 200000;

    static properties = {
        cesiumIonToken: { title: "Cesium Ion Token" },
        assetId: { title: "Asset ID" },
        latitude: { title: "Latitude", min: -90, max: 90 },
        longitude: { title: "Longitude", min: -180, max: 180 },
        maxTiles: { title: "Max Tiles", min: 1, max: 500 },
        lodBias: { title: "LOD Bias", min: 0.25, max: 4, step: 0.05 },
        tileScale: { title: "Scale", min: 0.001, max: 100 },
        maxDepth: { title: "Max Depth", min: 1, max: 50 },
        cameraFarClip: { title: "Camera Far Clip", min: 1000, max: 2000000, step: 1000 },
    };

    // ── Internal state ──
    _loadedTiles = new Map();
    _pendingTiles = new Map();
    _loadQueue = [];
    _wantedTileIds = new Set();
    _externalTilesets = new Map();
    _loading = false;
    _statusEl = null;
    _loadedCount = 0;
    _activeLoads = 0;
    _sessionId = 0;
    _selectionEpoch = 0;
    _selectionDirty = false;
    _selectionRunning = false;
    _selectionTimer = 0;
    _lastCameraLocal = null;
    _rootContext = null;
    _ecefToLocal = null;
    _selectionInterval = 0.35;
    _cameraMoveThreshold = 6;
    _maxConcurrentLoads = 8;
    _selectionNodeBudgetMin = 2000;
    _selectionGraceEpochs = 0;
    _cameraCullBase = 2500;
    _cameraCullPerTile = 60;
    _cameraCullRadiusScale = 12;
    _nearRefineMultiplier = 48;
    _nearRefineMinimum = 250;
    _sseConstant = 2400;
    _sseThreshold = 6;

    // ── WGS84 ellipsoid ──
    static A = 6378137.0;
    static E2 = 0.00669437999014;

    // ────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────

    initialize() {
        this._applyCameraFarClip();
        if (!this.cesiumIonToken || !this.assetId) {
            this._status("Configure cesiumIonToken and assetId to begin");
            return;
        }
        this._streamTiles();
    }

    update(dt) {
        if (!this._rootContext) return;

        const cameraLocal = this._getCameraLocalPosition();
        if (!cameraLocal) return;

        this._selectionTimer += dt;

        let moved = false;
        if (!this._lastCameraLocal) {
            moved = true;
        } else if (CesiumTiles.dist3(cameraLocal, this._lastCameraLocal) >= this._cameraMoveThreshold) {
            moved = true;
        }

        if (moved) {
            this._lastCameraLocal = cameraLocal;
            this._selectionDirty = true;
        }

        if (this._selectionDirty && !this._selectionRunning && this._selectionTimer >= this._selectionInterval) {
            this._selectionTimer = 0;
            this._refreshSelection(cameraLocal);
        }

        this._pumpLoadQueue();
    }

    onPropertyChanged(name) {
        if (name === "tileScale") {
            this._rebuildTransforms();
            return;
        }

        if (name === "cameraFarClip") {
            this._applyCameraFarClip();
            return;
        }

        if (!this.cesiumIonToken || !this.assetId) return;

        if (name === "maxTiles" || name === "maxDepth" || name === "lodBias") {
            this._selectionDirty = true;
            this._selectionTimer = this._selectionInterval;
            return;
        }

        this._streamTiles();
    }

    destroy() {
        this._sessionId++;
        this._cleanup();
        this.removeUI();
        this._statusEl = null;
    }

    // ────────────────────────────────────────────
    // Status UI
    // ────────────────────────────────────────────

    _status(msg) {
        console.log("CesiumTiles:", msg);
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
                }
            }
            if (this._statusEl) this._statusEl.textContent = msg;
        } catch (_) { /* UI not available */ }
    }

    // ────────────────────────────────────────────
    // Main streaming pipeline
    // ────────────────────────────────────────────

    async _streamTiles() {
        const session = ++this._sessionId;
        this._loading = true;
        this._cleanup();

        try {
            // 1) Cesium Ion endpoint
            this._status("Authenticating with Cesium Ion...");
            const ep = await this._ionEndpoint();
            if (session !== this._sessionId) return;
            if (!ep) return;

            // Build unified fetch headers (Bearer token or external headers)
            const authHeaders = { ...ep.headers };
            if (ep.accessToken) {
                authHeaders["Authorization"] = `Bearer ${ep.accessToken}`;
            }

            // 2) Fetch tileset.json
            this._status("Fetching tileset.json...");
            const tileset = await this._fetchJson(ep.url, authHeaders);
            if (session !== this._sessionId) return;
            if (!tileset?.root) {
                this._status("Error: invalid tileset.json (no root)");
                return;
            }

            // Warn about implicit tiling
            if (
                tileset.root.implicitTiling ||
                tileset.root.extensions?.["3DTILES_implicit_tiling"]
            ) {
                this._status(
                    "Warning: this tileset uses implicit tiling\n" +
                    "(Google 3D Tiles, etc.) which is not yet\n" +
                    "supported. Use explicit tilesets instead."
                );
                return;
            }

            this._ecefToLocal = CesiumTiles.buildEcefToLocal(this.latitude, this.longitude);
            this._rootContext = {
                id: "root",
                tile: tileset.root,
                xform: CesiumTiles.identity4(),
                parentUrl: ep.url,
                headers: authHeaders,
                depth: 0,
                parentRefine: "REPLACE",
            };
            this._selectionDirty = true;
            this._selectionTimer = this._selectionInterval;
            this._lastCameraLocal = null;
            this._status("Streaming tiles...");

            const cameraLocal = this._getCameraLocalPosition();
            if (cameraLocal) {
                await this._refreshSelection(cameraLocal);
            }
        } catch (err) {
            console.error("CesiumTiles:", err);
            this._status(`Error: ${err.message}`);
        } finally {
            if (session === this._sessionId) {
                this._loading = false;
            }
        }
    }

    // ────────────────────────────────────────────
    // Cesium Ion API
    // ────────────────────────────────────────────

    async _ionEndpoint() {
        try {
            const url =
                `https://api.cesium.com/v1/assets/${this.assetId}` +
                `/endpoint?access_token=${this.cesiumIonToken}`;
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                this._status(`Ion auth failed (HTTP ${res.status})\n${body}`);
                return null;
            }
            const data = await res.json();
            // Normalize response — Cesium Ion has two formats:
            //
            // Standard assets:
            //   { type: "3DTILES", url: "...", accessToken: "..." }
            //
            // External assets (Google 3D Tiles, etc.):
            //   { type: "EXTERNAL", externalType: "3DTILES",
            //     options: { url: "...", headers?: {...} },
            //     attributions: [...] }
            const tileType = data.externalType || data.type;
            if (tileType && tileType !== "3DTILES") {
                this._status(`Asset type "${tileType}" is not 3DTILES`);
                return null;
            }

            // Extract URL and auth from whichever format we got
            const tileUrl = data.url || data.options?.url;
            const accessToken = data.accessToken || null;
            const headers = data.options?.headers || {};

            if (!tileUrl) {
                this._status(
                    `Ion returned no streaming URL.\n` +
                    `Keys: ${Object.keys(data).join(", ")}\n` +
                    `options keys: ${data.options ? Object.keys(data.options).join(", ") : "n/a"}`
                );
                return null;
            }

            return { url: tileUrl, accessToken, headers };
        } catch (err) {
            this._status(`Ion auth error: ${err.message}`);
            return null;
        }
    }

    async _fetchJson(url, headers) {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        return res.json();
    }

    async _fetchBuffer(url, headers) {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
        return res.arrayBuffer();
    }

    /**
     * Resolve a relative tile URI against a parent URL.
     * Merges query params from the parent URL into the result so that
     * credentials (Google API key, session token, etc.) propagate
     * to every child request.
     */
    _resolveUrl(uri, parentUrl) {
        const resolved = new URL(uri, parentUrl);
        // new URL() doesn't carry the parent's query params to the child.
        // Merge them manually — parent params act as defaults.
        const parent = new URL(parentUrl);
        for (const [k, v] of parent.searchParams) {
            if (!resolved.searchParams.has(k)) {
                resolved.searchParams.set(k, v);
            }
        }
        return resolved.href;
    }

    // ────────────────────────────────────────────
    // Tile selection / streaming
    // ────────────────────────────────────────────

    _getCameraLocalPosition() {
        const camera = ArrivalSpace.getCamera?.() || ArrivalSpace.getPlayer?.();
        if (!camera) return null;

        const cameraPos = camera.getPosition();
        const base = this.entity.getPosition();
        return {
            x: cameraPos.x - base.x,
            y: cameraPos.y - base.y,
            z: cameraPos.z - base.z,
        };
    }

    _applyCameraFarClip() {
        const cameraEntity = ArrivalSpace.getCamera?.();
        const cameraComponent = cameraEntity?.camera;
        if (!cameraComponent) return;

        cameraComponent.farClip = Math.max(cameraComponent.farClip || 0, this.cameraFarClip);
    }

    async _refreshSelection(cameraLocal) {
        if (this._selectionRunning || !this._rootContext || !this._ecefToLocal) return;

        const session = this._sessionId;
        this._selectionRunning = true;
        this._selectionDirty = false;

        try {
            const { desired, visited, budget } = this._selectTilesForCamera(cameraLocal);
            if (session !== this._sessionId) return;
            this._applySelection(desired, visited, budget);
        } catch (err) {
            console.error("CesiumTiles: selection failed:", err);
        } finally {
            if (session === this._sessionId) {
                this._selectionRunning = false;
            }
        }
    }

    _selectTilesForCamera(cameraLocal) {
        const desired = new Map();
        const queue = [];
        const desiredLimit = Math.max(this.maxTiles * 4, 64);
        const nodeBudget = this._selectionNodeBudget();
        let visited = 0;

        const pushContext = (context) => {
            const metric = this._tileMetric(context.tile, context.xform, cameraLocal);
            if (!metric) return;
            if (!this._tileWithinActiveRange(metric, context.depth)) return;
            this._heapPush(queue, {
                ...context,
                metric,
                priority: this._tilePriority(context.tile, metric),
            });
        };

        pushContext(this._rootContext);

        while (queue.length > 0 && visited < nodeBudget) {
            const current = this._heapPop(queue);
            visited++;

            const tile = current.tile;
            const refine = (tile.refine || current.parentRefine || "REPLACE").toUpperCase();
            const contentUri = tile.content?.uri || tile.content?.url;
            const hasRenderableContent = contentUri && !this._isJsonUri(contentUri);
            const children = this._expandChildren(current);
            const shouldRefine = (
                children.length > 0 &&
                current.depth < this.maxDepth &&
                this._shouldRefineTile(tile, current.metric, current.depth)
            );
            const keepParentFallback = (
                refine !== "ADD" &&
                hasRenderableContent &&
                shouldRefine &&
                !children.some((child) =>
                    this._loadedTiles.has(child.id) || this._pendingTiles.has(child.id)
                )
            );
            const descend = children.length > 0 && (!hasRenderableContent || shouldRefine);

            if (hasRenderableContent && (refine === "ADD" || !descend || keepParentFallback)) {
                desired.set(current.id, {
                    id: current.id,
                    uri: contentUri,
                    parentUrl: current.parentUrl,
                    headers: current.headers,
                    transform: current.xform,
                    depth: current.depth,
                    metric: current.metric,
                    priority: current.priority,
                });
                if (desired.size > desiredLimit) {
                    let lowestId = null;
                    let lowestPriority = Infinity;
                    for (const [id, tileInfo] of desired) {
                        if (tileInfo.priority < lowestPriority) {
                            lowestPriority = tileInfo.priority;
                            lowestId = id;
                        }
                    }
                    if (lowestId) desired.delete(lowestId);
                }
            }

            if (descend) {
                for (const child of children) {
                    pushContext(child);
                }
            }
        }

        return {
            desired: Array.from(desired.values())
                .sort((a, b) => b.priority - a.priority)
                .slice(0, this.maxTiles),
            visited,
            budget: nodeBudget,
        };
    }

    _selectionNodeBudget() {
        return Math.max(this._selectionNodeBudgetMin, this.maxTiles * 12);
    }

    _tileWithinActiveRange(metric, depth) {
        const maxDistance = Math.max(
            this._cameraCullBase + this.maxTiles * this._cameraCullPerTile,
            metric.radius * Math.max(this._cameraCullRadiusScale - depth, 4)
        );
        return metric.distance - metric.radius <= maxDistance;
    }

    _expandChildren(context) {
        const children = [];
        const tile = context.tile;
        const refine = (tile.refine || context.parentRefine || "REPLACE").toUpperCase();
        const contentUri = tile.content?.uri || tile.content?.url;

        if (contentUri && this._isJsonUri(contentUri)) {
            const childUrl = this._resolveUrl(contentUri, context.parentUrl);
            const external = this._ensureExternalTileset(childUrl, context.headers);
            if (external?.root) {
                children.push({
                    id: `${context.id}::ext`,
                    tile: external.root,
                    xform: context.xform,
                    parentUrl: childUrl,
                    headers: context.headers,
                    depth: context.depth + 1,
                    parentRefine: refine,
                });
            }
        }

        if (tile.children?.length) {
            for (let i = 0; i < tile.children.length; i++) {
                const child = tile.children[i];
                const childXform = child.transform
                    ? CesiumTiles.mat4Mul(context.xform, new Float64Array(child.transform))
                    : context.xform;
                children.push({
                    id: `${context.id}/${i}`,
                    tile: child,
                    xform: childXform,
                    parentUrl: context.parentUrl,
                    headers: context.headers,
                    depth: context.depth + 1,
                    parentRefine: refine,
                });
            }
        }

        return children;
    }

    _ensureExternalTileset(url, headers) {
        const cached = this._externalTilesets.get(url);
        if (cached) {
            return cached.state === "ready" ? cached : null;
        }

        const session = this._sessionId;
        const record = { state: "loading", root: null };
        this._externalTilesets.set(url, record);

        this._fetchJson(url, headers)
            .then((childSet) => {
                if (session !== this._sessionId) return;
                if (!childSet?.root) {
                    record.state = "error";
                    return;
                }
                record.state = "ready";
                record.root = childSet.root;
                this._selectionDirty = true;
                this._selectionTimer = this._selectionInterval;
            })
            .catch((err) => {
                if (session !== this._sessionId) return;
                record.state = "error";
                console.warn("CesiumTiles: external tileset failed:", url, err.message);
            });

        return null;
    }

    _applySelection(desired, visited, budget) {
        const epoch = ++this._selectionEpoch;
        this._wantedTileIds = new Set(desired.map((tile) => tile.id));

        for (const tile of desired) {
            const loaded = this._loadedTiles.get(tile.id);
            if (loaded) {
                loaded.lastWantedEpoch = epoch;
                continue;
            }

            const pending = this._pendingTiles.get(tile.id);
            if (pending) {
                pending.lastWantedEpoch = epoch;
            }
        }

        for (const [id, record] of this._loadedTiles) {
            if (!this._wantedTileIds.has(id) && epoch - record.lastWantedEpoch >= this._selectionGraceEpochs) {
                this._unloadTile(id);
            }
        }

        this._loadQueue = desired
            .filter((tile) => !this._loadedTiles.has(tile.id) && !this._pendingTiles.has(tile.id))
            .sort((a, b) => b.priority - a.priority);

        this._pumpLoadQueue();
        this._loadedCount = this._loadedTiles.size;
        this._status(
            `Streaming tiles: ${this._loadedTiles.size} loaded, ${this._pendingTiles.size} loading, ` +
            `${desired.length} wanted, ${visited}/${budget} checked`
        );
    }

    _pumpLoadQueue() {
        while (this._activeLoads < this._maxConcurrentLoads && this._loadQueue.length > 0) {
            const next = this._loadQueue.shift();
            if (!this._wantedTileIds.has(next.id)) continue;
            if (this._loadedTiles.has(next.id) || this._pendingTiles.has(next.id)) continue;

            const session = this._sessionId;
            const pending = { lastWantedEpoch: this._selectionEpoch, session };
            this._pendingTiles.set(next.id, pending);
            this._activeLoads++;

            this._loadTile(next, session)
                .catch((err) => {
                    console.error("CesiumTiles: tile load failed:", next.uri, err);
                })
                .finally(() => {
                    if (this._pendingTiles.get(next.id) === pending) {
                        this._pendingTiles.delete(next.id);
                    }
                    if (session === this._sessionId) {
                        this._activeLoads = Math.max(0, this._activeLoads - 1);
                        this._selectionDirty = true;
                        this._selectionTimer = this._selectionInterval;
                        this._pumpLoadQueue();
                    }
                });
        }
    }

    _unloadTile(id) {
        const record = this._loadedTiles.get(id);
        if (!record) return;

        try { ArrivalSpace.disposeEntity(record.container, { destroyAssets: true }); } catch (_) {}
        try { URL.revokeObjectURL(record.blobUrl); } catch (_) {}
        this._loadedTiles.delete(id);
        this._loadedCount = this._loadedTiles.size;
    }

    _isJsonUri(uri) {
        return uri.split("?")[0].toLowerCase().endsWith(".json");
    }

    _tileMetric(tile, xform, cameraLocal) {
        if (!this._ecefToLocal) return null;

        const bv = tile.boundingVolume;
        if (!bv) {
            const centerEcef = { x: xform[12], y: xform[13], z: xform[14] };
            const localCenter = CesiumTiles.xformPoint(
                this._ecefToLocal, centerEcef.x, centerEcef.y, centerEcef.z
            );
            return {
                centerEcef,
                localCenter,
                radius: 50,
                distance: CesiumTiles.dist3(localCenter, cameraLocal),
            };
        }

        let centerEcef;
        let radius = 50;
        if (bv.region) {
            const [w, s, e, n, h0, h1] = bv.region;
            const alt = ((h0 || 0) + (h1 || 0)) / 2;
            centerEcef = CesiumTiles.geodeticToECEF(
                ((s + n) / 2) * 180 / Math.PI,
                ((w + e) / 2) * 180 / Math.PI,
                alt
            );
            const corners = [
                CesiumTiles.geodeticToECEF(s * 180 / Math.PI, w * 180 / Math.PI, alt),
                CesiumTiles.geodeticToECEF(s * 180 / Math.PI, e * 180 / Math.PI, alt),
                CesiumTiles.geodeticToECEF(n * 180 / Math.PI, w * 180 / Math.PI, alt),
                CesiumTiles.geodeticToECEF(n * 180 / Math.PI, e * 180 / Math.PI, alt),
            ];
            radius = Math.max(
                ...corners.map((corner) => CesiumTiles.dist3(corner, centerEcef)),
                Math.abs((h1 || 0) - (h0 || 0)) * 0.5
            );
        } else if (bv.box) {
            centerEcef = CesiumTiles.xformPoint(xform, bv.box[0], bv.box[1], bv.box[2]);
            const a = CesiumTiles.xformVectorLength(xform, bv.box[3], bv.box[4], bv.box[5]);
            const b = CesiumTiles.xformVectorLength(xform, bv.box[6], bv.box[7], bv.box[8]);
            const c = CesiumTiles.xformVectorLength(xform, bv.box[9], bv.box[10], bv.box[11]);
            radius = Math.sqrt(a * a + b * b + c * c);
        } else if (bv.sphere) {
            centerEcef = CesiumTiles.xformPoint(xform, bv.sphere[0], bv.sphere[1], bv.sphere[2]);
            radius = bv.sphere[3] * CesiumTiles.maxLinearScale(xform);
        } else {
            centerEcef = { x: xform[12], y: xform[13], z: xform[14] };
        }

        const localCenter = CesiumTiles.xformPoint(
            this._ecefToLocal, centerEcef.x, centerEcef.y, centerEcef.z
        );
        return {
            centerEcef,
            localCenter,
            radius,
            distance: CesiumTiles.dist3(localCenter, cameraLocal),
        };
    }

    _tilePriority(tile, metric) {
        const geometricError = Math.max(tile.geometricError || metric.radius || 1, 1);
        return (geometricError * this.lodBias * 1000) / Math.max(metric.distance - metric.radius, 1);
    }

    _shouldRefineTile(tile, metric, depth) {
        if (depth >= this.maxDepth) return false;
        if (metric.distance <= Math.max(
            metric.radius * this._nearRefineMultiplier,
            this._nearRefineMinimum
        )) {
            return true;
        }

        const geometricError = tile.geometricError || 0;
        if (geometricError <= 0) {
            return depth < Math.min(this.maxDepth, 8);
        }

        const sse = (geometricError * this._sseConstant * this.lodBias) /
            Math.max(metric.distance - metric.radius, 1);
        return sse > this._sseThreshold;
    }

    // ────────────────────────────────────────────
    // Tile loading
    // ────────────────────────────────────────────

    async _loadTile(info, session) {
        let container = null;
        let blobUrl = null;

        try {
            const url = this._resolveUrl(info.uri, info.parentUrl);
            const buf = await this._fetchBuffer(url, info.headers);
            if (session !== this._sessionId || !this._ecefToLocal) return;

            let glbData;
            let rtcCenter = null;
            const ext = info.uri.split("?")[0].split(".").pop().toLowerCase();

            if (ext === "b3dm") {
                const parsed = CesiumTiles.parseB3dm(buf);
                glbData = parsed.glbData;
                rtcCenter = parsed.rtcCenter;
            } else if (ext === "glb") {
                glbData = buf;
            } else {
                console.warn("CesiumTiles: unsupported tile format:", ext);
                return;
            }

            if (!glbData || glbData.byteLength < 12) {
                console.warn("CesiumTiles: empty or invalid GLB data for", info.uri);
                return;
            }

            // ── Build per-vertex CPU transform ──
            //
            // Instead of putting the ECEF→local rotation on the entity
            // quaternion (which caused 90° orientation issues), we transform
            // vertex positions and normals directly on CPU:
            //
            //   entity-local vertex = combinedRot × v + offset
            //
            // where combinedRot = R_ecefToLocal × M_tileRotation (3×3)
            // Entity gets position + uniform scale only — no rotation.

            const M = info.transform;
            const ecefToLocal = this._ecefToLocal;

            // 3×3 rotation from ecefToLocal (column-major)
            const R = [
                ecefToLocal[0], ecefToLocal[1], ecefToLocal[2],
                ecefToLocal[4], ecefToLocal[5], ecefToLocal[6],
                ecefToLocal[8], ecefToLocal[9], ecefToLocal[10],
            ];
            // 3×3 rotation from tile transform (column-major)
            const Mrot = [
                M[0], M[1], M[2],
                M[4], M[5], M[6],
                M[8], M[9], M[10],
            ];

            // Combined rotation: R × Mrot
            const CR = CesiumTiles.mat3Mul(R, Mrot);

            let ecefAnchor;
            const vertexOffset = { x: 0, y: 0, z: 0 };
            const tileOrigin = { x: M[12], y: M[13], z: M[14] };

            if (rtcCenter) {
                // b3dm RTC: vertices are relative to rtcCenter
                ecefAnchor = CesiumTiles.xformPoint(
                    M, rtcCenter[0], rtcCenter[1], rtcCenter[2]
                );
            } else {
                ecefAnchor = tileOrigin;
            }

            // Entity position in local space (small values near origin)
            const entityPos = CesiumTiles.xformPoint(
                ecefToLocal, ecefAnchor.x, ecefAnchor.y, ecefAnchor.z
            );
            const s = this.tileScale;

            // Create container — position + scale only, NO rotation
            container = new pc.Entity(`CesiumTile_${info.id}`);
            this.entity.addChild(container);
            container.setLocalPosition(entityPos.x * s, entityPos.y * s, entityPos.z * s);
            container.setLocalScale(s, s, s);
            container._cesiumTileData = { pos: entityPos };

            // Load GLB from blob URL
            const blob = new Blob([glbData], { type: "model/gltf-binary" });
            blobUrl = URL.createObjectURL(blob);

            const { entity: tileEntity } = await ArrivalSpace.loadGLB(blobUrl, {
                parent: container,
                name: `TileMesh_${info.id}`,
            });
            if (session !== this._sessionId) return;

            let renderAnchor = ecefAnchor;
            if (!rtcCenter && CesiumTiles.isIdentityLikeMat4(M)) {
                const glbAnchor = this._extractGlbAnchor(tileEntity);
                if (glbAnchor) {
                    renderAnchor = glbAnchor;
                    const anchorPos = CesiumTiles.xformPoint(
                        ecefToLocal, renderAnchor.x, renderAnchor.y, renderAnchor.z
                    );
                    container.setLocalPosition(anchorPos.x * s, anchorPos.y * s, anchorPos.z * s);
                    container._cesiumTileData = { pos: anchorPos };
                }
            }

            // Reset GLB internal ECEF node transforms.
            // Google 3D Tiles bakes ECEF position + Z-up→Y-up rotation into
            // GLB nodes. We strip these and handle positioning/rotation ourselves.
            this._resetGlbEcefNodes(tileEntity);

            // Transform vertex positions + normals on CPU
            this._transformMeshVertices(tileEntity, CR, vertexOffset);

            if (!this._wantedTileIds.has(info.id)) {
                return;
            }

            this._loadedTiles.set(info.id, {
                container,
                blobUrl,
                lastWantedEpoch: this._selectionEpoch,
            });
            this._loadedCount = this._loadedTiles.size;
            this._selectionDirty = true;
            this._selectionTimer = this._selectionInterval;
            container = null;
            blobUrl = null;
        } catch (err) {
            throw err;
        } finally {
            if (container) {
                try { ArrivalSpace.disposeEntity(container, { destroyAssets: true }); } catch (_) {}
            }
            if (blobUrl) {
                try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            }
        }
    }

    /**
     * Strip ECEF positioning from GLB node transforms.
     * Google 3D Tiles embeds the tile's ECEF position and a Z-up→Y-up
     * rotation (-90° X) inside the GLB's node hierarchy. We zero these
     * out so our container transform + CPU vertex rotation can handle
     * positioning and orientation correctly in float64.
     */
    _resetGlbEcefNodes(entity) {
        const reset = (e) => {
            const p = e.getLocalPosition();
            if (Math.abs(p.x) > 10000 || Math.abs(p.y) > 10000 || Math.abs(p.z) > 10000) {
                e.setLocalPosition(0, 0, 0);
                e.setLocalRotation(0, 0, 0, 1); // identity
            }
            for (const child of e.children || []) reset(child);
        };
        reset(entity);
    }

    _extractGlbAnchor(entity) {
        let anchor = null;
        const visit = (e) => {
            if (anchor) return;
            const p = e.getLocalPosition();
            const magSq = p.x * p.x + p.y * p.y + p.z * p.z;
            if (magSq > 1e10) {
                const r = e.getLocalRotation();
                anchor = CesiumTiles.rotateVec3ByQuatInverse(p, r);
                return;
            }
            for (const child of e.children || []) visit(child);
        };
        visit(entity);
        return anchor;
    }

    /**
     * Transform all vertex positions and normals in an entity's mesh hierarchy.
     * Applies: position = rot3x3 × v + offset, normal = rot3x3 × n
     * This rotates vertices into local PlayCanvas space on CPU, avoiding
     * entity quaternion rotation (which caused 90° orientation issues).
     */
    _transformMeshVertices(entity, rot3x3, offset) {
        const meshInstances = [];
        const collect = (e) => {
            if (e.render?.meshInstances) {
                meshInstances.push(...e.render.meshInstances);
            }
            for (const child of e.children || []) {
                collect(child);
            }
        };
        collect(entity);

        const r = rot3x3;
        const ox = offset.x, oy = offset.y, oz = offset.z;

        for (const mi of meshInstances) {
            const mesh = mi.mesh;

            // Transform positions: rot × v + offset
            const positions = [];
            mesh.getPositions(positions);
            if (positions.length) {
                for (let i = 0; i < positions.length; i += 3) {
                    const vx = positions[i], vy = positions[i + 1], vz = positions[i + 2];
                    positions[i]     = r[0] * vx + r[3] * vy + r[6] * vz + ox;
                    positions[i + 1] = r[1] * vx + r[4] * vy + r[7] * vz + oy;
                    positions[i + 2] = r[2] * vx + r[5] * vy + r[8] * vz + oz;
                }
                mesh.setPositions(positions);
            }

            // Transform normals: rot × n (no offset for normals)
            try {
                const normals = [];
                mesh.getNormals(normals);
                if (normals.length) {
                    for (let i = 0; i < normals.length; i += 3) {
                        const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
                        normals[i]     = r[0] * nx + r[3] * ny + r[6] * nz;
                        normals[i + 1] = r[1] * nx + r[4] * ny + r[7] * nz;
                        normals[i + 2] = r[2] * nx + r[5] * ny + r[8] * nz;
                    }
                    mesh.setNormals(normals);
                }
            } catch (_) { /* normals not available */ }

            mesh.update();

            // Disable frustum culling — AABB is stale after vertex transform
            mi.cull = false;
        }
    }

    /** Re-apply tileScale without re-downloading everything. */
    _rebuildTransforms() {
        const s = this.tileScale;
        for (const { container } of this._loadedTiles.values()) {
            const d = container._cesiumTileData;
            if (!d) continue;
            container.setLocalPosition(d.pos.x * s, d.pos.y * s, d.pos.z * s);
            container.setLocalScale(s, s, s);
        }
    }

    // ────────────────────────────────────────────
    // b3dm parser
    // ────────────────────────────────────────────

    /**
     * Parse a Batched 3D Model file.
     * Header: 28 bytes (magic + version + lengths), then feature/batch tables,
     * then the embedded GLB.
     */
    static parseB3dm(buffer) {
        const v = new DataView(buffer);
        const magic = String.fromCharCode(
            v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)
        );
        if (magic !== "b3dm") throw new Error("Not a b3dm file: " + magic);

        const ftJsonLen = v.getUint32(12, true);
        const ftBinLen = v.getUint32(16, true);
        const btJsonLen = v.getUint32(20, true);
        const btBinLen = v.getUint32(24, true);

        // Parse feature table JSON for RTC_CENTER
        let rtcCenter = null;
        if (ftJsonLen > 0) {
            try {
                const bytes = new Uint8Array(buffer, 28, ftJsonLen);
                const json = JSON.parse(new TextDecoder().decode(bytes));
                if (json.RTC_CENTER) rtcCenter = json.RTC_CENTER;
            } catch (_) { /* ignore parse errors */ }
        }

        // Extract embedded GLB (everything after the tables)
        const glbOffset = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen;
        const glbData = buffer.slice(glbOffset);

        return { glbData, rtcCenter };
    }

    // ────────────────────────────────────────────
    // WGS84 / ECEF coordinate math
    // ────────────────────────────────────────────

    /** Convert geodetic (lat/lon in degrees, alt in meters) to ECEF XYZ. */
    static geodeticToECEF(latDeg, lonDeg, alt) {
        const lat = latDeg * Math.PI / 180;
        const lon = lonDeg * Math.PI / 180;
        const sLat = Math.sin(lat), cLat = Math.cos(lat);
        const sLon = Math.sin(lon), cLon = Math.cos(lon);
        const N = CesiumTiles.A / Math.sqrt(1 - CesiumTiles.E2 * sLat * sLat);
        return {
            x: (N + alt) * cLat * cLon,
            y: (N + alt) * cLat * sLon,
            z: (N * (1 - CesiumTiles.E2) + alt) * sLat,
        };
    }

    /**
     * Build a 4x4 column-major matrix that converts ECEF coordinates to a
     * local PlayCanvas coordinate system centered at the given lat/lon.
     *
     * The local frame maps:
     *   East  -> PlayCanvas +X
     *   Up    -> PlayCanvas +Y
     *   South -> PlayCanvas +Z  (so North is -Z / "into the screen")
     */
    static buildEcefToLocal(latDeg, lonDeg) {
        const lat = latDeg * Math.PI / 180;
        const lon = lonDeg * Math.PI / 180;
        const sLat = Math.sin(lat), cLat = Math.cos(lat);
        const sLon = Math.sin(lon), cLon = Math.cos(lon);
        const origin = CesiumTiles.geodeticToECEF(latDeg, lonDeg, 0);

        // Rotation from ECEF to PlayCanvas-local (ENU with Y-up):
        //   Row 0 (PC X = East):    [-sLon,       cLon,        0    ]
        //   Row 1 (PC Y = Up):      [ cLon*cLat,  sLon*cLat,   sLat ]
        //   Row 2 (PC Z = -North):  [ cLon*sLat,  sLon*sLat,  -cLat ]
        //
        // Stored column-major: m[col*4 + row]
        const m = new Float64Array(16);

        // Column 0 (ECEF X → local)
        m[0] = -sLon;
        m[1] = cLon * cLat;
        m[2] = cLon * sLat;
        m[3] = 0;

        // Column 1 (ECEF Y → local)
        m[4] = cLon;
        m[5] = sLon * cLat;
        m[6] = sLon * sLat;
        m[7] = 0;

        // Column 2 (ECEF Z → local)
        m[8] = 0;
        m[9] = sLat;
        m[10] = -cLat;
        m[11] = 0;

        // Column 3 (translation): R × (-origin)
        const ox = -origin.x, oy = -origin.y, oz = -origin.z;
        m[12] = m[0] * ox + m[4] * oy + m[8] * oz;
        m[13] = m[1] * ox + m[5] * oy + m[9] * oz;
        m[14] = m[2] * ox + m[6] * oy + m[10] * oz;
        m[15] = 1;

        return m;
    }

    // ────────────────────────────────────────────
    // 4x4 matrix helpers (column-major Float64Array)
    // ────────────────────────────────────────────

    static identity4() {
        return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }

    static translationMat4(tx, ty, tz) {
        return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]);
    }

    static isIdentityLikeMat4(m, eps = 1e-6) {
        const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        for (let i = 0; i < 16; i++) {
            if (Math.abs(m[i] - id[i]) > eps) return false;
        }
        return true;
    }

    static rotateVec3ByQuatInverse(v, q) {
        const ux = -q.x, uy = -q.y, uz = -q.z, s = q.w;
        const dot = ux * v.x + uy * v.y + uz * v.z;
        const crossX = uy * v.z - uz * v.y;
        const crossY = uz * v.x - ux * v.z;
        const crossZ = ux * v.y - uy * v.x;
        const uu = ux * ux + uy * uy + uz * uz;
        return {
            x: 2 * dot * ux + (s * s - uu) * v.x + 2 * s * crossX,
            y: 2 * dot * uy + (s * s - uu) * v.y + 2 * s * crossY,
            z: 2 * dot * uz + (s * s - uu) * v.z + 2 * s * crossZ,
        };
    }

    /** Multiply two 4x4 column-major matrices: result = a * b */
    static mat4Mul(a, b) {
        const r = new Float64Array(16);
        for (let c = 0; c < 4; c++) {
            const c4 = c * 4;
            for (let row = 0; row < 4; row++) {
                r[c4 + row] =
                    a[row] * b[c4] +
                    a[4 + row] * b[c4 + 1] +
                    a[8 + row] * b[c4 + 2] +
                    a[12 + row] * b[c4 + 3];
            }
        }
        return r;
    }

    /** Multiply two 3×3 column-major matrices: result = a × b */
    static mat3Mul(a, b) {
        const r = new Array(9);
        for (let c = 0; c < 3; c++) {
            const c3 = c * 3;
            for (let row = 0; row < 3; row++) {
                r[c3 + row] =
                    a[row] * b[c3] +
                    a[3 + row] * b[c3 + 1] +
                    a[6 + row] * b[c3 + 2];
            }
        }
        return r;
    }

    static xformVector(m, x, y, z) {
        return {
            x: m[0] * x + m[4] * y + m[8] * z,
            y: m[1] * x + m[5] * y + m[9] * z,
            z: m[2] * x + m[6] * y + m[10] * z,
        };
    }

    static xformVectorLength(m, x, y, z) {
        const v = CesiumTiles.xformVector(m, x, y, z);
        return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }

    static maxLinearScale(m) {
        return Math.max(
            CesiumTiles.xformVectorLength(m, 1, 0, 0),
            CesiumTiles.xformVectorLength(m, 0, 1, 0),
            CesiumTiles.xformVectorLength(m, 0, 0, 1)
        );
    }

    _heapPush(heap, item) {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent].priority >= heap[i].priority) break;
            [heap[parent], heap[i]] = [heap[i], heap[parent]];
            i = parent;
        }
    }

    _heapPop(heap) {
        if (heap.length === 0) return null;
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            while (true) {
                const left = i * 2 + 1;
                const right = left + 1;
                let largest = i;

                if (left < heap.length && heap[left].priority > heap[largest].priority) {
                    largest = left;
                }
                if (right < heap.length && heap[right].priority > heap[largest].priority) {
                    largest = right;
                }
                if (largest === i) break;
                [heap[i], heap[largest]] = [heap[largest], heap[i]];
                i = largest;
            }
        }
        return top;
    }

    /** Transform a 3D point by a 4x4 matrix (w=1). */
    static xformPoint(m, x, y, z) {
        return {
            x: m[0] * x + m[4] * y + m[8] * z + m[12],
            y: m[1] * x + m[5] * y + m[9] * z + m[13],
            z: m[2] * x + m[6] * y + m[10] * z + m[14],
        };
    }

    /** Euclidean distance between two {x,y,z} points. */
    static dist3(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // ────────────────────────────────────────────
    // Cleanup
    // ────────────────────────────────────────────

    _cleanup() {
        for (const id of Array.from(this._loadedTiles.keys())) {
            this._unloadTile(id);
        }
        this._loadedTiles.clear();
        this._pendingTiles.clear();
        this._loadQueue = [];
        this._wantedTileIds = new Set();
        this._externalTilesets.clear();
        this._loadedCount = 0;
        this._activeLoads = 0;
        this._selectionDirty = false;
        this._selectionRunning = false;
        this._selectionTimer = 0;
        this._lastCameraLocal = null;
        this._rootContext = null;
        this._ecefToLocal = null;
    }
}
