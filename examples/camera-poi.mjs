/**
 * Camera POI — overlay list of scene entities; click one to fly the free cam to it.
 * Showcase: getUIContainer(), setFreeCamPose(), setCameraMode()/getCameraMode(),
 *           lockInput()/unlockInput(), userModelEntity discovery, AABB-based framing,
 *           per-frame camera animation (smooth fly + orbit).
 *
 * Lists every user-placed item (entities carrying the `userModelEntity` script —
 * GLBs, splats, images, plugins). Clicking an entry switches to free cam and
 * frames the entity from the current viewing direction. Optional smooth flight
 * to the target and auto-rotation around it (cancelled as soon as the user
 * flies manually or leaves free cam).
 *
 * Uses ArrivalSpace.setFreeCamPose (VERSION >= 1.11.0) when available; on older
 * clients it falls back to driving the freeCamView script directly.
 * Press [F] in-game to toggle free cam off, or use the panel's "Exit free cam" button.
 */
export class CameraPoi extends ArrivalScript {
    static scriptName = "cameraPoi";

    distanceFactor = 2.2; // camera distance = bounding radius * this
    viewHeight = 0.25;    // camera height above the target center = bounding radius * this
    smoothFly = true;     // animate the camera to the target instead of snapping
    autoRotate = false;   // keep orbiting around the target after arriving
    orbitSpeed = 10;      // degrees per second (negative = counter-clockwise)
    typeFilter = "all";   // which entity types to list

    static properties = {
        distanceFactor: { title: "View Distance ×", min: 1, max: 8, step: 0.1 },
        viewHeight: { title: "View/Orbit Height ×", min: -2, max: 4, step: 0.05 },
        smoothFly: { title: "Smooth Fly" },
        autoRotate: { title: "Auto-Rotate" },
        orbitSpeed: { title: "Orbit Speed (°/s)", min: -90, max: 90, step: 1 },
        typeFilter: {
            title: "Type Filter",
            options: [
                { label: "All", value: "all" },
                { label: "GLB", value: "glb" },
                { label: "Splats", value: "splat" },
            ],
        },
    };

    _pois = [];
    _enteredFreeCam = false;
    _anim = null;       // in-flight smooth-fly state
    _orbit = null;      // active orbit state
    _lastView = null;   // { center } of the last POI jumped to

    initialize() {
        this._buildUI();
        this._refresh();
    }

    update(dt) {
        if (!this._anim && !this._orbit) return;

        // Hand control back to the user: cancel on manual fly input or mode change
        if (ArrivalSpace.getCameraMode() !== "free" || this._hasManualFlyInput()) {
            this._anim = null;
            this._orbit = null;
            return;
        }

        if (this._anim) {
            const a = this._anim;
            a.t = Math.min(a.t + dt / a.duration, 1);
            const k = a.t * a.t * (3 - 2 * a.t); // smoothstep
            const pos = new pc.Vec3().lerp(a.fromPos, a.toPos, k);
            const target = new pc.Vec3().lerp(a.fromTarget, a.toTarget, k);
            this._applyFreeCamPose(pos, target);
            if (a.t >= 1) {
                this._anim = null;
                if (this.autoRotate) this._startOrbit(a.toPos, a.toTarget, this._lastView?.radius);
            }
            return;
        }

        const o = this._orbit;
        o.angle += this.orbitSpeed * (Math.PI / 180) * dt;
        // Height is computed live so viewHeight can be tuned while orbiting
        const pos = new pc.Vec3(
            o.center.x + Math.cos(o.angle) * o.radius,
            o.center.y + o.boundRadius * this.viewHeight,
            o.center.z + Math.sin(o.angle) * o.radius
        );
        this._applyFreeCamPose(pos, o.center);
    }

    onPropertyChanged(name, value) {
        if (name === "smoothFly") {
            const cb = this._uiContainer?.querySelector(".js-smooth");
            if (cb) cb.checked = !!value;
        } else if (name === "autoRotate") {
            const cb = this._uiContainer?.querySelector(".js-orbit");
            if (cb) cb.checked = !!value;
            this._onAutoRotateChanged(!!value);
        } else if (name === "typeFilter") {
            this._refresh();
        }
    }

    // ── POI discovery ────────────────────────────────────────────────────────

