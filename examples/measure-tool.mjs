/**
 * Measure Tool — distances, paths, areas and heights on whatever the player sees.
 *
 * Turn it on, then click points on the splat, a mesh or any vibe object. A disc under the pointer
 * shows where the next point lands and which way the surface faces; like the lines, it is hidden by
 * whatever is in front of it.
 * Drag a point to move it, Delete removes the point under the pointer.
 * - Distance: two points.
 * - Path: any number of points, total length along them (Enter, "Finish" or clicking the last point ends it).
 * - Area: a closed outline, its surface area (Enter, "Finish" or clicking the first point closes it).
 * - Height: two points, vertical difference, horizontal distance and slope.
 * Clicking near an existing point snaps to it. Backspace removes the last point (or the last
 * measurement), Esc drops the current measurement.
 * Lengths are real meters at the avatar's scale (the space's world scale), so a splat measures true only
 * when it is scaled to the avatar.
 *
 * The lines are scene geometry, not an overlay: the avatar and meshes hide them, splats in front
 * fade them by their own opacity, and a faint copy drawn over everything keeps hidden parts visible.
 *
 * Features demonstrated:
 * - ArrivalSpace.raycastSplats: where the color under the pointer comes from in the splats - the
 *   middle of the layer of faint Gaussians a splat surface is made of, not its front
 * - ArrivalSpace.raycastScreen: meshes and vibe objects in front of the splats
 * - screen-space-wide lines as a dynamic mesh, drawn once depth-tested ("World") and once on top ("Gizmo")
 * - ArrivalSpace.disableClickToWalk: clicks place points instead of walking the player
 * - lockInput while dragging, telling a click from a camera drag (press and release within 4 px)
 *
 * Requires ArrivalSpace.VERSION >= 1.20.0. Before 1.30.0 (no raycastSplats) it steadies raycastScreen
 * over a small window of picks and fits a plane to them; before 1.29.0 that is one pixel per pick.
 */

/// Gaussians fainter than this are seen through. The scene's 0.3 sees through much of a dense
/// capture that the player sees as solid; 0.1 finds coherent surfaces.
const PICK = { minSplatOpacity: 0.1 };
const WINDOW = 3;           // samples on each side of the pointer: a 7 x 7 grid
const STEP = 2;             // CSS pixels between samples
const NORMAL_PX = 10;       // CSS pixels to the neighbours that give the surface's direction
const CURSOR_PX = 16;       // cursor disc radius
const SNAP_PX = 12;         // a click this close to an existing point reuses it
const HOVER_MS = 100;       // least time between the cursor's picks
const LINE_PX = 2.5;        // line width
const EDGE_PX = 1.25;       // dark edge on each side of a line
const POINT_PX = 5;         // point radius
const XRAY_OPACITY = 0.35;  // the copy drawn over everything, where the scene hides a line
const LIFT = 0.02;          // geometry moves this fraction of its distance toward the camera,
                            // so the grainy surface a line lies on does not swallow it

export class MeasureTool extends ArrivalScript {
    static scriptName = "Measure Tool";

    units = "metric";
    color = "#ffd23f";

    static properties = {
        units: {
            title: "Units",
            options: [
                { label: "Meters", value: "metric" },
                { label: "Feet", value: "imperial" },
            ],
        },
        color: { title: "Line Color" },
    };

    _active = false;
    _mode = "distance";
    _points = [];       // the measurement being placed: pc.Vec3[]
    _done = [];         // finished: { mode, points }
    _cursor = null;     // where a click would land: { point, normal, snap }
    _pointer = null;    // last pointer position over the canvas
    _hoverBusy = false;
    _pickedAt = 0;
    _down = null;
    _drag = null;       // a grabbed point: { point, moved }
    _releaseWalk = null;
    _viewKey = "";

