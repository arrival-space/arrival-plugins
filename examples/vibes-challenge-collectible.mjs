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
    modelScale = 0.18;
    bobSpeed = 2;
    bobHeight = 0;
    rotateSpeed = 60;
    itemColor = "#f1ebd3";
    collectSound = "";
    collectSoundPitch = 1;
    burstParticleCount = 30;
    burstParticleSize = 0.2;
    burstParticleSpeed = 2;
    burstParticleLifetime = 1;
    shardCount = 10;
    shardSize = 0.15;
    shardImpulse = 0.125;
    shardImpulseUp = 0;
    shardTorque = 7;
    shardLifetime = 8;
    testBurst = false;
    debugRespawn = false;

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
        burstParticleCount: { title: "Burst Particles", min: 0, max: 100, step: 1 },
        burstParticleSize: { title: "Burst Size", min: 0.01, max: 0.5 },
        burstParticleSpeed: { title: "Burst Speed", min: 0.1, max: 10 },
        burstParticleLifetime: { title: "Burst Lifetime", min: 0.1, max: 3 },
        shardCount: { title: "Shard Count", min: 0, max: 10, step: 1 },
        shardSize: { title: "Shard Size", min: 0.01, max: 0.3 },
        shardImpulse: { title: "Shard Impulse", min: 0, max: 5 },
        shardImpulseUp: { title: "Shard Impulse Up", min: 0, max: 5 },
        shardTorque: { title: "Shard Torque", min: 0, max: 10 },
        shardLifetime: { title: "Shard Lifetime (s)", min: 1, max: 10, step: 1 },
        testBurst: { title: "Test Burst" },
        debugRespawn: { title: "Debug Respawn" },
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

    collect(collectorEntity) {
        if (this._collected) return;
        this._collected = true;
        this._setVisualVisible(false);
        if (collectorEntity) {
            this._spawnCollectBurst(collectorEntity.rigidbody?.linearVelocity);
        }
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

        if (name === "testBurst" && this.testBurst) {
            this.collect(ArrivalSpace.getPlayer?.());
            setTimeout(() => { this.testBurst = false; }, 100);
        }

        if (name === "debugRespawn" && this.debugRespawn) {
            this.reset();
            setTimeout(() => { this.debugRespawn = false; }, 100);
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

    // ── Collect burst effect ──

    _spawnCollectBurst(collectorVelocity) {
        const rgb = this._hexToRgb(this.itemColor);
        const pos = this.position;

        // Soft radial gradient texture (cached on class)
        if (!ScavengerItem._burstTexture) {
            const size = 32;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            g.addColorStop(0, "rgba(255,255,255,1)");
            g.addColorStop(0.5, "rgba(255,255,255,0.6)");
            g.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
            ScavengerItem._burstTexture = new pc.Texture(this.app.graphicsDevice, {
                width: size, height: size,
                format: pc.PIXELFORMAT_R8_G8_B8_A8,
                mipmaps: true,
                minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
                magFilter: pc.FILTER_LINEAR,
                addressU: pc.ADDRESS_CLAMP_TO_EDGE,
                addressV: pc.ADDRESS_CLAMP_TO_EDGE,
                levels: [canvas],
            });
        }

        const e = new pc.Entity("CollectBurst");
        e.setPosition(pos.x, pos.y + 0.3, pos.z);
        this.app.root.addChild(e);

        const spd = this.burstParticleSpeed;
        const sz = this.burstParticleSize;
        const lt = this.burstParticleLifetime;

        const colorGraph = new pc.CurveSet([
            [0, rgb.r, 1, rgb.r * 0.5],
            [0, rgb.g, 1, rgb.g * 0.5],
            [0, rgb.b, 1, rgb.b * 0.5],
        ]);
        const alphaGraph = new pc.Curve([0, 1, 0.3, 0.8, 1, 0]);
        alphaGraph.type = pc.CURVE_SMOOTHSTEP;
        const scaleGraph = new pc.Curve([0, sz * 0.5, 0.2, sz, 1, sz * 0.15]);
        scaleGraph.type = pc.CURVE_SMOOTHSTEP;
        const velocityGraph = new pc.CurveSet([
            [0, -spd, 1, -spd * 0.3],
            [0, spd, 1, spd * 0.3],
            [0, -spd, 1, -spd * 0.3],
        ]);
        const velocityGraph2 = new pc.CurveSet([
            [0, spd, 1, spd * 0.3],
            [0, spd * 1.5, 1, spd * 0.5],
            [0, spd, 1, spd * 0.3],
        ]);

        if (this.burstParticleCount > 0) {
            const layer = this.app.scene.layers.getLayerByName("Splats");
            e.addComponent("particlesystem", {
                numParticles: this.burstParticleCount,
                lifetime: lt,
                rate: 0,
                rate2: 0,
                emitterShape: pc.EMITTERSHAPE_SPHERE,
                emitterRadius: 0.1,
                localVelocityGraph: velocityGraph,
                localVelocityGraph2: velocityGraph2,
                scaleGraph,
                alphaGraph,
                colorGraph,
                colorMap: ScavengerItem._burstTexture,
                blendType: pc.BLEND_ADDITIVE,
                depthWrite: false,
                orientation: pc.PARTICLEORIENTATION_SCREEN,
                loop: false,
                lighting: false,
                sort: pc.PARTICLESORT_NONE,
                layers: layer ? [layer.id] : undefined,
            });

            e.particlesystem.reset();
            e.particlesystem.play();
        }

        setTimeout(() => e.destroy(), (lt + 0.5) * 1000);

        // Spawn metallic shrapnel pieces
        const ss = this.shardSize;
        for (let i = 0; i < this.shardCount; i++) {
            const shard = new pc.Entity("Shard" + i);
            const sx = ss * (0.6 + Math.random() * 0.8);
            const sy = ss * (0.4 + Math.random() * 0.6);
            const sz = ss * (0.6 + Math.random() * 0.8);
            shard.setLocalScale(sx, sy, sz);

            const ox = (Math.random() - 0.5) * ss * 3;
            const oz = (Math.random() - 0.5) * ss * 3;
            shard.setPosition(pos.x + ox, pos.y + 0.3 + i * ss * 2, pos.z + oz);

            const mat = new pc.StandardMaterial();
            mat.diffuse = new pc.Color(1,1,1);
            mat.emissive = new pc.Color(0,0,0);
            mat.metalness = 0.9;
            mat.gloss = 0.8;
            mat.useMetalness = true;
            mat.update();

            shard.addComponent("render", { type: "box", material: mat });
            shard.addComponent("collision", { type: "box", halfExtents: new pc.Vec3(sx / 2, sy / 2, sz / 2) });
            shard.addComponent("rigidbody", {
                type: pc.BODYTYPE_DYNAMIC,
                mass: 0.1,
                restitution: 0.4,
            });

            this.app.root.addChild(shard);

            // Start with collector's velocity
            const vx = collectorVelocity?.x || 0;
            const vy = collectorVelocity?.y || 0;
            const vz = collectorVelocity?.z || 0;
            shard.rigidbody.linearVelocity = new pc.Vec3(vx, vy, vz);

            // Add random scatter impulse on top
            shard.rigidbody.applyImpulse(
                (Math.random() - 0.5) * this.shardImpulse * 2,
                Math.random() * this.shardImpulseUp,
                (Math.random() - 0.5) * this.shardImpulse * 2
            );
            shard.rigidbody.applyTorqueImpulse(
                (Math.random() - 0.5) * this.shardTorque*0.001,
                (Math.random() - 0.5) * this.shardTorque*0.001,
                (Math.random() - 0.5) * this.shardTorque*0.001
            );

            setTimeout(() => {
                mat.destroy();
                shard.destroy();
            }, this.shardLifetime * 1000);
        }
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
