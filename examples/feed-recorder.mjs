/// <reference path="../types/arrival.d.ts" />
/**
 * Feed Recorder (render-target → video file)
 *
 * Records the live feed of a `Splat Monitor` (splat-monitor.mjs) — or any plugin
 * that exposes a `pc.RenderTarget` the same way — and downloads the result as a
 * video file. Point it at a placed monitor (or let it auto-discover one), hit
 * record, stop, and the browser downloads a `.webm` of everything the monitor's
 * feed camera saw in between. Camera fly-throughs (rail-camera driving a monitor's
 * `cameraEntity`), CCTV captures, window-mode portals — anything the monitor can
 * show, this can save.
 *
 * --- Where the pixels come from ---
 * The source plugin owns a `pc.RenderTarget` (`_rt`) with a color `pc.Texture`
 * (`_texture`) that its feed camera renders into every frame. Each capture tick
 * this plugin reads that texture back from the GPU with `texture.read()` (async
 * readback — no stall), writes the pixels into an offscreen canvas, and feeds the
 * canvas into a `MediaRecorder` via `canvas.captureStream()`. So the recording is
 * exactly the feed texture: resolution, tint/gain grading and backdrop included
 * (they're part of the RT), but NOT the screen-mesh cosmetics drawn by the main
 * camera (scanline overlay, LED raster, frame, curve).
 *
 * --- Finding the source ---
 *   1. `monitorEntity` set → that placed plugin entity (entity picker).
 *   2. otherwise → the first loaded "Splat Monitor" plugin found via
 *      `ArrivalSpace.getPlugins()`.
 * Duck-typed: the resolved plugin script just needs `_rt` + `_texture` fields, so
 * a custom RTT plugin gets recorded the same way. The source is (re)resolved when
 * a recording starts, not per frame — restart the recording after swapping it.
 *
 * --- Start / stop (all of these work) ---
 *   • The `isRecording` editor toggle.
 *   • The hotkey (`hotkey`, default "r"; empty disables it).
 *   • The HUD button (bottom-right ● REC / ■ STOP, plus a 📷 snapshot button).
 *   • The local plugin event bus, so OTHER plugins can drive it:
 *       ArrivalSpace.fire("recorder:start")      // also: {name: "my-clip"}
 *       ArrivalSpace.fire("recorder:stop")
 *       ArrivalSpace.fire("recorder:toggle")
 *       ArrivalSpace.fire("recorder:snapshot")   // single frame → PNG download
 *     and it fires back "recorder:started" ({width, height, fps}), "recorder:stopped"
 *     ({seconds, frames}) and "recorder:saved" ({kind, name, bytes, seconds}) for
 *     sequencing (e.g. a cutscene plugin that starts a recording, plays a camera
 *     path, then stops). "recorder:query" is answered with "recorder:state"
 *     ({recording, seconds, fps, width, height}) so a controller UI opening
 *     mid-recording can sync its display.
 *   • A controller with its own record UI (rail-camera's operator panel /
 *     viewfinder) fires "recorder:ui:claim" {id} — the recorder then hides its
 *     fallback HUD ("recorder:ui:release" {id} restores it; the recorder fires
 *     "recorder:ui:query" on load so running claimants re-claim). Saved-clip
 *     toasts ("✓ CLIP SAVED · …") always show, claimed or not.
 *   • `maxDuration` > 0 auto-stops (and saves) after that many seconds.
 *
 * --- Output ---
 * WebM (VP9 → VP8 → whatever `MediaRecorder` supports; Safari may produce MP4) at
 * `captureFps` frames/s and `bitrateMbps`. Saved via a normal browser download:
 * `<fileName>-<timestamp>.webm`. Stopping the plugin (or leaving the space) mid-
 * recording stops and still saves what was captured.
 *
 * --- Frame pacing / cost ---
 * Capture is wall-clock paced at `captureFps` with GPU-readback backpressure: if
 * a frame's readback hasn't resolved by the next tick, that tick is skipped (the
 * encoder just holds the last frame — video stays real-time, never backlogged).
 * Readback of a 1024-row feed is a few MB per frame, so high `captureFps` + high
 * monitor `resolution` is the main cost knob. The feed itself must actually be
 * rendering: `keepFeedLive` (on) pokes the source monitor's on-demand render gate
 * every frame while recording, so a monitor with `renderEveryFrame` OFF doesn't
 * record a frozen image.
 *
 * --- Orientation (flipY / flipX / flipPov) ---
 * WebGL readback returns rows bottom-up, so frames are flipped vertically by
 * default (`flipY` on). A monitor whose feed uses `flipPov` (lens-faces-+Z camera
 * models) stores its image ROTATED 180° in the texture — the recorder detects
 * that on the source and auto-counter-rotates, so the video reads upright either
 * way. `flipY`/`flipX` are the manual escape hatches for other conventions
 * (e.g. WebGPU readback may need `flipY` off).
 */