    initialize() {
        if (!ArrivalSpace.raycastScreen) {
            this.warn("Measure Tool needs ArrivalSpace.VERSION >= 1.20.0 (raycastScreen)");
            return;
        }
        const [major, minor] = String(ArrivalSpace.VERSION).split(".").map(Number);
        this._window = major > 1 || minor >= 29 ? WINDOW : 0;
        this._buildUI();
        this._buildMesh();
        this._canvas = this.app.graphicsDevice.canvas;
        this._onDown = (e) => this._onPointerDown(e);
        this._onUp = (e) => this._onPointerUp(e);
        this._onMove = (e) => this._onPointerMove(e);
        this._onLeave = () => { this._pointer = null; this._cursor = null; };
        this._onKey = (e) => this._onKeyDown(e);
        this._canvas.addEventListener("pointerdown", this._onDown);
        this._canvas.addEventListener("pointerup", this._onUp);
        this._canvas.addEventListener("pointercancel", this._onUp);
        this._canvas.addEventListener("pointermove", this._onMove);
        this._canvas.addEventListener("pointerleave", this._onLeave);
        window.addEventListener("keydown", this._onKey);
    }

    onPropertyChanged() {
        this._renderToolbar();
    }

    destroy() {
        this._setActive(false);
        this._canvas?.removeEventListener("pointerdown", this._onDown);
        this._canvas?.removeEventListener("pointerup", this._onUp);
        this._canvas?.removeEventListener("pointercancel", this._onUp);
        this._canvas?.removeEventListener("pointermove", this._onMove);
        this._canvas?.removeEventListener("pointerleave", this._onLeave);
        window.removeEventListener("keydown", this._onKey);
    }

    // -- Input --

    _setActive(on) {
        this._active = on;
        if (on && !this._releaseWalk) this._releaseWalk = ArrivalSpace.disableClickToWalk();
        if (!on) {
            this._releaseWalk?.();
            this._releaseWalk = null;
            this._points = [];
            this._cursor = null;
            this._endDrag();
            if (this._canvas) this._canvas.style.cursor = "";
        }
        this._renderToolbar();
    }

    _endDrag() {
        if (!this._drag) return;
        this._drag = null;
        this.unlockInput();
    }

    /** Canvas-relative CSS pixels - what raycastScreen expects. */
    _screen(e) {
        const r = this._canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _onPointerDown(e) {
        this._down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
        if (!this._active || !this._down) return;
        const point = this._pointNear(this._screen(e));
        if (!point) return;
        // pressing a point grabs it: the camera stays still while it is dragged
        this._drag = { point, moved: false };
        this._canvas.setPointerCapture(e.pointerId);
        this.lockInput();
    }

    async _onPointerUp(e) {
        const down = this._down, drag = this._drag;
        this._down = null;
        const { x, y } = this._screen(e);
        if (drag) {
            this._endDrag();
            if (drag.moved) {
                const target = await this._target(x, y, drag.point);
                if (target) drag.point.copy(target.point);
                return;
            }
        }
        if (!this._active || !down || e.type === "pointercancel") return;
        // a drag orbits the camera - only a short press without movement places a point
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || performance.now() - down.t > 500) return;
        const pts = this._points;
        const target = await this._target(x, y);
        // sky - nothing to measure; or the measurement was finished, dropped or switched meanwhile
        if (!target || pts !== this._points) return;
        // clicking the first point closes an area, clicking the last one ends a path
        const closes = this._mode === "area" && pts.length >= 3 && target.point === pts[0];
        const ends = this._mode === "path" && pts.length >= 2 && target.point === pts[pts.length - 1];
        if (closes || ends) this._finish();
        else {
            pts.push(target.point.clone());
            const two = this._mode === "distance" || this._mode === "height";
            if (two && pts.length === 2) this._finish();
        }
        this._renderToolbar();
    }

    _onPointerMove(e) {
        if (!this._active) return;
        this._pointer = this._screen(e);
        const down = this._down;
        if (this._drag && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) this._drag.moved = true;
        this._trackPointer();
    }