    _collectPois() {
        const pois = [];
        const ownHost = this.entity?.parent;
        const items = this.app.root.find((node) => node.script?.userModelEntity);
        for (const entity of items) {
            if (!entity.enabled || entity === ownHost) continue;
            const ume = entity.script.userModelEntity;
            pois.push({
                id: String(ume.id || ume.entityId || entity.getGuid()),
                name: this._getDisplayName(entity, ume),
                type: ume.dataType || "item",
                entity,
            });
        }
        return pois;
    }

    /**
     * Same name resolution as the app's content panel:
     * user-set displayName > live entityName > scriptName > file name.
     */
    _getDisplayName(entity, ume) {
        const stripExt = (n) => (n ? String(n).replace(/\.[^./\\]+$/, "") : "");
        const data = ume.data || {};
        return (
            data.displayName ||
            stripExt(entity.entityName) ||
            data.scriptName ||
            stripExt(data.name) ||
            entity.name ||
            "(unnamed)"
        );
    }

    // ── Camera jump ──────────────────────────────────────────────────────────

    _getWorldBounds(entity) {
        let aabb = null;
        const addAabb = (a) => {
            if (!a) return;
            if (!aabb) aabb = new pc.BoundingBox(a.center.clone(), a.halfExtents.clone());
            else aabb.add(a);
        };
        for (const render of entity.findComponents("render")) {
            for (const mi of render.meshInstances ?? []) addAabb(mi.aabb);
        }
        for (const gsplat of entity.findComponents("gsplat")) {
            addAabb(gsplat.instance?.meshInstance?.aabb);
        }
        if (!aabb) return { center: entity.getPosition().clone(), radius: 1.5 };
        return { center: aabb.center.clone(), radius: Math.max(aabb.halfExtents.length(), 0.5) };
    }

    _getFreeCamView() {
        if (!this._freeCamView) {
            const entity = this.app.root.find((n) => n.script?.freeCamView)[0];
            this._freeCamView = entity?.script?.freeCamView || null;
        }
        return this._freeCamView;
    }

    /** True while the user is flying the free cam manually (WASD/QE/joystick). */
    _hasManualFlyInput() {
        const fcv = this._getFreeCamView();
        if (!fcv) return false;
        return !!(fcv.forwardValue || fcv.sidewardValue || fcv.upwardValue);
    }

    /** Apply a free-cam pose, falling back to driving freeCamView directly on old clients. */
    _applyFreeCamPose(pos, target) {
        if (typeof ArrivalSpace.setFreeCamPose === "function") {
            return ArrivalSpace.setFreeCamPose(pos, target);
        }
        return this._setFreeCamPoseFallback(pos, target);
    }

    /**
     * Fallback for clients older than 1.11.0 (no ArrivalSpace.setFreeCamPose):
     * switch to free cam, then drive the freeCamView script directly.
     */
    _setFreeCamPoseFallback(pos, target) {
        if (ArrivalSpace.getCameraMode() !== "free" && !ArrivalSpace.setCameraMode("free")) return false;

        const freeCamView = this._getFreeCamView();
        if (!freeCamView) return false;

        freeCamView.setInitPosition(pos);

        const dir = new pc.Vec3().sub2(target, pos);
        if (dir.lengthSq() > 1e-6) {
            dir.normalize();
            const up = Math.abs(dir.y) > 0.999 ? pc.Vec3.FORWARD : pc.Vec3.UP;
            const lookMat = new pc.Mat4().setLookAt(pos, target, up);
            const quat = new pc.Quat().setFromMat4(lookMat);
            if (typeof freeCamView.setRotationFromQuat === "function") {
                freeCamView.setRotationFromQuat(quat);
            } else {
                freeCamView.setInitRotation(quat);
            }
            // Sync the pivot in the same frame as the position — freeCamView only
            // applies pitch/yaw in its own update(), which can lag one frame behind
            // and wobble off-center at low frame rates.
            if (typeof freeCamView.applyRotation === "function") {
                freeCamView.applyRotation();
            } else if (freeCamView.cameraPivot) {
                const euler = freeCamView.cameraPivot.getLocalEulerAngles();
                euler.x = freeCamView.pitch;
                euler.y = freeCamView.yaw;
                euler.z = freeCamView.roll || 0;
                freeCamView.cameraPivot.setLocalEulerAngles(euler);
            }
        }
        this.app.needsRedraw = true;
        return true;
    }

