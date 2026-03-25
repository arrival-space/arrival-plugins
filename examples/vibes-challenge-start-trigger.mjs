/**
 * Scavenger Hunt — Start Trigger plugin.
 *
 * Place this in the scene as the start point. The player must walk
 * through it to begin the scavenger hunt. Visually identical to a
 * collectible — bobs, rotates, and disappears on contact.
 *
 * The companion "Scavenger Hunt" controller stays idle until this
 * trigger is activated.
 */
export class ScavengerStartTrigger extends ArrivalScript {
    static scriptName = "Scavenger Start Trigger";

    triggerDistance = 1.5;
    modelUrl = "";
    modelScale = 0.5;
    bobSpeed = 2;
    bobHeight = 0.2;
    rotateSpeed = 60;
    itemColor = "#4ade80";

    static properties = {
        triggerDistance: { title: "Trigger Distance", min: 0.5, max: 10 },
        modelUrl: { title: "Model URL", editor: "asset" },
        modelScale: { title: "Model Scale", min: 0.01, max: 5 },
        bobSpeed: { title: "Bob Speed", min: 0, max: 10 },
        bobHeight: { title: "Bob Height", min: 0, max: 2 },
        rotateSpeed: { title: "Rotate Speed", min: 0, max: 360, step: 1 },
        itemColor: { title: "Item Color" },
    };

    _active = true;
    _time = 0;
    _startY = 0;
    _visual = null;
    _material = null;
    _modelEntity = null;
    _hintEl = null;
    _hintTimer = 0;

    initialize() {
        this._active = true;
        this._time = 0;
        this._startY = this.localPosition.y;

        this._onGameStarted = () => this._deactivate();
        this._onReset = () => this._activate();
        ArrivalSpace.on("scavenger:start", this._onGameStarted);
        ArrivalSpace.on("scavenger:reset", this._onReset);

        if (this.modelUrl) {
            this._loadModel(this.modelUrl);
        } else {
            this._createDefaultVisual();
        }
    }

    update(dt) {
        this._updateHint(dt);

        if (!this._active) return;

        this._time += dt;

        // Bob
        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.bobSpeed) * this.bobHeight;
        this.localPosition = pos;

        // Rotate
        if (this.rotateSpeed) {
            this.entity.rotate(0, this.rotateSpeed * dt, 0);
        }

        // Check player proximity
        const player = ArrivalSpace.getPlayer();
        if (!player) return;

        const dist = player.getPosition().distance(this.position);
        if (dist < this.triggerDistance) {
            if (ArrivalSpace.getLocalAttachedEntity()) {
                this._trigger();
            } else {
                this._showHint();
            }
        }
    }

    _trigger() {
        this._active = false;
        this._setVisualVisible(false);
        const user = ArrivalSpace.getUser?.();
        ArrivalSpace.fire("scavenger:start", {
            userId: user?.userID,
            userName: user?.userName,
        });
    }

    _deactivate() {
        this._active = false;
        this._setVisualVisible(false);
    }

    _activate() {
        this._active = true;
        this._time = 0;
        this._setVisualVisible(true);
    }

    // -- Hint --

    _hintMessages = [
        "Grab a board first, shredder!",
        "No wheels, no deal!",
        "You gonna run the course on foot? Get a board!",
        "Board up before you show up!",
        "Legs are cool, but wheels are cooler.",
    ];

    _showHint() {
        if (this._hintTimer > 0) return;
        this._hintTimer = 3;

        const ui = this.getUIContainer();
        if (!this._hintEl) {
            this._hintEl = document.createElement("div");
            Object.assign(this._hintEl.style, {
                position: "fixed",
                bottom: "120px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.7)",
                backdropFilter: "blur(6px)",
                color: "#fff",
                padding: "12px 28px",
                borderRadius: "8px",
                fontFamily: "sans-serif",
                fontSize: "18px",
                fontWeight: "bold",
                pointerEvents: "none",
                userSelect: "none",
                zIndex: "150",
                transition: "opacity 0.4s",
            });
            ui.appendChild(this._hintEl);
        }

        const msg = this._hintMessages[Math.floor(Math.random() * this._hintMessages.length)];
        this._hintEl.textContent = msg;
        this._hintEl.style.opacity = "1";
    }

    _updateHint(dt) {
        if (this._hintTimer <= 0) return;
        this._hintTimer -= dt;
        if (this._hintTimer <= 0 && this._hintEl) {
            this._hintEl.style.opacity = "0";
        }
    }

    // -- Visuals --

    _createDefaultVisual() {
        this._destroyVisual();

        const entity = new pc.Entity("StartVisual");
        entity.addComponent("render", { type: "box" });

        const rgb = this._hexToRgb(this.itemColor);
        this._material = new pc.StandardMaterial();
        this._material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
        this._material.emissive = new pc.Color(rgb.r * 0.4, rgb.g * 0.4, rgb.b * 0.4);
        this._material.update();
        entity.render.material = this._material;

        const s = this.modelScale;
        entity.setLocalScale(s, s, s);
        entity.setLocalPosition(0, s * 0.5, 0);

        this.entity.addChild(entity);
        this._visual = entity;
    }

    async _loadModel(url) {
        this._destroyVisual();

        try {
            const { entity } = await ArrivalSpace.loadGLB(url, {
                parent: this.entity,
                name: "StartModel",
                scale: this.modelScale,
            });
            this._modelEntity = entity;
            this._visual = entity;
        } catch (err) {
            console.error("ScavengerStartTrigger: Failed to load model:", err);
            this._createDefaultVisual();
        }
    }

    _setVisualVisible(visible) {
        if (this._visual) this._visual.enabled = visible;
    }

    _destroyVisual() {
        if (this._modelEntity) {
            ArrivalSpace.disposeEntity(this._modelEntity);
            this._modelEntity = null;
        } else if (this._visual) {
            this._visual.destroy();
        }
        this._visual = null;

        if (this._material) {
            this._material.destroy();
            this._material = null;
        }
    }

    // -- Property changes --

    onPropertyChanged(name) {
        if (name === "modelUrl") {
            if (this.modelUrl) {
                this._loadModel(this.modelUrl);
            } else {
                this._createDefaultVisual();
            }
            return;
        }

        if (name === "modelScale") {
            if (this._modelEntity) {
                const s = this.modelScale;
                this._modelEntity.setLocalScale(s, s, s);
            } else if (this._visual) {
                const s = this.modelScale;
                this._visual.setLocalScale(s, s, s);
                this._visual.setLocalPosition(0, s * 0.5, 0);
            }
            return;
        }

        if (name === "rotateSpeed" && !this.rotateSpeed) {
            this.entity.setLocalEulerAngles(0, 0, 0);
            return;
        }

        if (name === "itemColor" && this._material) {
            const rgb = this._hexToRgb(this.itemColor);
            this._material.diffuse.set(rgb.r, rgb.g, rgb.b);
            this._material.emissive.set(rgb.r * 0.4, rgb.g * 0.4, rgb.b * 0.4);
            this._material.update();
        }
    }

    // -- Helpers --

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255,
            };
        }
        return { r: 0.29, g: 0.87, b: 0.5 };
    }

    // -- Cleanup --

    destroy() {
        if (this._onGameStarted) ArrivalSpace.off("scavenger:start", this._onGameStarted);
        if (this._onReset) ArrivalSpace.off("scavenger:reset", this._onReset);
        this._destroyVisual();
    }
}