// Event-bus names (local bus, not network) — shared by all recorder instances.
const EV_START = "recorder:start";
const EV_STOP = "recorder:stop";
const EV_TOGGLE = "recorder:toggle";
const EV_SNAPSHOT = "recorder:snapshot";
const EV_STARTED = "recorder:started";     // fired back: { width, height, fps }
const EV_STOPPED = "recorder:stopped";     // fired back: { seconds, frames }
const EV_SAVED = "recorder:saved";         // fired back: { kind, name, bytes, seconds }
// State handshake: anyone can fire EV_QUERY; the recorder answers with EV_STATE
// { recording, seconds, fps, width, height } — lets a controller UI that loads
// (or opens) mid-recording sync its REC display.
const EV_QUERY = "recorder:query";
const EV_STATE = "recorder:state";
// HUD claim: a controller plugin with its OWN record UI (e.g. rail-camera's
// operator panel / viewfinder) fires EV_UI_CLAIM { id } and the recorder hides
// its fallback HUD (EV_UI_RELEASE { id } restores it). The recorder fires
// EV_UI_QUERY on load so already-running claimants can re-claim.
const EV_UI_CLAIM = "recorder:ui:claim";
const EV_UI_RELEASE = "recorder:ui:release";
const EV_UI_QUERY = "recorder:ui:query";

// MediaRecorder container/codec preference order.
const MIME_CANDIDATES = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
];

export class FeedRecorder extends ArrivalScript {
    static scriptName = "Feed Recorder";

    // The placed Splat Monitor (plugin entity) to record. Empty = auto-discover the
    // first loaded "Splat Monitor" plugin. (Duck-typed: any plugin whose script has
    // `_rt` + `_texture` works.)
    monitorEntity = "";

    // Record toggle — flip on to start, off to stop & download. (Deliberately NOT
    // auto-resumed on space load, so a saved-while-recording param can't trigger a
    // surprise download for the next visitor.)
    isRecording = false;

    // Frames per second captured into the video. Also the encoder's nominal rate.
    captureFps = 30;

    // Target video bitrate in Mbit/s (VP9 webm; higher = bigger, cleaner file).
    bitrateMbps = 12;

    // Auto-stop (and save) after this many seconds. 0 = record until stopped.
    maxDuration = 0;

    // Keyboard toggle key ("r"). Empty string disables the hotkey.
    hotkey = "r";

    // Small bottom-right HUD: record/stop button, elapsed time, snapshot button.
    showHud = true;

    // While recording, poke the source monitor's on-demand render gate every frame
    // so a `renderEveryFrame`-off monitor keeps rendering instead of freezing.
    keepFeedLive = true;

    // Flip the captured frame vertically. ON by default: WebGL reads the render
    // target back bottom-up. (A monitor-mode feed with flipPov is additionally
    // auto-rotated 180° — see _blitFrame.)
    flipY = true;

    // Mirror the captured frame horizontally. Normally off; escape hatch for
    // backends/sources with yet another orientation convention.
    flipX = false;

    // Base name of the downloaded file (timestamp + extension are appended).
    fileName = "monitor-feed";