    _jumpTo(poi) {
        if (!poi.entity || poi.entity._destroying) {
            this._refresh();
            return;
        }

        const { center, radius } = this._getWorldBounds(poi.entity);

        // Approach horizontally from the current viewing direction so jumps feel
        // spatially coherent; the height comes solely from viewHeight.
        const cam = ArrivalSpace.getCamera();
        const camPos = cam ? cam.getPosition().clone() : null;
        const dir = camPos ? camPos.clone().sub(center) : new pc.Vec3(1, 0, 1);
        dir.y = 0;
        if (dir.lengthSq() < 0.01) dir.set(1, 0, 1);
        dir.normalize();

        const dist = Math.max(radius * this.distanceFactor, 1.5);
        const toPos = center.clone().add(dir.mulScalar(dist));
        toPos.y += radius * this.viewHeight;

        if (ArrivalSpace.getCameraMode() !== "free") this._enteredFreeCam = true;
        this._anim = null;
        this._orbit = null;
        this._lastView = { center: center.clone(), radius };

        if (this.smoothFly && cam && camPos) {
            // Start the look sweep from where the camera currently aims
            const fromTarget = camPos.clone().add(cam.forward.clone().mulScalar(camPos.distance(center)));
            this._applyFreeCamPose(camPos, fromTarget); // enter free cam at the current pose
            this._anim = {
                fromPos: camPos,
                fromTarget,
                toPos,
                toTarget: center.clone(),
                t: 0,
                duration: pc.math.clamp(camPos.distance(toPos) / 15, 0.6, 2.5),
            };
        } else {
            this._applyFreeCamPose(toPos, center);
            if (this.autoRotate) this._startOrbit(toPos, center, radius);
        }
        this._setActiveRow(poi.id);
    }

    _startOrbit(camPos, center, boundRadius) {
        const dx = camPos.x - center.x;
        const dz = camPos.z - center.z;
        this._orbit = {
            center: center.clone(),
            radius: Math.max(Math.sqrt(dx * dx + dz * dz), 0.5),
            boundRadius: boundRadius || 1,
            angle: Math.atan2(dz, dx),
        };
    }

    _onAutoRotateChanged(enabled) {
        if (!enabled) {
            this._orbit = null;
            return;
        }
        // Toggled on while already viewing a POI: orbit from the current camera position
        if (!this._anim && !this._orbit && this._lastView && ArrivalSpace.getCameraMode() === "free") {
            const cam = ArrivalSpace.getCamera();
            if (cam) this._startOrbit(cam.getPosition(), this._lastView.center, this._lastView.radius);
        }
    }

    _exitFreeCam() {
        this._anim = null;
        this._orbit = null;
        if (ArrivalSpace.getCameraMode() === "free") ArrivalSpace.setCameraMode("third");
        this._enteredFreeCam = false;
        this._setActiveRow(null);
    }

    // ── UI ───────────────────────────────────────────────────────────────────