    /**
     * Keep the cursor disc on the surface under the pointer - and a grabbed point with it - one
     * pick in flight at a time.
     */
    async _trackPointer() {
        if (this._hoverBusy) return;
        this._hoverBusy = true;
        while (this._active && this._pointer) {
            // a pick renders the scene once more and walks the splats under the pointer: at most
            // HOVER_MS apart, the cursor slides along the last surface in between
            const wait = this._pickedAt + HOVER_MS - performance.now();
            if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
            this._pickedAt = performance.now();
            if (!this._active || !this._pointer) break;
            const at = this._pointer;
            const target = await this._target(at.x, at.y, this._drag?.point);
            if (!this._active || !this._pointer) break;   // left the canvas meanwhile
            // a late pick is still the best surface known; pick again if the pointer moved on
            this._cursor = target;
            if (this._drag?.moved && target) this._drag.point.copy(target.point);
            if (this._pointer === at) break;
        }
        this._hoverBusy = false;
    }

    _onKeyDown(e) {
        if (!this._active || e.target?.closest?.("input, textarea, [contenteditable]")) return;
        if (e.key === "Escape") this._points = [];
        else if (e.key === "Backspace") {
            if (this._points.length) this._points.pop();
            else this._done.pop();
        } else if (e.key === "Delete") {
            if (!this._removePoint(this._pointer && this._pointNear(this._pointer))) return;
        } else if (e.key === "Enter") this._finish();
        else return;
        e.preventDefault();
        this._renderToolbar();
    }

    /** Remove a point; a finished measurement left with too few points goes with it. */
    _removePoint(point) {
        if (!point) return false;
        for (const m of this._measurements()) {
            const i = m.points.indexOf(point);
            if (i < 0) continue;
            m.points.splice(i, 1);
            if (m.points !== this._points && m.points.length < (m.mode === "area" ? 3 : 2)) this._done.splice(this._done.indexOf(m), 1);
            this._cursor = null;
            return true;
        }
        return false;
    }

    _finish() {
        const min = this._mode === "area" ? 3 : 2;
        if (this._points.length >= min) this._done.push({ mode: this._mode, points: this._points });
        this._points = [];
    }

    // -- Picking --

    /** Where a click at (x, y) lands: an existing point within SNAP_PX (other than `exclude`), else the surface. */
    async _target(x, y, exclude = null) {
        const camera = ArrivalSpace.getCamera()?.camera;
        if (!camera) return null;
        const point = this._pointNear({ x, y }, exclude);
        if (point) return { point, normal: null, snap: true };
        return ArrivalSpace.raycastSplats ? this._colorSurfaceAt(camera, x, y) : this._surfaceAt(camera, x, y);
    }

    /**
     * The surface under (x, y) where the color comes from: raycastSplats at the pointer, and at four
     * neighbours for the way the surface faces. A mesh or vibe object in front of the splats
     * (raycastScreen) wins at each of them.
     */
    async _colorSurfaceAt(camera, x, y) {
        const at = [[x, y], [x - NORMAL_PX, y], [x + NORMAL_PX, y], [x, y - NORMAL_PX], [x, y + NORMAL_PX]];
        const [splats, picks] = await Promise.all([
            Promise.all(at.map(([px, py]) => ArrivalSpace.raycastSplats(px, py))),
            Promise.all(at.map(([px, py]) => ArrivalSpace.raycastScreen(px, py))),
        ]);
        const [p, left, right, up, down] = at.map((_, k) => {
            const s = splats[k], h = picks[k];
            return h && !h.isSplat && (!s || h.distance < s.distance) ? h.point : s?.point ?? null;
        });
        if (!p) return null;
        const toCamera = new pc.Vec3().sub2(camera.entity.getPosition(), p).normalize();
        let normal = toCamera;
        if (left && right && up && down) {
            const n = new pc.Vec3().cross(new pc.Vec3().sub2(right, left), new pc.Vec3().sub2(down, up));
            if (n.lengthSq() > 1e-12) normal = n.normalize().mulScalar(n.dot(toCamera) < 0 ? -1 : 1);
        }
        return { point: p.clone(), normal, snap: false };
    }