    static properties = {
        monitorEntity: { title: "Monitor (plugin entity)", editor: "entity" },
        isRecording: { title: "● Record" },
        captureFps: { title: "Capture FPS", min: 1, max: 60, step: 1 },
        bitrateMbps: { title: "Bitrate (Mbit/s)", min: 1, max: 100, step: 1 },
        maxDuration: { title: "Max Duration (s, 0=∞)", min: 0, max: 3600, step: 1 },
        hotkey: { title: "Toggle Hotkey" },
        showHud: { title: "Show HUD" },
        keepFeedLive: { title: "Keep Feed Live" },
        flipY: { title: "Flip Vertically" },
        flipX: { title: "Mirror Horizontally" },
        fileName: { title: "File Name" },
    };

    // ── internal state ──
    _destroyed = false;
    _recording = false;
    _srcScript = null;               // the source plugin instance (duck-typed _rt/_texture)
    _w = 0;
    _h = 0;
    _readBuf = null;                 // reused GPU-readback buffer (Uint8Array)
    _imgData = null;                 // ImageData wrapping _readBuf's memory
    _readBusy = false;               // one readback in flight max (backpressure)
    _tmpCanvas = null;               // raw pixels land here (alpha:false → opaque)
    _tmpCtx = null;
    _recCanvas = null;               // flipped/composited frame; captureStream source
    _recCtx = null;
    _stream = null;
    _requestFrame = null;            // () => push a frame into the stream (if supported)
    _recorder = null;
    _mime = "";
    _chunks = [];
    _pendingName = "";               // name override from the start event, if any
    _elapsed = 0;
    _frames = 0;
    _captureAccum = 0;
    _lastSeconds = 0;                // duration of the recording being saved
    _gateServer = null;
    _keyOff = null;
    _busSubs = [];                   // [name, fn] pairs for ArrivalSpace.off
    _hud = null;                     // { root, btn, time, shot }
    _uiClaims = new Set();           // controller ids that claimed the record UI
    _toastEl = null;
    _toastTimer = null;

    initialize() {
        this._destroyed = false;
        this.isRecording = false;    // never auto-resume a persisted "recording" flag

        // Event bus — lets other plugins (or a cutscene controller) drive us.
        const sub = (name, fn) => { ArrivalSpace.on(name, fn); this._busSubs.push([name, fn]); };
        sub(EV_START, (opts) => this.startRecording(opts));
        sub(EV_STOP, () => this.stopRecording());
        sub(EV_TOGGLE, () => { if (this._recording) this.stopRecording(); else this.startRecording(); });
        sub(EV_SNAPSHOT, () => this.snapshot());
        sub(EV_QUERY, () => this._fireState());
        sub(EV_UI_CLAIM, (d) => { if (d?.id) { this._uiClaims.add(d.id); this._updateHudVisibility(); } });
        sub(EV_UI_RELEASE, (d) => { if (d?.id) { this._uiClaims.delete(d.id); this._updateHudVisibility(); } });

        this._bindHotkey();
        this._buildHud();
        // Ask already-loaded controller UIs (rail-camera etc.) to re-claim the HUD.
        try { ArrivalSpace.fire(EV_UI_QUERY); } catch (e) { /* ignore */ }
    }

    _fireState() {
        try {
            ArrivalSpace.fire(EV_STATE, {
                recording: this._recording,
                seconds: this._recording ? this._elapsed : 0,
                fps: Math.max(1, Math.min(60, this.captureFps)),
                width: this._w,
                height: this._h,
            });
        } catch (e) { /* ignore */ }
    }

    update(dt) {
        if (this._destroyed || !this._recording) return;

        this._elapsed += dt;
        if (this.maxDuration > 0 && this._elapsed >= this.maxDuration) {
            this.stopRecording();
            return;
        }

        // A monitor in on-demand mode would freeze its RT while nothing moves —
        // mark it dirty every frame so the recording stays live.
        const src = this._srcScript;
        if (this.keepFeedLive && src && "_renderDirty" in src) src._renderDirty = true;

        // Source vanished mid-recording (monitor unloaded / rebuilt with new dims)?
        // Stop and save what we have rather than recording garbage.
        const tex = src && src._texture;
        if (!tex || tex.width !== this._w || tex.height !== this._h) {
            console.warn("[FeedRecorder] source feed changed/vanished — stopping");
            this.stopRecording();
            return;
        }

        // Wall-clock paced capture with backpressure (skip if a read is in flight).
        const interval = 1 / Math.max(1, Math.min(60, this.captureFps));
        this._captureAccum += dt;
        if (this._captureAccum >= interval) {
            this._captureAccum %= interval;
            this._captureFrame();
        }

        this._updateHudTime();
    }