    _buildUI() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
            #poi-panel * { box-sizing: border-box; margin: 0; }
            #poi-panel {
                position: fixed; bottom: 16px; left: 16px;
                width: 240px; max-height: 60vh;
                display: flex; flex-direction: column;
                background: rgba(15, 18, 24, 0.82); backdrop-filter: blur(8px);
                border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
                font-family: 'Segoe UI', sans-serif; color: #eee;
                pointer-events: auto; overflow: hidden;
                user-select: none;
            }
            .poi-head {
                display: flex; align-items: center; justify-content: space-between;
                padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
                font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
                opacity: 0.85;
            }
            .poi-head button {
                background: none; border: none; color: #aaa; cursor: pointer;
                font-size: 13px; padding: 2px 6px; border-radius: 4px;
            }
            .poi-head button:hover { color: #fff; background: rgba(255,255,255,0.1); }
            .poi-list { overflow-y: auto; padding: 4px; flex: 1; }
            .poi-row {
                display: flex; align-items: center; gap: 8px;
                padding: 6px 8px; border-radius: 6px; cursor: pointer;
                font-size: 13px;
            }
            .poi-row:hover { background: rgba(100, 180, 255, 0.15); }
            .poi-row.active { background: rgba(100, 180, 255, 0.28); }
            .poi-row .poi-name {
                flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .poi-row .poi-type {
                font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
                padding: 1px 5px; border-radius: 3px;
                background: rgba(255,255,255,0.1); color: #9bc7ff; flex-shrink: 0;
            }
            .poi-row .poi-dist { font-size: 10px; opacity: 0.45; flex-shrink: 0; min-width: 32px; text-align: right; }
            .poi-opts {
                display: flex; gap: 12px;
                padding: 6px 10px; border-top: 1px solid rgba(255,255,255,0.08);
            }
            .poi-opt {
                display: flex; align-items: center; gap: 5px;
                font-size: 11px; opacity: 0.8; cursor: pointer;
            }
            .poi-opt:hover { opacity: 1; }
            .poi-opt input { accent-color: #64b4ff; cursor: pointer; margin: 0; }
            .poi-foot {
                padding: 6px 10px; border-top: 1px solid rgba(255,255,255,0.08);
            }
            .poi-foot button {
                width: 100%; padding: 5px; border-radius: 6px; cursor: pointer;
                background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
                color: #ddd; font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
            }
            .poi-foot button:hover { background: rgba(255,255,255,0.16); color: #fff; }
            .poi-empty { padding: 14px 10px; font-size: 12px; opacity: 0.5; text-align: center; }
        </style>

        <div id="poi-panel">
            <div class="poi-head">
                <span>Points of Interest</span>
                <button class="js-refresh" title="Refresh list">⟳</button>
            </div>
            <div class="poi-list js-list"></div>
            <div class="poi-opts">
                <label class="poi-opt"><input type="checkbox" class="js-smooth"> Smooth fly</label>
                <label class="poi-opt"><input type="checkbox" class="js-orbit"> Auto-rotate</label>
            </div>
            <div class="poi-foot">
                <button class="js-exit">Exit free cam</button>
            </div>
        </div>`;

        ui.querySelector(".js-refresh").addEventListener("click", () => this._refresh());
        ui.querySelector(".js-exit").addEventListener("click", () => this._exitFreeCam());

        const smoothCb = ui.querySelector(".js-smooth");
        smoothCb.checked = this.smoothFly;
        smoothCb.addEventListener("change", () => { this.smoothFly = smoothCb.checked; });

        const orbitCb = ui.querySelector(".js-orbit");
        orbitCb.checked = this.autoRotate;
        orbitCb.addEventListener("change", () => {
            this.autoRotate = orbitCb.checked;
            this._onAutoRotateChanged(orbitCb.checked);
        });

        // Keep clicks/taps on the panel from reaching the scene behind it
        // (same pattern createUI() wires automatically; we build raw innerHTML here)
        const panel = ui.querySelector("#poi-panel");
        panel.addEventListener("mouseenter", () => this.lockInput());
        panel.addEventListener("mouseleave", () => this.unlockInput());
        panel.addEventListener("touchstart", () => this.lockInput(), { passive: true });
        panel.addEventListener("touchend", () => {
            // Delay unlock slightly so tap click handlers still fire
            setTimeout(() => this.unlockInput(), 100);
        }, { passive: true });
    }

    _refresh() {
        this._pois = this._collectPois();

        const list = this._uiContainer?.querySelector(".js-list");
        if (!list) return;

        const visible = this.typeFilter === "all"
            ? this._pois
            : this._pois.filter((p) => p.type === this.typeFilter);

        if (!visible.length) {
            list.innerHTML = `<div class="poi-empty">No ${this.typeFilter === "all" ? "" : this.typeFilter + " "}entities found</div>`;
            return;
        }

        const playerPos = ArrivalSpace.getPlayer()?.getPosition();
        list.innerHTML = "";
        for (const poi of visible) {
            const row = document.createElement("div");
            row.className = "poi-row";
            row.dataset.poiId = poi.id;

            let dist = "";
            if (playerPos) {
                dist = poi.entity.getPosition().distance(playerPos).toFixed(0) + "m";
            }
            row.innerHTML = `
                <span class="poi-name"></span>
                <span class="poi-type"></span>
                <span class="poi-dist">${dist}</span>`;
            row.querySelector(".poi-name").textContent = poi.name;
            row.querySelector(".poi-type").textContent = poi.type;
            row.addEventListener("click", () => this._jumpTo(poi));
            list.appendChild(row);
        }
    }

    _setActiveRow(poiId) {
        const list = this._uiContainer?.querySelector(".js-list");
        if (!list) return;
        for (const row of list.querySelectorAll(".poi-row")) {
            row.classList.toggle("active", poiId !== null && row.dataset.poiId === poiId);
        }
    }

    destroy() {
        this._anim = null;
        this._orbit = null;
        if (this._enteredFreeCam && ArrivalSpace.getCameraMode() === "free") {
            ArrivalSpace.setCameraMode("third");
        }
        this.removeUI();
    }
}
