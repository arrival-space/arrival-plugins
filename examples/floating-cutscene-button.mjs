/**
 * Floating Cutscene Button — a 3D "play" button that triggers a cutscene.
 *
 * Place the plugin entity where the button should float, then pick a cutscene
 * entity in the editor. Clicking the button (or pressing the editor's "Play
 * Cutscene" action) resolves the cutscene with
 * `ArrivalSpace.getCutsceneScript(id)` and calls `playCutscene()`.
 *
 * The button is built entirely from PlayCanvas box primitives — a plate plus
 * two angled bars that read as a play triangle — so it needs no textures. It
 * bobs, optionally faces the camera, scales up on hover, and flashes red when
 * there is no cutscene to play or the click is out of range.
 *
 * Features demonstrated:
 * - Entity picker (`editor: "entity"`, `filterTypes: ["cutscene"]`)
 * - Playing a cutscene via `getCutsceneScript().playCutscene()`
 * - An `editor: "action"` button that calls a plugin method
 * - A 3D button from primitives with manual ray/plane hit-testing
 * - Hover feedback, click cooldown, and a max-distance guard
 */

export class FloatingCutsceneButton extends ArrivalScript {
    static scriptName = "Floating Cutscene Button";

    cutsceneEntityId = "";
    buttonWidth = 1.1;
    buttonHeight = 0.42;
    buttonDepth = 0.08;
    hoverHeight = 1.35;
    bobAmount = 0.06;
    bobSpeed = 1.4;
    faceCamera = true;
    isVisible = true;
    maxClickDistance = 24;
    cooldownSeconds = 0.8;
    backgroundColor = "#101827";
    accentColor = "#38bdf8";
    errorColor = "#ef4444";

    static properties = {
        cutsceneEntityId: {
            title: "Cutscene Entity",
            editor: "entity",
            filterTypes: ["cutscene"],
        },
        buttonWidth: { title: "Button Width", min: 0.4, max: 4, step: 0.01 },
        buttonHeight: { title: "Button Height", min: 0.2, max: 2, step: 0.01 },
        buttonDepth: { title: "Button Depth", min: 0.02, max: 0.5, step: 0.01 },
        hoverHeight: { title: "Hover Height", min: -5, max: 8, step: 0.01 },
        bobAmount: { title: "Bob Amount", min: 0, max: 0.5, step: 0.01 },
        bobSpeed: { title: "Bob Speed", min: 0, max: 6, step: 0.05 },
        faceCamera: { title: "Face Camera" },
        isVisible: { title: "Show Button" },
        maxClickDistance: { title: "Max Click Distance", min: 1, max: 100, step: 1 },
        cooldownSeconds: { title: "Click Cooldown", min: 0, max: 10, step: 0.1 },
        backgroundColor: { title: "Button Color" },
        accentColor: { title: "Play Icon Color" },
        errorColor: { title: "Error Flash Color" },
        playCutscene: { title: "Play Cutscene", editor: "action" },
    };

    _root = null;
    _plate = null;
    _iconTop = null;
    _iconBottom = null;
    _plateMaterial = null;
    _iconMaterial = null;
    _errorMaterial = null;
    _time = 0;
    _cooldownTimer = null;
    _flashTimer = 0;
    _isCoolingDown = false;
    _isHovering = false;
    _onPointerDown = null;
    _onPointerMove = null;

    initialize() {
        this._createMaterials();
        this._buildButton();
        this._bindPointerEvents();
    }

    update(dt) {
        this._time += dt;
        this._updateButtonTransform();

        if (this._flashTimer > 0) {
            this._flashTimer = Math.max(0, this._flashTimer - dt);
            if (this._flashTimer === 0) this._applyMaterials();
        }
    }

    onPropertyChanged() {
        this._createMaterials();
        this._syncButtonShape();
        this._applyMaterials();
    }

    playCutscene() {
        if (this._isCoolingDown) return false;

        const targetId = this._getCutsceneEntityId();
        if (!targetId) {
            this.warn("FloatingCutsceneButton: Select a cutscene entity first.");
            this._flashError();
            return false;
        }

        const cutscene = ArrivalSpace.getCutsceneScript?.(targetId);
        if (!cutscene || typeof cutscene.playCutscene !== "function") {
            this.warn(`FloatingCutsceneButton: Cutscene not ready for entity "${targetId}".`);
            this._flashError();
            return false;
        }

        cutscene.playCutscene();
        this._startCooldown();
        return true;
    }