    onPropertyChanged(name, value) {
        if (name === "isRecording") {
            if (!!value === this._recording) return;   // programmatic sync, not a user toggle
            if (value) this.startRecording(); else this.stopRecording();
            return;
        }
        if (name === "hotkey") { this._bindHotkey(); return; }
        if (name === "showHud") { this._destroyHud(); this._buildHud(); return; }
        // monitorEntity / fps / bitrate / fileName / flipY apply on the next start
        // (fps + flipY of the running capture loop are read live anyway).
    }

    destroy() {
        this._destroyed = true;
        // Stop mid-recording still saves what was captured.
        this.stopRecording();
        for (const [name, fn] of this._busSubs) {
            try { ArrivalSpace.off(name, fn); } catch (e) { /* ignore */ }
        }
        this._busSubs = [];
        if (this._keyOff) { this._keyOff(); this._keyOff = null; }
        if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }
        if (this._toastEl) { try { this._toastEl.remove(); } catch (e) { /* ignore */ } this._toastEl = null; }
        this._destroyHud();
        this._releaseStream();
    }

    // ── recording control ─────────────────────────────────────────────────────

    startRecording(opts) {
        if (this._destroyed || this._recording) return;
        if (typeof MediaRecorder === "undefined") {
            console.warn("[FeedRecorder] MediaRecorder not available in this browser");
            return;
        }
        const src = this._resolveSource();
        const tex = src && src._texture;
        if (!tex || !tex.width || !tex.height) {
            console.warn("[FeedRecorder] no monitor feed found — place a Splat Monitor (or set Monitor entity)");
            this.isRecording = false;
            return;
        }
        this._srcScript = src;
        this._pendingName = (opts && typeof opts.name === "string") ? opts.name : "";
        this._ensureSurfaces(tex.width, tex.height);

        // Prime the canvas so the first encoded frame is black, not undefined.
        this._recCtx.fillStyle = "#000";
        this._recCtx.fillRect(0, 0, this._w, this._h);

        // captureStream(0) + requestFrame() = a frame lands exactly when we draw
        // one (no duplicate encoder frames between our capture ticks). Fall back
        // to a free-running fps stream where requestFrame isn't supported.
        this._releaseStream();
        const fps = Math.max(1, Math.min(60, this.captureFps));
        let stream = this._recCanvas.captureStream(0);
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.requestFrame === "function") {
            this._requestFrame = () => track.requestFrame();
        } else if (typeof stream.requestFrame === "function") {
            this._requestFrame = () => stream.requestFrame();
        } else {
            this._requestFrame = null;
            stream = this._recCanvas.captureStream(fps);
        }
        this._stream = stream;

        this._mime = MIME_CANDIDATES.find((m) => {
            try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
        }) || "";
        try {
            this._recorder = new MediaRecorder(stream, {
                mimeType: this._mime || undefined,
                videoBitsPerSecond: Math.max(1, this.bitrateMbps) * 1e6,
            });
        } catch (e) {
            console.warn("[FeedRecorder] MediaRecorder failed:", e);
            this._releaseStream();
            this.isRecording = false;
            return;
        }
        this._chunks = [];
        this._recorder.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
        this._recorder.onstop = () => this._saveVideo();
        this._recorder.start();

        this._recording = true;
        this.isRecording = true;
        this._elapsed = 0;
        this._frames = 0;
        this._captureAccum = 1;      // capture immediately on the next update
        this._updateHudState();
        try {
            ArrivalSpace.fire(EV_STARTED, { width: this._w, height: this._h, fps });
        } catch (e) { /* ignore */ }
    }

    stopRecording() {
        if (!this._recording) return;
        this._recording = false;
        this.isRecording = false;
        this._lastSeconds = this._elapsed;
        const rec = this._recorder;
        this._recorder = null;
        if (rec && rec.state !== "inactive") {
            try { rec.stop(); }        // → onstop → _saveVideo
            catch (e) { console.warn("[FeedRecorder] stop failed:", e); }
        }
        this._updateHudState();
        try { ArrivalSpace.fire(EV_STOPPED, { seconds: this._lastSeconds, frames: this._frames }); } catch (e) { /* ignore */ }
    }

    // Single frame → PNG download. Works while idle or mid-recording.
    async snapshot() {
        if (this._destroyed) return;
        const src = this._recording ? this._srcScript : this._resolveSource();
        const tex = src && src._texture;
        if (!tex || !tex.width) {
            console.warn("[FeedRecorder] no monitor feed found for snapshot");
            return;
        }
        if (!this._recording) this._ensureSurfaces(tex.width, tex.height);
        const ok = await this._readInto(src);
        if (!ok || this._destroyed) return;
        this._blitFrame(src);
        this._recCanvas.toBlob((blob) => {
            if (!blob) return;
            const name = this._makeName("png");
            this._download(blob, name);
            this._toast(`PHOTO SAVED · ${name}`);
            try { ArrivalSpace.fire(EV_SAVED, { kind: "photo", name, bytes: blob.size, seconds: 0 }); } catch (e) { /* ignore */ }
        }, "image/png");
    }

    // ── capture pipeline ──────────────────────────────────────────────────────

    async _captureFrame() {
        if (this._readBusy || !this._recording) return;
        const ok = await this._readInto(this._srcScript);
        if (!ok || !this._recording || this._destroyed) return;
        this._blitFrame(this._srcScript);
        this._frames++;
        if (this._requestFrame) this._requestFrame();
    }

    // Async GPU readback of the source RT's color texture into _readBuf / _imgData
    // → tmp canvas. Passing the source's own RenderTarget avoids the engine
    // creating (and destroying) a temp wrapper RT per read.
    async _readInto(src) {
        const tex = src && src._texture;
        if (!tex || this._readBusy) return false;
        this._readBusy = true;
        try {
            const data = await tex.read(0, 0, this._w, this._h, {
                renderTarget: src._rt || undefined,
                data: this._readBuf || undefined,
                immediate: true,
            });
            if (this._destroyed) return false;
            if (data !== this._readBuf) {              // first read (or engine realloc)
                this._readBuf = data;
                this._imgData = new ImageData(
                    new Uint8ClampedArray(data.buffer, data.byteOffset, this._w * this._h * 4),
                    this._w, this._h
                );
            }
            this._tmpCtx.putImageData(this._imgData, 0, 0);
            return true;
        } catch (e) {
            console.warn("[FeedRecorder] texture read failed:", e);
            return false;
        } finally {
            this._readBusy = false;
        }
    }

    // tmp canvas → recording canvas, orienting the frame on the way. Two layers:
    //   • flipY (default on): WebGL readback returns rows bottom-up.
    //   • flipPov auto-rotate: a monitor-mode feed with `flipPov` films with its
    //     camera ROLLED 180° (lens-faces-+Z models; the screen mounting compensates
    //     in-world), so the texture stores the image rotated 180° — undo it here
    //     (verified live: without this the video comes out mirrored). Rot180 =
    //     flipX + flipY, XORed into the user knobs.
    // The alpha:false contexts force the feed opaque on the way.
    _blitFrame(src) {
        const ctx = this._recCtx;
        const rot = !!(src && src.flipPov && !src.windowMode && String(src.cameraEntity || "").trim());
        const fx = !!this.flipX !== rot;
        const fy = !!this.flipY !== rot;
        if (fx || fy) {
            ctx.save();
            ctx.translate(fx ? this._w : 0, fy ? this._h : 0);
            ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
            ctx.drawImage(this._tmpCanvas, 0, 0);
            ctx.restore();
        } else {
            ctx.drawImage(this._tmpCanvas, 0, 0);
        }
    }

    _ensureSurfaces(w, h) {
        if (this._tmpCanvas && this._w === w && this._h === h) return;
        this._w = w;
        this._h = h;
        this._readBuf = null;
        this._imgData = null;
        this._tmpCanvas = document.createElement("canvas");
        this._tmpCanvas.width = w;
        this._tmpCanvas.height = h;
        this._tmpCtx = this._tmpCanvas.getContext("2d", { alpha: false });
        this._recCanvas = document.createElement("canvas");
        this._recCanvas.width = w;
        this._recCanvas.height = h;
        this._recCtx = this._recCanvas.getContext("2d", { alpha: false });
    }

    _releaseStream() {
        if (this._stream) {
            try { for (const t of this._stream.getTracks()) t.stop(); } catch (e) { /* ignore */ }
            this._stream = null;
        }
        this._requestFrame = null;
    }

    // ── saving ────────────────────────────────────────────────────────────────

    _saveVideo() {
        const chunks = this._chunks;
        this._chunks = [];
        this._releaseStream();
        if (!chunks.length) {
            console.warn("[FeedRecorder] nothing captured — no file saved");
            return;
        }
        const type = this._mime || "video/webm";
        const blob = new Blob(chunks, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const name = this._makeName(ext);
        this._download(blob, name);
        const mb = (blob.size / 1048576).toFixed(1);
        const s = Math.round(this._lastSeconds);
        const dur = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        this._toast(`CLIP SAVED · ${name} · ${mb} MB · ${dur}`);
        try { ArrivalSpace.fire(EV_SAVED, { kind: "video", name, bytes: blob.size, seconds: this._lastSeconds }); } catch (e) { /* ignore */ }
    }

    _makeName(ext) {
        const base = (this._pendingName || this.fileName || "monitor-feed").replace(/[^\w.-]+/g, "_");
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
        return `${base}-${stamp}.${ext}`;
    }

    _download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // ── source resolution ─────────────────────────────────────────────────────

    // Resolve an entity-picker id (GateServer name or GUID) to a scene entity.
    _resolveEntityId(id) {
        id = typeof id === "string" ? id.trim() : "";
        if (!id) return null;
        let gs = this._gateServer;
        if (!gs) {
            gs = this.app.root.findByName("GateServer")?.script?.gateServer || null;
            if (gs) this._gateServer = gs;
        }
        let e = gs?.getEntity?.(id) ?? null;
        if (!e) { try { e = this.app.root.findByGuid?.(id) ?? null; } catch (_) { /* ignore */ } }
        return e;
    }

    // The source plugin script: the picked entity's plugin, else the first loaded
    // Splat Monitor. Duck-typed on `_rt` + `_texture`.
    _resolveSource() {
        const picked = this._resolveEntityId(this.monitorEntity);
        if (picked) {
            const s = this._scriptWithFeed(picked);
            if (s) return s;
            console.warn("[FeedRecorder] picked entity has no render-target feed");
        }
        for (const p of ArrivalSpace.getPlugins()) {
            if (p.name !== "Splat Monitor") continue;
            const s = this._scriptWithFeed(p.entity);
            if (s) return s;
        }
        return null;
    }

    // Plugin scripts live on a "Plugin_*" child of the placed UserModelEntity.
    _scriptWithFeed(umeEntity) {
        if (!umeEntity) return null;
        for (const child of umeEntity.children) {
            if (!child.name?.startsWith("Plugin_")) continue;
            const scripts = child.script?.scripts;
            if (!scripts) continue;
            for (const s of scripts) {
                if (s && s._rt && s._texture) return s;
            }
        }
        return null;
    }

    // ── hotkey / HUD ──────────────────────────────────────────────────────────

    _bindHotkey() {
        if (this._keyOff) { this._keyOff(); this._keyOff = null; }
        const key = (this.hotkey || "").trim();
        if (!key) return;
        this._keyOff = this.onKeyDown(key, () => {
            if (this._recording) this.stopRecording(); else this.startRecording();
        });
    }

    _buildHud() {
        if (!this.showHud) return;
        const ui = this.getUIContainer();
        const root = document.createElement("div");
        root.innerHTML = `
        <style>
            .fr-hud {
                position: fixed; right: 16px; bottom: 16px;
                display: flex; gap: 8px; align-items: center;
                z-index: 120; font-family: sans-serif; user-select: none;
            }
            .fr-hud button {
                border: none; border-radius: 8px; cursor: pointer;
                padding: 8px 14px; font-size: 14px; color: #fff;
                background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
            }
            .fr-hud button:hover { background: rgba(0,0,0,0.8); }
            .fr-hud .fr-rec.on { background: rgba(200,30,30,0.85); }
            .fr-hud .fr-time { color: #fff; font-size: 13px; min-width: 44px;
                text-align: right; text-shadow: 0 1px 2px rgba(0,0,0,0.8); display: none; }
        </style>
        <div class="fr-hud">
            <span class="fr-time">0:00</span>
            <button class="fr-rec" title="Start/stop recording the monitor feed">● REC</button>
            <button class="fr-shot" title="Save a PNG snapshot of the monitor feed">📷</button>
        </div>`;
        ui.appendChild(root);
        const btn = root.querySelector(".fr-rec");
        const shot = root.querySelector(".fr-shot");
        const time = root.querySelector(".fr-time");
        btn.addEventListener("click", () => {
            if (this._recording) this.stopRecording(); else this.startRecording();
        });
        shot.addEventListener("click", () => this.snapshot());
        this._hud = { root, btn, time };
        this._updateHudState();
        this._updateHudVisibility();
    }

    _destroyHud() {
        if (this._hud) { try { this._hud.root.remove(); } catch (e) { /* ignore */ } this._hud = null; }
    }

    // Hide the fallback HUD while a controller plugin (rail-camera etc.) shows its
    // own record UI. The toast is independent of this — it always shows.
    _updateHudVisibility() {
        if (!this._hud) return;
        this._hud.root.style.display = this._uiClaims.size > 0 ? "none" : "";
    }

    // Camera-style "written to card" confirmation, bottom-centre, auto-fades.
    _toast(text) {
        try {
            if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }
            if (this._toastEl) { this._toastEl.remove(); this._toastEl = null; }
            const ui = this.getUIContainer();
            const el = document.createElement("div");
            el.textContent = `✓ ${text}`;
            Object.assign(el.style, {
                position: "fixed", left: "50%", bottom: "84px", transform: "translateX(-50%) translateY(8px)",
                background: "rgba(13,10,22,0.92)", border: "1px solid rgba(255,255,255,0.14)",
                color: "#eaf6ea", padding: "8px 16px", borderRadius: "8px",
                fontFamily: "'Courier New', ui-monospace, monospace", fontSize: "12px",
                letterSpacing: "1px", whiteSpace: "nowrap", zIndex: "1200",
                boxShadow: "0 10px 34px rgba(0,0,0,0.5)", pointerEvents: "none",
                opacity: "0", transition: "opacity .25s ease, transform .25s ease",
            });
            ui.appendChild(el);
            this._toastEl = el;
            requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateX(-50%)"; });
            this._toastTimer = setTimeout(() => {
                el.style.opacity = "0";
                el.style.transform = "translateX(-50%) translateY(8px)";
                this._toastTimer = setTimeout(() => { el.remove(); if (this._toastEl === el) this._toastEl = null; }, 300);
            }, 4000);
        } catch (e) { /* UI unavailable — the download still happened */ }
    }

    _updateHudState() {
        const hud = this._hud;
        if (!hud) return;
        hud.btn.textContent = this._recording ? "■ STOP" : "● REC";
        hud.btn.classList.toggle("on", this._recording);
        hud.time.style.display = this._recording ? "inline" : "none";
        this._updateHudTime();
    }

    _updateHudTime() {
        const hud = this._hud;
        if (!hud || !this._recording) return;
        const s = Math.floor(this._elapsed);
        hud.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
}