    /** The existing point drawn closest to a screen position, within SNAP_PX. */
    _pointNear({ x, y }, exclude = null) {
        const camera = ArrivalSpace.getCamera()?.camera;
        if (!camera) return null;
        let best = null, bestPx = SNAP_PX;
        for (const m of this._measurements()) {
            for (const p of m.points) {
                const s = camera.worldToScreen(p, new pc.Vec3());
                const px = s.z > 0 && p !== exclude ? Math.hypot(s.x - x, s.y - y) : Infinity;
                if (px < bestPx) { best = p; bestPx = px; }
            }
        }
        return best;
    }

    /**
     * The surface under (x, y), steadied over a small window of picks: a single splat pixel is
     * whichever Gaussian is in front there, so neighbouring pixels jump in depth. Keeps the
     * surface under the pointer unless it is a lone speck, fits a plane to its samples and
     * returns where the pointer ray meets that plane, with the plane's normal.
     */
    async _surfaceAt(camera, x, y) {
        const r = this._window, n = 2 * r + 1;
        const picks = [];
        for (let j = -r; j <= r; j++) {
            for (let i = -r; i <= r; i++) picks.push(ArrivalSpace.raycastScreen(x + i * STEP, y + j * STEP, PICK));
        }
        const hits = await Promise.all(picks);
        const found = hits.filter(Boolean);
        if (!found.length) return null;

        const near = (h, d) => Math.abs(h.distance - d) <= 0.04 * d + 0.02;
        const support = (d) => found.reduce((sum, h) => sum + (near(h, d) ? 1 : 0), 0);
        const center = hits[(n * n - 1) / 2];
        let seed = center;
        if (!center || support(center.distance) < found.length / 4) {
            seed = found.reduce((a, b) => (support(b.distance) > support(a.distance) ? b : a));
            // pointer on the sky: only snap onto a surface that fills most of the window
            if (!center && support(seed.distance) < hits.length / 2) return null;
        }
        const surface = hits.map((h) => (h && near(h, seed.distance) ? h.point : null));

        const result = (point, normal) => ({ point, normal, snap: false });

        // area-weighted normal from neighbouring samples, facing the camera
        const camPos = camera.entity.getPosition();
        const normal = new pc.Vec3(), du = new pc.Vec3(), dv = new pc.Vec3(), c = new pc.Vec3();
        for (let j = 0; j < n - 1; j++) {
            for (let i = 0; i < n - 1; i++) {
                const p = surface[j * n + i], pu = surface[j * n + i + 1], pv = surface[(j + 1) * n + i];
                if (p && pu && pv) normal.add(c.cross(du.sub2(pu, p), dv.sub2(pv, p)));
            }
        }
        const inliers = surface.filter(Boolean);
        const centroid = inliers.reduce((s, p) => s.add(p), new pc.Vec3()).mulScalar(1 / inliers.length);
        if (normal.lengthSq() < 1e-12) return result(seed.point.clone(), c.sub2(camPos, seed.point).normalize());
        normal.normalize();
        if (normal.dot(c.sub2(camPos, centroid)) < 0) normal.mulScalar(-1);

        // the pointer ray against that plane, unless it grazes the plane or leaves the samples
        const dir = camera.screenToWorld(x, y, 1, new pc.Vec3()).sub(camPos).normalize();
        const facing = dir.dot(normal);
        const spread = inliers.reduce((m, p) => Math.max(m, p.distance(centroid)), 0);
        if (facing < -0.15) {
            const t = c.sub2(centroid, camPos).dot(normal) / facing;
            const point = dir.clone().mulScalar(t).add(camPos);
            if (point.distance(centroid) <= 2 * spread + 0.01) return result(point, normal);
        }
        return result((center && near(center, seed.distance) ? center : seed).point.clone(), normal);
    }

    // -- Math --

