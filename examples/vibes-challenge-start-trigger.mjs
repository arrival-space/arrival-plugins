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
    modelScale = 0.18;
    bobSpeed = 2;
    bobHeight = 0;
    rotateSpeed = 60;
    itemColor = "#f1ebd3";
    burstParticleCount = 40;
    burstParticleSize = 0.2;
    burstParticleSpeed = 3;
    burstParticleLifetime = 1;
    shardCount = 6;
    shardSize = 0.15;
    shardImpulse = 0.125;
    shardImpulseUp = 0.3;
    shardTorque = 7;
    shardLifetime = 8;
    startSound = "";
    startSoundPitch = 1;
    testBurst = false;

    static properties = {
        triggerDistance: { title: "Trigger Distance", min: 0.5, max: 10 },
        modelUrl: { title: "Model URL", editor: "asset" },
        modelScale: { title: "Model Scale", min: 0.01, max: 5 },
        bobSpeed: { title: "Bob Speed", min: 0, max: 10 },
        bobHeight: { title: "Bob Height", min: 0, max: 2 },
        rotateSpeed: { title: "Rotate Speed", min: 0, max: 360, step: 1 },
        itemColor: { title: "Item Color" },
        burstParticleCount: { title: "Burst Particles", min: 0, max: 100, step: 1 },
        burstParticleSize: { title: "Burst Size", min: 0.01, max: 0.5 },
        burstParticleSpeed: { title: "Burst Speed", min: 0.1, max: 10 },
        burstParticleLifetime: { title: "Burst Lifetime", min: 0.1, max: 3 },
        shardCount: { title: "Shard Count", min: 0, max: 100, step: 1 },
        shardSize: { title: "Shard Size", min: 0.01, max: 0.3 },
        shardImpulse: { title: "Shard Impulse", min: 0, max: 5 },
        shardImpulseUp: { title: "Shard Impulse Up", min: 0, max: 5 },
        shardTorque: { title: "Shard Torque", min: 0, max: 10 },
        shardLifetime: { title: "Shard Lifetime (s)", min: 1, max: 10, step: 1 },
        startSound: { title: "Start Sound", editor: "asset" },
        startSoundPitch: { title: "Sound Pitch", min: 0.1, max: 3, step: 0.1 },
        testBurst: { title: "Test Burst" },
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
        this._onStateUpdated = (data) => {
            if (data.started && !data.gameComplete) this._deactivate();
            else if (!data.started) this._activate();
        };
        ArrivalSpace.on("scavenger:start", this._onGameStarted);
        ArrivalSpace.on("scavenger:reset", this._onReset);
        ArrivalSpace.on("vibes:state-updated", this._onStateUpdated);

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
        const player = ArrivalSpace.getPlayer?.();
        this._spawnTriggerBurst(player?.rigidbody?.linearVelocity);
        if (this.startSound) {
            ArrivalSpace.playSound(this.startSound, { position: this.position, pitch: this.startSoundPitch });
        }
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

        if (name === "testBurst" && this.testBurst) {
            const player = ArrivalSpace.getPlayer?.();
            this._spawnTriggerBurst(player?.rigidbody?.linearVelocity);
            setTimeout(() => { this.testBurst = false; }, 100);
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

    // -- Trigger burst effect --

    _spawnTriggerBurst(collectorVelocity) {
        const rgb = this._hexToRgb(this.itemColor);
        const pos = this.position;

        // Soft radial gradient texture (cached on class)
        if (!ScavengerStartTrigger._burstTexture) {
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
            ScavengerStartTrigger._burstTexture = new pc.Texture(this.app.graphicsDevice, {
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

        // Particles — horizontal ring burst
        const spd = this.burstParticleSpeed;
        const sz = this.burstParticleSize;
        const lt = this.burstParticleLifetime;

        if (this.burstParticleCount > 0) {
            const e = new pc.Entity("StartBurst");
            e.setPosition(pos.x, pos.y + 0.3, pos.z);
            this.app.root.addChild(e);

            const colorGraph = new pc.CurveSet([
                [0, rgb.r, 1, rgb.r * 0.3],
                [0, rgb.g, 1, rgb.g * 0.3],
                [0, rgb.b, 1, rgb.b * 0.3],
            ]);
            const alphaGraph = new pc.Curve([0, 1, 0.4, 0.8, 1, 0]);
            alphaGraph.type = pc.CURVE_SMOOTHSTEP;
            const scaleGraph = new pc.Curve([0, sz * 0.5, 0.3, sz, 1, sz * 0.15]);
            scaleGraph.type = pc.CURVE_SMOOTHSTEP;
            const velocityGraph = new pc.CurveSet([
                [0, -spd, 1, -spd * 0.3],
                [0, spd * 0.3, 1, spd * 0.1],
                [0, -spd, 1, -spd * 0.3],
            ]);
            const velocityGraph2 = new pc.CurveSet([
                [0, spd, 1, spd * 0.3],
                [0, spd * 0.5, 1, spd * 0.15],
                [0, spd, 1, spd * 0.3],
            ]);

            const layer = this.app.scene.layers.getLayerByName("Splats");
            e.addComponent("particlesystem", {
                numParticles: this.burstParticleCount,
                lifetime: lt,
                rate: 0,
                rate2: 0,
                emitterShape: pc.EMITTERSHAPE_SPHERE,
                emitterRadius: 0.15,
                localVelocityGraph: velocityGraph,
                localVelocityGraph2: velocityGraph2,
                scaleGraph,
                alphaGraph,
                colorGraph,
                colorMap: ScavengerStartTrigger._burstTexture,
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
            setTimeout(() => e.destroy(), (lt + 0.5) * 1000);
        }

        // Shards — same style as collectible but arranged in a radial ring
        const ss = this.shardSize;
        for (let i = 0; i < this.shardCount; i++) {
            const shard = new pc.Entity("StartShard" + i);
            const sx = ss * (0.6 + Math.random() * 0.8);
            const sy = ss * (0.4 + Math.random() * 0.6);
            const szz = ss * (0.6 + Math.random() * 0.8);
            shard.setLocalScale(sx, sy, szz);

            /// arrange on a line 
            const spread = ss * 15;
            shard.setPosition(
                pos.x + (i / this.shardCount - 0.5) * spread + (Math.random() - 0.5) * spread * 0.5,
                pos.y,
                pos.z
            );

            const mat = new pc.StandardMaterial();
            mat.diffuse = new pc.Color(1, 1, 1);
            mat.emissive = new pc.Color(0, 0, 0);
            mat.metalness = 0.9;
            mat.gloss = 0.8;
            mat.useMetalness = true;
            mat.update();

            shard.addComponent("render", { type: "box", material: mat });
            shard.addComponent("collision", { type: "box", halfExtents: new pc.Vec3(sx / 2, sy / 2, szz / 2) });
            shard.addComponent("rigidbody", {
                type: pc.BODYTYPE_DYNAMIC,
                mass: 0.1,
                restitution: 0.4,
            });

            this.app.root.addChild(shard);

            // Collector velocity + radial outward impulse
            const vx = collectorVelocity?.x || 0;
            const vy = collectorVelocity?.y || 0;
            const vz = collectorVelocity?.z || 0;
            shard.rigidbody.linearVelocity = new pc.Vec3(vx, vy, vz);

            shard.rigidbody.applyImpulse(
                (Math.random() - 0.5) * this.shardImpulse * 2,
                Math.random() * this.shardImpulseUp,
                (Math.random() - 0.5) * this.shardImpulse * 2
            );
            shard.rigidbody.applyTorqueImpulse(
                (Math.random() - 0.5) * this.shardTorque * 0.001,
                (Math.random() - 0.5) * this.shardTorque * 0.001,
                (Math.random() - 0.5) * this.shardTorque * 0.001
            );

            setTimeout(() => {
                mat.destroy();
                shard.destroy();
            }, this.shardLifetime * 1000);
        }
    }

    // -- Cleanup --

    destroy() {
        if (this._onGameStarted) ArrivalSpace.off("scavenger:start", this._onGameStarted);
        if (this._onReset) ArrivalSpace.off("scavenger:reset", this._onReset);
        if (this._onStateUpdated) ArrivalSpace.off("vibes:state-updated", this._onStateUpdated);
        this._destroyVisual();
    }
}