    _buildButton() {
        this._destroyButton();

        this._root = new pc.Entity("FloatingCutsceneButton");
        this.entity.addChild(this._root);

        this._plate = new pc.Entity("FloatingCutsceneButtonPlate");
        this._plate.addComponent("render", {
            type: "box",
            material: this._plateMaterial,
        });
        this._root.addChild(this._plate);

        this._iconTop = new pc.Entity("FloatingCutsceneButtonIconTop");
        this._iconTop.addComponent("render", {
            type: "box",
            material: this._iconMaterial,
        });
        this._root.addChild(this._iconTop);

        this._iconBottom = new pc.Entity("FloatingCutsceneButtonIconBottom");
        this._iconBottom.addComponent("render", {
            type: "box",
            material: this._iconMaterial,
        });
        this._root.addChild(this._iconBottom);

        this._syncButtonShape();
        this._applyMaterials();
        this._updateButtonTransform();
    }

    _syncButtonShape() {
        if (!this._root || !this._plate || !this._iconTop || !this._iconBottom) return;

        const width = Math.max(0.4, Number(this.buttonWidth) || 1.1);
        const height = Math.max(0.2, Number(this.buttonHeight) || 0.42);
        const depth = Math.max(0.02, Number(this.buttonDepth) || 0.08);
        const iconLength = Math.min(width * 0.26, height * 0.58);
        const iconThickness = Math.max(0.035, height * 0.09);
        const iconOffsetX = iconLength * 0.08;
        const iconOffsetY = iconLength * 0.38;
        const iconZ = -depth * 0.68;

        this._plate.setLocalPosition(0, 0, 0);
        this._plate.setLocalScale(width, height, depth);

        this._iconTop.setLocalPosition(iconOffsetX, iconOffsetY, iconZ);
        this._iconTop.setLocalEulerAngles(0, 0, -38);
        this._iconTop.setLocalScale(iconLength, iconThickness, depth * 0.34);

        this._iconBottom.setLocalPosition(iconOffsetX, -iconOffsetY, iconZ);
        this._iconBottom.setLocalEulerAngles(0, 0, 38);
        this._iconBottom.setLocalScale(iconLength, iconThickness, depth * 0.34);

        this._root.enabled = !!this.isVisible;
    }

    _updateButtonTransform() {
        if (!this._root) return;

        this._root.enabled = !!this.isVisible;
        if (!this.isVisible) return;

        const bob = Math.sin(this._time * Math.max(0, Number(this.bobSpeed) || 0)) * Math.max(0, Number(this.bobAmount) || 0);
        this._root.setLocalPosition(0, (Number(this.hoverHeight) || 0) + bob, 0);

        const scale = this._isHovering && !this._isCoolingDown ? 1.06 : 1;
        this._root.setLocalScale(scale, scale, scale);

        if (this.faceCamera) {
            const camera = ArrivalSpace.getCamera?.();
            const cameraPos = camera?.getPosition?.();
            if (cameraPos) this._root.lookAt(cameraPos);
        }
    }

    _bindPointerEvents() {
        this._unbindPointerEvents();

        this._onPointerDown = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (!this._hitTestPointer(event)) return;

            event.preventDefault?.();
            event.stopPropagation?.();
            this.playCutscene();
        };

        this._onPointerMove = (event) => {
            this._isHovering = this._hitTestPointer(event);
            this._applyMaterials();
        };

