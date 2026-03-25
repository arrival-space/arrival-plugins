/**
 * Scavenger Item — A collectible marker for the Scavenger Hunt.
 *
 * Place one of these for every collectible in the scene.
 * Each item is its own entity with full gizmo support, so creators
 * can position them freely in edit mode.
 *
 * The companion "Scavenger Hunt" controller plugin discovers these
 * items automatically and manages the game logic.
 *
 * Features demonstrated:
 * - Plugin event bus (ArrivalSpace.fire / ArrivalSpace.on)
 * - Built-in default visual with optional GLB model override
 * - Public methods for cross-plugin communication (collect / reset)
 * - Idle animation (bob + rotate)
 */
export class ScavengerItem extends ArrivalScript {
    static scriptName = "Scavenger Item";

    label = "Collectible";
    letter = "";
    points = 10;
    collectDistance = 1.5;
    modelUrl = "";
    modelScale = 0.5;
    bobSpeed = 2;
    bobHeight = 0.2;
    rotateSpeed = 60;
    itemColor = "#f5c542";
    collectSound = "";
    collectSoundPitch = 1;

    static properties = {
        label: { title: "Label" },
        letter: { title: "Letter" },
        points: { title: "Points", min: 1, max: 1000, step: 1 },
        collectDistance: { title: "Collect Distance", min: 0.5, max: 10 },
        modelUrl: { title: "Model URL", editor: "asset" },
        modelScale: { title: "Model Scale", min: 0.01, max: 5 },
        bobSpeed: { title: "Bob Speed", min: 0, max: 10 },
        bobHeight: { title: "Bob Height", min: 0, max: 2 },
        rotateSpeed: { title: "Rotate Speed", min: 0, max: 360, step: 1 },
        itemColor: { title: "Item Color" },
        collectSound: { title: "Collect Sound", editor: "asset" },
        collectSoundPitch: { title: "Sound Pitch", min: 0.1, max: 3, step: 0.1 },
    };

    _collected = false;
    _time = 0;
    _startY = 0;
    _visual = null;
    _material = null;
    _modelEntity = null;

    _hidden = true;

    initialize() {
        this._collected = false;
        this._hidden = true;
        this._startY = this.localPosition.y;

        if (this.modelUrl) {
            this._loadModel(this.modelUrl, true);
        } else {
            this._createDefaultVisual();
            this._setVisualVisible(false);
        }

        this._onStart = () => this._show();
        this._onReset = () => this._hide();
        this._onStateUpdated = (data) => {
            if (!data.started || data.gameComplete) return;
            // Late join: show if game is active and this letter's slot is not filled
            const letter = this.letter?.toUpperCase();
            const filled = (data.slots || []).some((s) => s.letter === letter && s.filled);
            if (filled) {
                this.collect();
            } else if (this._hidden) {
                this._show();
            }
        };
        ArrivalSpace.on("scavenger:start", this._onStart);
        ArrivalSpace.on("scavenger:reset", this._onReset);
        ArrivalSpace.on("vibes:state-updated", this._onStateUpdated);

        ArrivalSpace.fire("scavenger:item:ready", this);
    }

    update(dt) {
        if (this._collected || this._hidden) return;

        this._time += dt;

        // Bob
        const pos = this.localPosition;
        pos.y = this._startY + Math.sin(this._time * this.bobSpeed) * this.bobHeight;
        this.localPosition = pos;

        // Rotate
        if (this.rotateSpeed) {
            this.entity.rotate(0, this.rotateSpeed * dt, 0);
        }
    }

    // ── Public API (called by controller) ──

    collect() {
        if (this._collected) return;
        this._collected = true;
        this._setVisualVisible(false);
        if (this.collectSound) {
            ArrivalSpace.playSound(this.collectSound, { position: this.position, pitch: this.collectSoundPitch });
        }
    }

    reset() {
        this._collected = false;
        this._hidden = false;
        this._time = 0;
        this._setVisualVisible(true);
    }

    _show() {
        this._hidden = false;
        this._collected = false;
        this._time = 0;
        this._setVisualVisible(true);
    }

    _hide() {
        this._hidden = true;
        this._setVisualVisible(false);
    }

    get collected() {
        return this._collected;
    }

    // ── Visuals ──

    _createDefaultVisual() {
        this._destroyVisual();

        const entity = new pc.Entity("ItemVisual");
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

    async _loadModel(url, startHidden = false) {
        this._destroyVisual();

        try {
            const { entity } = await ArrivalSpace.loadGLB(url, {
                parent: this.entity,
                name: "ItemModel",
                scale: this.modelScale,
            });
            this._modelEntity = entity;
            this._visual = entity;
            if (startHidden || this._hidden) {
                this._setVisualVisible(false);
            }
        } catch (err) {
            console.error("ScavengerItem: Failed to load model:", err);
            this._createDefaultVisual();
            if (startHidden || this._hidden) {
                this._setVisualVisible(false);
            }
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

    // ── Property changes ──

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

    // ── Helpers ──

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255,
            };
        }
        return { r: 0.96, g: 0.77, b: 0.26 };
    }

    // ── Cleanup ──

    destroy() {
        if (this._onStart) ArrivalSpace.off("scavenger:start", this._onStart);
        if (this._onReset) ArrivalSpace.off("scavenger:reset", this._onReset);
        if (this._onStateUpdated) ArrivalSpace.off("vibes:state-updated", this._onStateUpdated);
        ArrivalSpace.fire("scavenger:item:removed", this);
        this._destroyVisual();
    }
}
