/**
 * Measure Tool — distances, paths, areas and heights on whatever the player sees.
 *
 * Turn it on, then click points on the splat, a mesh or any vibe object. Lines and labels
 * follow the points while the camera moves.
 * - Distance: two points.
 * - Path: any number of points, total length along them (Enter or "Finish" to end).
 * - Area: a closed outline, its surface area (Enter or "Finish" to close).
 * - Height: two points, vertical difference, horizontal distance and slope.
 * Backspace removes the last point, Esc drops the current measurement.
 *
 * Features demonstrated:
 * - ArrivalSpace.raycastScreen: the surface under the pointer, splats included, no colliders
 * - ArrivalSpace.disableClickToWalk: clicks place points instead of walking the player
 * - telling a click from a camera drag (press and release within 4 px)
 * - an HTML/SVG overlay that follows 3D points (camera.worldToScreen every frame)
 *
 * Requires ArrivalSpace.VERSION >= 1.20.0.
 */
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
    _hover = null;      // surface point under the pointer, for the preview line
    _hoverBusy = false;
    _down = null;
    _releaseWalk = null;

    initialize() {
        if (!ArrivalSpace.raycastScreen) {
            this.warn("Measure Tool needs ArrivalSpace.VERSION >= 1.20.0 (raycastScreen)");
            return;
        }
        this._buildUI();
        this._canvas = this.app.graphicsDevice.canvas;
        this._onDown = (e) => { this._down = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; };
        this._onUp = (e) => this._onPointerUp(e);
        this._onMove = (e) => this._onPointerMove(e);
        this._onKey = (e) => this._onKeyDown(e);
        this._canvas.addEventListener("pointerdown", this._onDown);
        this._canvas.addEventListener("pointerup", this._onUp);
        this._canvas.addEventListener("pointermove", this._onMove);
        window.addEventListener("keydown", this._onKey);
    }

    onPropertyChanged() {
        this._renderToolbar();
    }

    destroy() {
        this._setActive(false);
        this._canvas?.removeEventListener("pointerdown", this._onDown);
        this._canvas?.removeEventListener("pointerup", this._onUp);
        this._canvas?.removeEventListener("pointermove", this._onMove);
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
            this._hover = null;
        }
        this._renderToolbar();
    }

    /** Canvas-relative CSS pixels - what raycastScreen expects. */
    _screen(e) {
        const r = this._canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    async _onPointerUp(e) {
        const down = this._down;
        this._down = null;
        if (!this._active || !down) return;
        // a drag orbits the camera - only a short press without movement places a point
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || performance.now() - down.t > 500) return;
        const { x, y } = this._screen(e);
        const hit = await ArrivalSpace.raycastScreen(x, y);
        if (!hit) return;   // sky - nothing to measure
        this._points.push(hit.point.clone());
        const two = this._mode === "distance" || this._mode === "height";
        if (two && this._points.length === 2) this._finish();
        this._renderToolbar();
    }

    async _onPointerMove(e) {
        if (!this._active || !this._points.length || this._hoverBusy) return;
        // one pick in flight at a time keeps the preview at most a frame behind
        this._hoverBusy = true;
        const { x, y } = this._screen(e);
        const hit = await ArrivalSpace.raycastScreen(x, y);
        this._hover = hit ? hit.point.clone() : null;
        this._hoverBusy = false;
    }

    _onKeyDown(e) {
        if (!this._active || e.target?.closest?.("input, textarea, [contenteditable]")) return;
        if (e.key === "Escape") this._points = [];
        else if (e.key === "Backspace") this._points.pop();
        else if (e.key === "Enter") this._finish();
        else return;
        e.preventDefault();
        this._renderToolbar();
    }

    _finish() {
        const min = this._mode === "area" ? 3 : 2;
        if (this._points.length >= min) this._done.push({ mode: this._mode, points: this._points });
        this._points = [];
        this._hover = null;
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

    _len(m) {
        if (this.units === "imperial") {
            const inches = m / 0.0254;
            return inches < 12 ? `${inches.toFixed(1)} in` : `${Math.floor(inches / 12)} ft ${Math.round(inches % 12)} in`;
        }
        return m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`;
    }

    _sq(m2) {
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

    // -- Drawing --

    _buildUI() {
        this._overlay = this.createUI("div", {
            interactive: false,
            style: { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "5" },
        });
        this._overlay.innerHTML = `<svg width="100%" height="100%" style="position:absolute;inset:0;overflow:visible"></svg><div></div>`;
        this._svg = this._overlay.firstChild;
        this._labelLayer = this._overlay.lastChild;

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

    update() {
        if (!this._svg) return;
        if (!this._done.length && !(this._active && this._points.length)) {
            if (this._svg.innerHTML) this._svg.innerHTML = this._labelLayer.innerHTML = "";
            return;
        }
        const camera = ArrivalSpace.getCamera()?.camera;
        if (!camera) return;
        const toScreen = (p) => {
            const s = camera.worldToScreen(p, new pc.Vec3());
            return s.z > 0 ? s : null;   // behind the camera
        };

        let svg = "", html = "";
        const draw = (mode, points, preview) => {
            const pts = preview ? [...points, preview] : points;
            const closed = mode === "area" && pts.length >= 3;
            const scr = pts.map(toScreen);
            for (let i = 1; i < scr.length + (closed ? 1 : 0); i++) {
                const a = scr[i - 1], b = scr[i % scr.length];
                if (a && b) svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${this.color}" stroke-width="2.5" ${preview && i >= points.length ? 'stroke-dasharray="6 5"' : ""}/>`;
            }
            for (const s of scr) if (s) svg += `<circle cx="${s.x}" cy="${s.y}" r="4.5" fill="${this.color}" stroke="#111" stroke-width="1.5"/>`;
            for (const l of this._labels(mode, pts)) {
                const s = toScreen(l.at);
                if (s) html += `<div style="position:absolute;left:${s.x}px;top:${s.y}px;transform:translate(-50%,-140%);padding:2px 7px;border-radius:6px;` +
                    `background:#111d;color:white;font:${l.strong ? 600 : 400} 12px system-ui,sans-serif;white-space:nowrap">${l.text}</div>`;
            }
        };
        for (const m of this._done) draw(m.mode, m.points, null);
        if (this._active && this._points.length) draw(this._mode, this._points, this._hover);
        this._svg.innerHTML = svg;
        this._labelLayer.innerHTML = html;
    }
}