        window.addEventListener("pointerdown", this._onPointerDown, true);
        window.addEventListener("pointermove", this._onPointerMove, true);
    }

    _unbindPointerEvents() {
        if (this._onPointerDown) {
            window.removeEventListener("pointerdown", this._onPointerDown, true);
            this._onPointerDown = null;
        }

        if (this._onPointerMove) {
            window.removeEventListener("pointermove", this._onPointerMove, true);
            this._onPointerMove = null;
        }
    }

    _hitTestPointer(event) {
        if (!this.isVisible || !this._root) return false;

        const camera = ArrivalSpace.getCamera?.();
        const cameraComponent = camera?.camera;
        if (!camera || !cameraComponent?.screenToWorld) return false;

        const ray = this._getPointerRay(event, camera, cameraComponent);
        if (!ray) return false;

        const center = this._root.getPosition();
        if (ray.origin.distance(center) > Math.max(1, Number(this.maxClickDistance) || 24)) return false;

        const normal = this._cloneVec(this._root.forward || center.clone().sub(ray.origin)).normalize();
        const denom = this._dot(normal, ray.direction);
        if (Math.abs(denom) < 0.0001) return false;

        const toPlane = center.clone().sub(ray.origin);
        const t = this._dot(toPlane, normal) / denom;
        if (t < 0) return false;

        const hit = ray.origin.clone().add(ray.direction.clone().scale(t));
        const relative = hit.sub(center);
        const right = this._cloneVec(this._root.right || new pc.Vec3(1, 0, 0)).normalize();
        const up = this._cloneVec(this._root.up || new pc.Vec3(0, 1, 0)).normalize();
        const scale = this._isHovering && !this._isCoolingDown ? 1.06 : 1;
        const halfWidth = Math.max(0.4, Number(this.buttonWidth) || 1.1) * scale * 0.5;
        const halfHeight = Math.max(0.2, Number(this.buttonHeight) || 0.42) * scale * 0.5;

        return Math.abs(this._dot(relative, right)) <= halfWidth &&
            Math.abs(this._dot(relative, up)) <= halfHeight;
    }

    _getPointerRay(event, camera, cameraComponent) {
        const canvas = this.app?.graphicsDevice?.canvas;
        const rect = canvas?.getBoundingClientRect?.();
        const rawX = event.clientX ?? event.pageX;
        const rawY = event.clientY ?? event.pageY;
        if (rawX === undefined || rawY === undefined) return null;

        const x = rect ? (rawX - rect.left) * ((canvas.width || rect.width) / rect.width) : rawX;
        const y = rect ? (rawY - rect.top) * ((canvas.height || rect.height) / rect.height) : rawY;
        const nearClip = Math.max(0.01, Number(cameraComponent.nearClip) || 0.1);
        const farClip = Math.max(nearClip + 1, Math.min(1000, Number(this.maxClickDistance) || 24));
        const origin = camera.getPosition?.() || cameraComponent.screenToWorld(x, y, nearClip);
        const farPoint = cameraComponent.screenToWorld(x, y, farClip);
        const direction = farPoint.clone().sub(origin).normalize();

        return { origin, direction };
    }

    _createMaterials() {
        this._destroyMaterials();

        const background = this._hexToRgb01(this.backgroundColor, { r: 0.06, g: 0.09, b: 0.15 });
        const accent = this._hexToRgb01(this.accentColor, { r: 0.22, g: 0.74, b: 0.97 });
        const error = this._hexToRgb01(this.errorColor, { r: 0.94, g: 0.27, b: 0.27 });

        this._plateMaterial = ArrivalSpace.createMaterial({
            diffuse: background,
            emissive: background,
            emissiveIntensity: 0.22,
            useLighting: true,
            gloss: 0.62,
        });
        this._iconMaterial = ArrivalSpace.createMaterial({
            diffuse: accent,
            emissive: accent,
            emissiveIntensity: 0.9,
            useLighting: true,
            gloss: 0.72,
        });
        this._errorMaterial = ArrivalSpace.createMaterial({
            diffuse: error,
            emissive: error,
            emissiveIntensity: 0.9,
            useLighting: true,
            gloss: 0.72,
        });
    }

    _applyMaterials() {
        if (this._plate?.render) {
            this._plate.render.material = this._flashTimer > 0 ? this._errorMaterial : this._plateMaterial;
        }

        const iconMaterial = this._isCoolingDown ? this._plateMaterial : this._iconMaterial;
        if (this._iconTop?.render) this._iconTop.render.material = iconMaterial;
        if (this._iconBottom?.render) this._iconBottom.render.material = iconMaterial;
    }

    _startCooldown() {
        const seconds = Math.max(0, Number(this.cooldownSeconds) || 0);
        if (this._cooldownTimer) {
            clearTimeout(this._cooldownTimer);
            this._cooldownTimer = null;
        }

        if (seconds <= 0) return;

        this._isCoolingDown = true;
        this._applyMaterials();
        this._cooldownTimer = setTimeout(() => {
            this._isCoolingDown = false;
            this._cooldownTimer = null;
            this._applyMaterials();
        }, seconds * 1000);
    }

    _flashError() {
        this._flashTimer = 0.22;
        this._applyMaterials();
    }

    _getCutsceneEntityId() {
        return typeof this.cutsceneEntityId === "string"
            ? this.cutsceneEntityId.trim()
            : "";
    }

    _cloneVec(value) {
        return value?.clone ? value.clone() : new pc.Vec3(value?.x || 0, value?.y || 0, value?.z || 0);
    }

    _dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    _hexToRgb01(hex, fallback) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) return fallback;

        return {
            r: parseInt(match[1], 16) / 255,
            g: parseInt(match[2], 16) / 255,
            b: parseInt(match[3], 16) / 255,
        };
    }

    _destroyButton() {
        if (this._root) {
            this._root.destroy();
            this._root = null;
            this._plate = null;
            this._iconTop = null;
            this._iconBottom = null;
        }
    }

    _destroyMaterials() {
        this._plateMaterial?.destroy?.();
        this._iconMaterial?.destroy?.();
        this._errorMaterial?.destroy?.();
        this._plateMaterial = null;
        this._iconMaterial = null;
        this._errorMaterial = null;
    }

    destroy() {
        this._unbindPointerEvents();

        if (this._cooldownTimer) {
            clearTimeout(this._cooldownTimer);
            this._cooldownTimer = null;
        }

        this._destroyButton();
        this._destroyMaterials();
    }
}
