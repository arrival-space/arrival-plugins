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
    maxTiles = 9;
    tileScale = 1.0;
    maxDepth = 20;

    static properties = {
        cesiumIonToken: { title: "Cesium Ion Token" },
        assetId: { title: "Asset ID" },
        latitude: { title: "Latitude", min: -90, max: 90 },
        longitude: { title: "Longitude", min: -180, max: 180 },
        maxTiles: { title: "Max Tiles", min: 1, max: 500 },
        tileScale: { title: "Scale", min: 0.001, max: 100 },
        maxDepth: { title: "Max Depth", min: 1, max: 50 },
    };

    // ── Internal state ──
    _containers = [];
    _blobUrls = [];
    _loading = false;
    _statusEl = null;
    _loadedCount = 0;

    // ── WGS84 ellipsoid ──
    static A = 6378137.0;
    static E2 = 0.00669437999014;

    // ────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────

    initialize() {
        if (!this.cesiumIonToken || !this.assetId) {
            this._status("Configure cesiumIonToken and assetId to begin");
            return;
        }
        this._streamTiles();
    }

    onPropertyChanged(name) {
        if (name === "tileScale") {
            this._rebuildTransforms();
            return;
        }
        if (this.cesiumIonToken && this.assetId) {
            this._streamTiles();
        }
    }

    destroy() {
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
        if (this._loading) return;
        this._loading = true;
        this._cleanup();

        try {
            // 1) Cesium Ion endpoint
            this._status("Authenticating with Cesium Ion...");
            const ep = await this._ionEndpoint();
            if (!ep) return;

            // Build unified fetch headers (Bearer token or external headers)
            const authHeaders = { ...ep.headers };
            if (ep.accessToken) {
                authHeaders["Authorization"] = `Bearer ${ep.accessToken}`;
            }

            // 2) Fetch tileset.json
            this._status("Fetching tileset.json...");
            const tileset = await this._fetchJson(ep.url, authHeaders);
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

            // 3) Target coordinate in ECEF
            const target = CesiumTiles.geodeticToECEF(this.latitude, this.longitude, 0);

            // 4) ECEF-to-local transform matrix
            const ecefToLocal = CesiumTiles.buildEcefToLocal(this.latitude, this.longitude);

            // 5) Traverse tile tree — pass full ep.url so query params
            //    (key, session, etc.) propagate to child URLs.
            this._status("Traversing tile tree...");
            const candidates = [];
            await this._traverse(
                tileset.root, CesiumTiles.identity4(), target,
                candidates, ep.url, authHeaders, 0, "REPLACE"
            );

            if (candidates.length === 0) {
                this._status("No tiles found near this coordinate");
                return;
            }

            // 6) Sort by distance, pick closest N
            candidates.sort((a, b) => a.distance - b.distance);
            const toLoad = candidates.slice(0, this.maxTiles);
            this._status(`Loading ${toLoad.length} of ${candidates.length} candidate tiles...`);

            // 7) Load tiles in parallel
            this._loadedCount = 0;
            const total = toLoad.length;
            const promises = toLoad.map((t) =>
                this._loadTile(t, ecefToLocal, authHeaders, total)
            );
            await Promise.all(promises);

            this._status(`Done: ${this._containers.length} tiles loaded`);
        } catch (err) {
            console.error("CesiumTiles:", err);
            this._status(`Error: ${err.message}`);
        } finally {
            this._loading = false;
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
    // Tile tree traversal
    // ────────────────────────────────────────────

    async _traverse(tile, parentXform, target, out, parentUrl, headers, depth, parentRefine) {
        if (depth > this.maxDepth) return;

        // Compose this tile's world transform
        const xform = tile.transform
            ? CesiumTiles.mat4Mul(parentXform, new Float64Array(tile.transform))
            : parentXform;

        // Spatial cull: skip branches far from target
        if (!this._tileNearTarget(tile, xform, target)) return;

        const refine = (tile.refine || parentRefine || "REPLACE").toUpperCase();
        const contentUri = tile.content?.uri || tile.content?.url;
        const hasChildren = tile.children && tile.children.length > 0;
        const isLeaf = !hasChildren || depth >= this.maxDepth;

        // Handle external tileset references (content pointing to another tileset.json)
        if (contentUri && this._isJsonUri(contentUri)) {
            try {
                const childUrl = this._resolveUrl(contentUri, parentUrl);
                const childSet = await this._fetchJson(childUrl, headers);
                if (childSet?.root) {
                    // Pass the child's full URL as parent — its query params
                    // (session, key, etc.) propagate to grandchild URLs.
                    await this._traverse(
                        childSet.root, xform, target, out,
                        childUrl, headers, depth, refine
                    );
                }
            } catch (e) {
                console.warn("CesiumTiles: external tileset failed:", contentUri, e.message);
            }
        }

        // Collect renderable content
        if (contentUri && !this._isJsonUri(contentUri)) {
            // For REPLACE refinement: only render leaf tiles (finest available LOD)
            // For ADD refinement: render all tiles with content
            if (refine === "ADD" || isLeaf) {
                const { distance, center } = this._tileCenterAndDistance(tile, xform, target);
                out.push({
                    uri: contentUri,
                    parentUrl,
                    transform: xform,
                    distance,
                    ecefCenter: center,
                    depth,
                });
            }
        }

        // Recurse into children
        if (hasChildren && depth < this.maxDepth) {
            for (const child of tile.children) {
                await this._traverse(
                    child, xform, target, out,
                    parentUrl, headers, depth + 1, refine
                );
            }
        }
    }

    _isJsonUri(uri) {
        return uri.split("?")[0].toLowerCase().endsWith(".json");
    }

    /**
     * Check if a tile's bounding volume is near the target ECEF point.
     * Returns false to prune the branch early when it's clearly too far.
     */
    _tileNearTarget(tile, xform, target) {
        const bv = tile.boundingVolume;
        if (!bv) return true;

        if (bv.region) {
            const [w, s, e, n] = bv.region;
            const latR = this.latitude * Math.PI / 180;
            const lonR = this.longitude * Math.PI / 180;
            // Pad the region check to include neighboring tiles
            const padLon = Math.max((e - w) * 2, 0.005);
            const padLat = Math.max((n - s) * 2, 0.005);
            return (
                lonR >= w - padLon && lonR <= e + padLon &&
                latR >= s - padLat && latR <= n + padLat
            );
        }

        if (bv.box) {
            const c = CesiumTiles.xformPoint(xform, bv.box[0], bv.box[1], bv.box[2]);
            const ha = bv.box.slice(3);
            // Approximate bounding sphere from half-axes
            const radius = Math.sqrt(
                ha[0] * ha[0] + ha[1] * ha[1] + ha[2] * ha[2] +
                ha[3] * ha[3] + ha[4] * ha[4] + ha[5] * ha[5] +
                ha[6] * ha[6] + ha[7] * ha[7] + ha[8] * ha[8]
            );
            const d = CesiumTiles.dist3(c, target);
            return d < radius * 5;
        }

        if (bv.sphere) {
            const c = CesiumTiles.xformPoint(xform, bv.sphere[0], bv.sphere[1], bv.sphere[2]);
            return CesiumTiles.dist3(c, target) < bv.sphere[3] * 5;
        }

        return true;
    }

    /** Distance and ECEF center of a tile's bounding volume. */
    _tileCenterAndDistance(tile, xform, target) {
        const bv = tile.boundingVolume;
        if (!bv) return { distance: Infinity, center: null };

        let c;
        if (bv.region) {
            const [w, s, e, n, h0, h1] = bv.region;
            c = CesiumTiles.geodeticToECEF(
                ((s + n) / 2) * 180 / Math.PI,
                ((w + e) / 2) * 180 / Math.PI,
                (h0 + h1) / 2
            );
        } else if (bv.box) {
            c = CesiumTiles.xformPoint(xform, bv.box[0], bv.box[1], bv.box[2]);
        } else if (bv.sphere) {
            c = CesiumTiles.xformPoint(xform, bv.sphere[0], bv.sphere[1], bv.sphere[2]);
        } else {
            return { distance: Infinity, center: null };
        }

        return { distance: CesiumTiles.dist3(c, target), center: c };
    }

    // ────────────────────────────────────────────
    // Tile loading
    // ────────────────────────────────────────────

    async _loadTile(info, ecefToLocal, headers, total) {
        try {
            const url = this._resolveUrl(info.uri, info.parentUrl);
            const buf = await this._fetchBuffer(url, headers);

            let glbData;
            let rtcCenter = null;
            const ext = info.uri.split("?")[0].split(".").pop().toLowerCase();

            if (ext === "b3dm") {
                const parsed = CesiumTiles.parseB3dm(buf);
                glbData = parsed.glbData;
                rtcCenter = parsed.rtcCenter;
            } else if (ext === "glb" || ext === "gltf") {
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

            let ecefCenter;
            const vertexOffset = { x: 0, y: 0, z: 0 };

            if (rtcCenter) {
                // b3dm RTC: vertices are relative to rtcCenter
                ecefCenter = CesiumTiles.xformPoint(
                    M, rtcCenter[0], rtcCenter[1], rtcCenter[2]
                );
            } else if (info.ecefCenter) {
                // Vertices are in local tile space (not absolute ECEF).
                // Only rotation is needed — no translation offset.
                ecefCenter = info.ecefCenter;
            } else {
                // Fallback: use tile transform origin
                ecefCenter = { x: M[12], y: M[13], z: M[14] };
            }

            // Entity position in local space (small values near origin)
            const entityPos = CesiumTiles.xformPoint(
                ecefToLocal, ecefCenter.x, ecefCenter.y, ecefCenter.z
            );
            const s = this.tileScale;

            // Create container — position + scale only, NO rotation
            const container = new pc.Entity(`CesiumTile_${this._containers.length}`);
            this.entity.addChild(container);
            container.setLocalPosition(entityPos.x * s, entityPos.y * s, entityPos.z * s);
            container.setLocalScale(s, s, s);
            container._cesiumTileData = { pos: entityPos };

            // Load GLB from blob URL
            const blob = new Blob([glbData], { type: "model/gltf-binary" });
            const blobUrl = URL.createObjectURL(blob);
            this._blobUrls.push(blobUrl);

            const { entity: tileEntity } = await ArrivalSpace.loadGLB(blobUrl, {
                parent: container,
                name: `TileMesh_${this._containers.length}`,
            });

            // Reset GLB internal ECEF node transforms.
            // Google 3D Tiles bakes ECEF position + Z-up→Y-up rotation into
            // GLB nodes. We strip these and handle positioning/rotation ourselves.
            this._resetGlbEcefNodes(tileEntity);

            // Transform vertex positions + normals on CPU
            this._transformMeshVertices(tileEntity, CR, vertexOffset);

            this._containers.push(container);
            this._loadedCount++;
            this._status(`Loading tiles: ${this._loadedCount}/${total}`);
        } catch (err) {
            console.error("CesiumTiles: tile load failed:", info.uri, err);
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
        for (const c of this._containers) {
            const d = c._cesiumTileData;
            if (!d) continue;
            c.setLocalPosition(d.pos.x * s, d.pos.y * s, d.pos.z * s);
            c.setLocalScale(s, s, s);
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
        for (const c of this._containers) {
            try { ArrivalSpace.disposeEntity(c, { destroyAssets: true }); } catch (_) {}
        }
        this._containers = [];

        for (const url of this._blobUrls) {
            try { URL.revokeObjectURL(url); } catch (_) {}
        }
        this._blobUrls = [];
        this._loadedCount = 0;
    }
}