    _length(points) {
        let sum = 0;
        for (let i = 1; i < points.length; i++) sum += points[i].distance(points[i - 1]);
        return sum;
    }

    /** Newell's method: the area of a (nearly) planar outline in 3D, in any orientation. */
    _area(points) {
        const n = new pc.Vec3();
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            n.x += (a.y - b.y) * (a.z + b.z);
            n.y += (a.z - b.z) * (a.x + b.x);
            n.z += (a.x - b.x) * (a.y + b.y);
        }
        return n.length() / 2;
    }

    // World scale: a real 1 m is this many scene units (1 in new spaces, 0.7 in spaces from before the setting).
    get _unitsPerMeter() {
        const s = Number(this.app.worldScale);
        return s > 0 ? s : 0.7;
    }

    /** Scene units → text in the chosen units. */
    _len(units) {
        const m = units / this._unitsPerMeter;
        if (this.units === "imperial") {
            const inches = m / 0.0254;
            return inches < 12 ? `${inches.toFixed(1)} in` : `${Math.floor(inches / 12)} ft ${Math.round(inches % 12)} in`;
        }
        return m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`;
    }

    _sq(units2) {
        const m2 = units2 / this._unitsPerMeter ** 2;
        return this.units === "imperial" ? `${(m2 / 0.092903).toFixed(1)} ft²` : `${m2.toFixed(2)} m²`;
    }

    /** Label text and anchor point for a measurement. */
    _labels(mode, points) {
        const labels = [];
        if (mode === "path") {
            for (let i = 1; i < points.length; i++) labels.push({ at: new pc.Vec3().lerp(points[i - 1], points[i], 0.5), text: this._len(points[i].distance(points[i - 1])) });
            if (points.length > 2) labels.push({ at: points[points.length - 1], text: `Σ ${this._len(this._length(points))}`, strong: true });
        } else if (mode === "area" && points.length >= 3) {
            const c = points.reduce((s, p) => s.add(p), new pc.Vec3()).mulScalar(1 / points.length);
            labels.push({ at: c, text: this._sq(this._area(points)), strong: true });
        } else if (mode === "height" && points.length === 2) {
            const [a, b] = points;
            const dy = b.y - a.y, flat = Math.hypot(b.x - a.x, b.z - a.z);
            const slope = flat > 1e-3 ? ` · ${(Math.abs(dy) / flat * 100).toFixed(0)} %` : "";
            labels.push({ at: new pc.Vec3().lerp(a, b, 0.5), text: `↕ ${this._len(Math.abs(dy))} · ↔ ${this._len(flat)}${slope}`, strong: true });
        } else if (points.length === 2) {
            labels.push({ at: new pc.Vec3().lerp(points[0], points[1], 0.5), text: this._len(points[0].distance(points[1])), strong: true });
        }
        return labels;
    }

    /** Finished measurements plus the one being placed. */
    _measurements() {
        const all = [...this._done];
        if (this._active && this._points.length) all.push({ mode: this._mode, points: this._points });
        return all;
    }

    /** Line segments of a measurement; an area outline is closed. */
    _segments(mode, points) {
        const segs = [];
        for (let i = 1; i < points.length; i++) segs.push([points[i - 1], points[i]]);
        if (mode === "area" && points.length >= 3) segs.push([points[points.length - 1], points[0]]);
        return segs;
    }

    // -- Drawing --

    _buildUI() {
        this._labelLayer = this.createUI("div", {
            interactive: false,
            style: { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "5" },
        });

        this._toolbar = this.createUI("div", {
            style: {
                position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
                display: "flex", gap: "6px", padding: "6px", borderRadius: "12px",
                background: "#202020cc", font: "13px system-ui, sans-serif", color: "white", zIndex: "6",
            },
        });
        this._toolbar.addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b) return;
            const a = b.dataset.action;
            if (a === "toggle") this._setActive(!this._active);
            else if (a === "mode") { this._mode = b.dataset.mode; this._points = []; }
            else if (a === "finish") this._finish();
            else if (a === "clear") { this._done = []; this._points = []; }
            this._renderToolbar();
        });
        this._renderToolbar();
    }

    _renderToolbar() {
        if (!this._toolbar) return;
        const btn = (label, attrs, on) =>
            `<button ${attrs} style="border:0;border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;` +
            `background:${on ? this.color : "#ffffff22"};color:${on ? "#111" : "white"}">${label}</button>`;
        if (!this._active) {
            this._toolbar.innerHTML = btn("📏 Measure", 'data-action="toggle"', false);
            return;
        }
        const modes = [["distance", "Distance"], ["path", "Path"], ["area", "Area"], ["height", "Height"]];
        const multi = this._mode === "path" || this._mode === "area";
        this._toolbar.innerHTML =
            modes.map(([m, label]) => btn(label, `data-action="mode" data-mode="${m}"`, this._mode === m)).join("") +
            (multi ? btn("Finish", 'data-action="finish"', false) : "") +
            btn("Clear", 'data-action="clear"', false) +
            btn("✕", 'data-action="toggle"', false);
    }

    /**
     * Two dynamic meshes for the lines and points: one depth-tested and opaque among the scene's
     * meshes (splats drawn later blend over it), with dark edges; one faint on top of everything,
     * colour only - its edges would darken the visible lines too.
     */
    _buildMesh() {
        this._layers = [["World", false], ["Gizmo", true]].map(([layerName, xray]) => {
            // a mesh instance takes its vertex-colour shader variant from the mesh it starts with
            const mesh = new pc.Mesh(this.app.graphicsDevice);
            mesh.clear(true, true);
            mesh.setPositions([0, 0, 0, 0, 0, 0, 0, 0, 0]);
            mesh.setColors32([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            mesh.setIndices([0, 1, 2]);
            mesh.update(pc.PRIMITIVE_TRIANGLES);
            const material = new pc.StandardMaterial();
            material.useLighting = false;
            material.useSkybox = false;
            material.useFog = false;
            material.diffuse = pc.Color.BLACK;
            material.emissive = pc.Color.WHITE;
            material.emissiveVertexColor = true;
            material.cull = pc.CULLFACE_NONE;
            if (xray) {
                material.depthTest = false;
                material.depthWrite = false;
                material.blendType = pc.BLEND_NORMAL;
                material.opacity = XRAY_OPACITY;
            }
            material.update();
            const mi = new pc.MeshInstance(mesh, material);
            mi.cull = false;
            // picks see through the tool's own lines and cursor - else the cursor, lifted toward the
            // camera, becomes the surface the next pick finds and creeps off into the air
            mi.pick = false;
            const entity = new pc.Entity(`Measure Lines (${layerName})`);
            entity.addComponent("render", {
                meshInstances: [mi],
                layers: [this.app.scene.layers.getLayerByName(layerName).id],
                castShadows: false,
                receiveShadows: false,
            });
            this.entity.addChild(entity);
            return { entity, mesh };
        });
    }

    /** Rebuild the line meshes for the current view: ribbons and discs a fixed number of pixels wide. */
    _updateMesh(camera, measurements, preview, cursor) {
        const camPos = camera.entity.getPosition();
        const right = camera.entity.right, up = camera.entity.up;
        // world units per CSS pixel at a point, along the camera's fov axis
        const span = camera.horizontalFov ? this._canvas.clientWidth : this._canvas.clientHeight;
        const perPx = 2 * Math.tan(camera.fov * Math.PI / 360) / span;
        const toLocal = this._layers[0].entity.getWorldTransform().clone().invert();
        const [solid, xray] = this._layers.map(() => ({ positions: [], colors: [], indices: [] }));
        // vertex colours are linear; the property is an sRGB hex like the overlay's
        const lineRgb = new pc.Color().fromString(this.color);
        const color = [lineRgb.r, lineRgb.g, lineRgb.b].map((c) => 255 * c ** 2.2).concat(255), dark = [3, 3, 3, 255];
        const toCam = new pc.Vec3(), side = new pc.Vec3(), dir = new pc.Vec3(), v = new pc.Vec3();

        const vertex = (to, p, offset, px, lift, c) => {
            const d = toCam.sub2(camPos, p).length();
            toCam.mulScalar(1 / d);
            v.copy(p).add(offset.clone().mulScalar(px * perPx * d)).add(toCam.mulScalar(lift * d));
            toLocal.transformPoint(v, v);
            for (const t of to) {
                t.positions.push(v.x, v.y, v.z);
                t.colors.push(...c);
            }
        };
        // a ribbon facing the camera; the colour sits a hair in front of its dark edge
        const ribbon = (to, a, b, px, lift, c) => {
            const first = to.map((t) => t.positions.length / 3);
            dir.sub2(b, a).normalize();
            for (const p of [a, b]) {
                side.cross(dir, toCam.sub2(camPos, p)).normalize();
                vertex(to, p, side, px, lift, c);
                vertex(to, p, side, -px, lift, c);
            }
            to.forEach((t, k) => { const i = first[k]; t.indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); });
        };
        const line = (a, b, px = LINE_PX, edge = EDGE_PX) => {
            if (edge) ribbon([solid], a, b, px / 2 + edge, LIFT, dark);
            ribbon([solid, xray], a, b, px / 2, LIFT * 1.05, color);
        };
        const dashed = (a, b) => {
            const sa = camera.worldToScreen(a, new pc.Vec3()), sb = camera.worldToScreen(b, new pc.Vec3());
            const n = Math.max(1, Math.round(Math.hypot(sa.x - sb.x, sa.y - sb.y) / 11));
            for (let i = 0; i < n; i++) line(new pc.Vec3().lerp(a, b, i / n), new pc.Vec3().lerp(a, b, (i + 0.55) / n));
        };
        const disc = (to, p, px, lift, c) => {
            const first = to.map((t) => t.positions.length / 3);
            vertex(to, p, pc.Vec3.ZERO, 0, lift, c);
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                vertex(to, p, new pc.Vec3().copy(right).mulScalar(Math.cos(a)).add(up.clone().mulScalar(Math.sin(a))), px, lift, c);
                to.forEach((t, k) => t.indices.push(first[k], first[k] + 1 + i, first[k] + 1 + ((i + 1) % 12)));
            }
        };

        for (const m of measurements) {
            for (const [a, b] of this._segments(m.mode, m.points)) line(a, b);
            for (const p of m.points) {
                disc([solid], p, POINT_PX + EDGE_PX, LIFT * 1.1, dark);
                disc([solid, xray], p, POINT_PX, LIFT * 1.15, color);
            }
        }
        if (preview) {
            dashed(this._points[this._points.length - 1], preview);
            if (this._mode === "area" && this._points.length >= 2) dashed(preview, this._points[0]);
        }

        if (cursor?.snap) {
            // a ring around the point a click would reuse
            const rr = 9 * perPx * cursor.point.distance(camPos);
            const at = (a) => cursor.point.clone().add(right.clone().mulScalar(Math.cos(a) * rr)).add(up.clone().mulScalar(Math.sin(a) * rr));
            for (let i = 0; i < 24; i++) line(at((i / 24) * Math.PI * 2), at(((i + 1) / 24) * Math.PI * 2), 2, 0.75);
        } else if (cursor) {
            // a disc lying on the surface, the cross marks the spot it hits, the pin shows which way
            // the surface faces
            const n = cursor.normal;
            const u = new pc.Vec3().cross(n, Math.abs(n.y) < 0.9 ? pc.Vec3.UP : pc.Vec3.RIGHT).normalize();
            const w = new pc.Vec3().cross(n, u);
            const r = CURSOR_PX * perPx * cursor.point.distance(camPos);
            const at = (cu, cw, cn = 0) => cursor.point.clone().add(u.clone().mulScalar(cu * r)).add(w.clone().mulScalar(cw * r)).add(n.clone().mulScalar(cn * r));
            for (let i = 0; i < 32; i++) {
                const a0 = (i / 32) * Math.PI * 2, a1 = ((i + 1) / 32) * Math.PI * 2;
                line(at(Math.cos(a0), Math.sin(a0)), at(Math.cos(a1), Math.sin(a1)), 1.5, 0.75);
            }
            line(at(-1, 0), at(1, 0), 1, 0.5);
            line(at(0, -1), at(0, 1), 1, 0.5);
            line(cursor.point, at(0, 0, 0.8), 2, 0.75);
            disc([solid, xray], cursor.point, 2.5, LIFT * 1.15, color);
        }

        [solid, xray].forEach((g, k) => {
            const { entity, mesh } = this._layers[k];
            entity.enabled = g.indices.length > 0;
            if (!g.indices.length) return;
            mesh.setPositions(g.positions);
            mesh.setColors32(g.colors);
            mesh.setIndices(g.indices);
            mesh.update(pc.PRIMITIVE_TRIANGLES);
        });
    }

    update() {
        if (!this._labelLayer) return;
        const camera = ArrivalSpace.getCamera()?.camera;
        if (!camera) return;
        // the disc is the pointer while it is on a surface; over the sky a crosshair stays
        const cursorStyle = !this._active ? "" : this._cursor ? "none" : "crosshair";
        if (this._canvas.style.cursor !== cursorStyle) this._canvas.style.cursor = cursorStyle;

        // a still pointer over a moving view: the surface under it changed
        const pos = camera.entity.getPosition(), rot = camera.entity.getRotation();
        const viewKey = [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z, rot.w].map((v) => v.toFixed(3)).join();
        if (viewKey !== this._viewKey) {
            this._viewKey = viewKey;
            if (this._pointer && this._active) this._trackPointer();
        }

        // picks land a few frames late: until the next one, slide the cursor along the surface it found
        const cursor = this._active ? this._predictCursor(camera) : null;
        if (cursor && this._drag?.moved && !cursor.snap) this._drag.point.copy(cursor.point);
        const measurements = this._measurements();
        const preview = this._active && this._points.length && cursor && !cursor.snap ? cursor.point : null;
        this._updateMesh(camera, measurements, preview, cursor);

        let html = "";
        const toScreen = (p) => {
            const s = camera.worldToScreen(p, new pc.Vec3());
            return s.z > 0 ? s : null;   // behind the camera
        };
        for (const m of measurements) {
            const points = preview && m.points === this._points ? [...m.points, preview] : m.points;
            for (const l of this._labels(m.mode, points)) {
                const s = toScreen(l.at);
                if (s) html += `<div style="position:absolute;left:${s.x}px;top:${s.y}px;transform:translate(-50%,-140%);padding:2px 7px;border-radius:6px;` +
                    `background:#111d;color:white;font:${l.strong ? 600 : 400} 12px system-ui,sans-serif;white-space:nowrap">${l.text}</div>`;
            }
        }
        if (this._labelLayer.innerHTML !== html) this._labelLayer.innerHTML = html;
    }

    /**
     * The cursor at the pointer's current position: where its ray meets the plane of the last
     * pick, while that stays close to the pick (on a steep or curved surface the next pick
     * corrects it).
     */
    _predictCursor(camera) {
        const cursor = this._cursor, at = this._pointer;
        if (!cursor || cursor.snap || !at) return cursor;
        const camPos = camera.entity.getPosition();
        const dir = camera.screenToWorld(at.x, at.y, 1, new pc.Vec3()).sub(camPos).normalize();
        const facing = dir.dot(cursor.normal);
        if (facing > -0.15) return cursor;
        const t = new pc.Vec3().sub2(cursor.point, camPos).dot(cursor.normal) / facing;
        const point = dir.mulScalar(t).add(camPos);
        if (point.distance(cursor.point) > 0.25 * point.distance(camPos)) return cursor;
        return { ...cursor, point };
    }
}
