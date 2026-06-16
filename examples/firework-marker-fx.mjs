/**
 * Firework Marker FX — particle fireworks driven by cutscene markers.
 *
 * Pick a cutscene entity in the editor. As that cutscene plays, this plugin
 * listens to its timeline markers (`sequence:marker`) and turns them into
 * effects: ascent flames while the rocket climbs, then a burst on detonation.
 *
 * A marker is matched to an effect by, in order:
 *   1. its explicit `event` field, then
 *   2. a keyword in its `label` / `id`.
 * Recognised cues:
 *   - launch / ignite / trail / lift / ascent / flame  → ascent flames
 *   - explode / burst / detonate / boom                → firework burst
 *
 * Optionally pick a "rocket" entity to anchor the effects (and hide it on
 * detonation); otherwise effects anchor to this plugin's own entity.
 *
 * Features demonstrated:
 * - Entity picker (`editor: "entity"`, `filterTypes: ["cutscene"]`)
 * - Reacting to cutscene markers via `getCutsceneScript().on("sequence:marker")`
 * - A self-managed particle pool built from PlayCanvas primitives
 * - An `editor: "action"` button to preview the cutscene
 */

export class FireworkMarkerFX extends ArrivalScript {
    static scriptName = "Firework Marker FX";

    cutsceneEntityId = "";
    rocketEntityId = "";
    playOnStart = false;
    hideRocketOnExplode = true;
    explodeHideDelay = 0.12;
    rocketOffset = { x: 0, y: -0.45, z: 0 };
    ascentDuration = 1.1;
    flameRate = 34;
    flameSpread = 0.09;
    flameLift = 0.28;
    flameLifetime = 0.45;
    flameSize = 0.12;
    burstCount = 120;
    burstSpeed = 3.8;
    burstLifetime = 1.8;
    burstUpBias = 0.45;
    gravity = 3.4;
    flameColor = "#ff7a1a";
    flameAccentColor = "#ffe08a";
    burstPrimaryColor = "#ffd166";
    burstSecondaryColor = "#ff4d6d";
    burstAccentColor = "#88e0ff";
    debugAnchor = false;

    static properties = {
        cutsceneEntityId: {
            title: "Cutscene Entity",
            editor: "entity",
            filterTypes: ["cutscene"],
        },
        rocketEntityId: {
            title: "Rocket Entity",
            editor: "entity",
            filterTypes: ["all"],
        },
        playOnStart: { title: "Play On Start" },
        hideRocketOnExplode: { title: "Hide Rocket On Explode" },
        explodeHideDelay: { title: "Explode Hide Delay", min: 0, max: 1, step: 0.01 },
        rocketOffset: {
            title: "Rocket Offset",
            min: -10,
            max: 10,
            step: 0.01,
        },
        ascentDuration: { title: "Ascent Duration", min: 0.1, max: 5, step: 0.05 },
        flameRate: { title: "Flame Rate", min: 1, max: 120, step: 1 },
        flameSpread: { title: "Flame Spread", min: 0, max: 1, step: 0.01 },
        flameLift: { title: "Flame Lift", min: 0, max: 2, step: 0.01 },
        flameLifetime: { title: "Flame Lifetime", min: 0.1, max: 3, step: 0.05 },
        flameSize: { title: "Flame Size", min: 0.02, max: 0.4, step: 0.01 },
        burstCount: { title: "Burst Count", min: 4, max: 180, step: 1 },
        burstSpeed: { title: "Burst Speed", min: 0.5, max: 12, step: 0.1 },
        burstLifetime: { title: "Burst Lifetime", min: 0.2, max: 5, step: 0.05 },
        burstUpBias: { title: "Burst Up Bias", min: 0, max: 3, step: 0.05 },
        gravity: { title: "Gravity", min: 0, max: 10, step: 0.1 },
        flameColor: { title: "Flame Color" },
        flameAccentColor: { title: "Flame Accent" },
        burstPrimaryColor: { title: "Burst Primary" },
        burstSecondaryColor: { title: "Burst Secondary" },
        burstAccentColor: { title: "Burst Accent" },
        debugAnchor: { title: "Debug Anchor" },
        playCutscene: { title: "Play Cutscene", editor: "action" },
    };

    _cutscene = null;
    _boundCutsceneEntityId = "";
    _playQueued = false;
    _flameTimer = 0;
    _flameAccumulator = 0;
    _particles = [];
    _lastHandledMarkerKey = "";
    _lastHandledMarkerAt = 0;
    _hideRocketTimeoutId = null;

    initialize() {
        this._playQueued = !!this.playOnStart;
        this._setRocketVisible(true);

        this._bindCutscene();
        this._maybePlayCutscene();
    }

    onPropertyChanged(name) {
        if (name === "cutsceneEntityId") {
            this._playQueued = !!this.playOnStart;
            this._bindCutscene(true);
            this._maybePlayCutscene();
            return;
        }

        if (name === "playOnStart") {
            this._playQueued = !!this.playOnStart;
            this._maybePlayCutscene();
        }
    }

    update(dt) {
        if (!this._cutscene && this.cutsceneEntityId) {
            this._bindCutscene();
            this._maybePlayCutscene();
        }

        if (this._flameTimer > 0) {
            this._flameTimer = Math.max(0, this._flameTimer - dt);
            this._flameAccumulator += dt * this.flameRate;

            while (this._flameAccumulator >= 1) {
                this._flameAccumulator -= 1;
                this._spawnFlameParticle(this._getAnchorPosition(), this._getFlamePalette());
            }
        }

        if (this.debugAnchor) {
            this._drawDebugAnchor();
        }

        this._updateParticles(dt);
    }

    playCutscene() {
        const cutscene = this._cutscene || this._bindCutscene();
        if (!cutscene) {
            this.warn("FireworkMarkerFX: No cutscene script selected.");
            return false;
        }

        this._setRocketVisible(true);
        this._playQueued = false;
        cutscene.playCutscene();
        return true;
    }

    _maybePlayCutscene() {
        if (!this._playQueued || !this._cutscene) {
            return false;
        }

        return this.playCutscene();
    }

    _bindCutscene(forceRebind = false) {
        const entityId = typeof this.cutsceneEntityId === "string"
            ? this.cutsceneEntityId.trim()
            : "";

        if (!entityId) {
            this._unbindCutscene();
            this._boundCutsceneEntityId = "";
            return null;
        }

        if (!forceRebind && this._cutscene && this._boundCutsceneEntityId === entityId) {
            return this._cutscene;
        }

        this._unbindCutscene();

        const cutscene = ArrivalSpace.getCutsceneScript(entityId);
        if (!cutscene) {
            this._boundCutsceneEntityId = entityId;
            return null;
        }

        cutscene.on?.("sequence:marker", this._onMarker, this);
        this._cutscene = cutscene;
        this._boundCutsceneEntityId = entityId;
        return cutscene;
    }

    _unbindCutscene() {
        this._cutscene?.off?.("sequence:marker", this._onMarker, this);
        this._cutscene = null;
    }

    _onMarker(payload = {}) {
        const marker = payload?.marker ?? {};
        const markerKey = `${marker.id ?? "marker"}:${marker.frameNumber ?? -1}`;
        const now = Date.now();

        if (this._lastHandledMarkerKey === markerKey && (now - this._lastHandledMarkerAt) < 48) {
            return;
        }

        this._lastHandledMarkerKey = markerKey;
        this._lastHandledMarkerAt = now;

        const markerEvent = this._getMarkerEventName(marker);
        if (!markerEvent) return;

        const anchorPosition = this._getAnchorPosition();

        if (markerEvent === "firework:explode") {
            this._flameTimer = 0;
            this._flameAccumulator = 0;
            this._emitExplosion(anchorPosition, this._getBurstPalette(marker.color));
            this._scheduleRocketHide();
            return;
        }

        if (markerEvent === "firework:end") {
            this._flameTimer = 0;
            this._flameAccumulator = 0;
            return;
        }

        if (
            markerEvent === "firework:ignite" ||
            markerEvent === "firework:trail" ||
            markerEvent === "firework:lift"
        ) {
            this._clearRocketHideTimeout();
            this._setRocketVisible(true);
            const duration = this._readMarkerDuration(marker);
            this._flameTimer = Math.max(this._flameTimer, duration);
            this._emitFlameBurst(anchorPosition, this._getFlamePalette(marker.color));
        }
    }

    _readMarkerDuration(marker) {
        const payloadDuration = Number(marker?.payload?.duration);
        return Number.isFinite(payloadDuration) && payloadDuration > 0
            ? payloadDuration
            : this.ascentDuration;
    }

    _getMarkerEventName(marker) {
        const explicitEvent = this._normalizeEventName(marker?.event);
        if (explicitEvent) return explicitEvent;

        const candidates = [marker?.label, marker?.id]
            .map((value) => this._normalizeEventName(value))
            .filter(Boolean);

        for (const candidate of candidates) {
            if (
                candidate.includes("explode") ||
                candidate.includes("burst") ||
                candidate.includes("detonate") ||
                candidate.includes("boom")
            ) {
                return "firework:explode";
            }

            if (
                candidate.includes("ignite") ||
                candidate.includes("launch") ||
                candidate.includes("trail") ||
                candidate.includes("lift") ||
                candidate.includes("ascent") ||
                candidate.includes("flame")
            ) {
                return "firework:trail";
            }
        }

        return "";
    }

    _normalizeEventName(value) {
        if (typeof value !== "string") return "";

        return value
            .trim()
            .toLowerCase()
            .replace(/[_\s]+/g, "-");
    }

    _getAnchorEntity() {
        // Anchor to the picked rocket entity if there is one, otherwise to the
        // plugin's own entity.
        return this._getEntityById(this.rocketEntityId) ?? this.entity;
    }

    _getEntityById(entityId) {
        const id = typeof entityId === "string" ? entityId.trim() : "";
        if (!id) return null;

        const gateServer = this.app.root.findByName("GateServer")?.script?.gateServer;
        return gateServer?.getEntity?.(id) ?? null;
    }

    _setRocketVisible(visible) {
        const rocketEntity = this._getEntityById(this.rocketEntityId);
        if (!rocketEntity) return;

        rocketEntity.enabled = !!visible;
    }

    _scheduleRocketHide() {
        this._clearRocketHideTimeout();

        if (!this.hideRocketOnExplode) {
            this._setRocketVisible(true);
            return;
        }

        const delayMs = Math.max(0, (Number(this.explodeHideDelay) || 0) * 1000);
        this._hideRocketTimeoutId = setTimeout(() => {
            this._hideRocketTimeoutId = null;
            this._setRocketVisible(false);
        }, delayMs);
    }

    _clearRocketHideTimeout() {
        if (this._hideRocketTimeoutId === null) return;
        clearTimeout(this._hideRocketTimeoutId);
        this._hideRocketTimeoutId = null;
    }

    _getAnchorPosition() {
        const anchor = this._getAnchorEntity();
        const anchorPosition = anchor?.getPosition?.() ?? this.entity?.getPosition?.() ?? new pc.Vec3();
        return new pc.Vec3(
            anchorPosition.x + (this.rocketOffset?.x ?? 0),
            anchorPosition.y + (this.rocketOffset?.y ?? 0),
            anchorPosition.z + (this.rocketOffset?.z ?? 0),
        );
    }

    _emitFlameBurst(origin, palette) {
        const count = Math.max(3, Math.round(this.flameRate * 0.14));
        for (let i = 0; i < count; i++) {
            this._spawnFlameParticle(origin, palette);
        }
    }

    _spawnFlameParticle(origin, palette = null) {
        const color = this._pickFrom(palette || this._getFlamePalette());
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * this.flameSpread;
        const lateralSpeed = this._randomBetween(0.03, this.flameSpread + 0.05);

        this._spawnParticle({
            origin: new pc.Vec3(
                origin.x + Math.cos(angle) * radius,
                origin.y + this._randomBetween(-0.04, 0.04),
                origin.z + Math.sin(angle) * radius,
            ),
            velocity: {
                x: Math.cos(angle) * lateralSpeed,
                y: -this._randomBetween(this.flameLift * 0.4, this.flameLift),
                z: Math.sin(angle) * lateralSpeed,
            },
            life: this._randomBetween(this.flameLifetime * 0.7, this.flameLifetime * 1.05),
            size: this._randomBetween(this.flameSize * 0.5, this.flameSize),
            color,
            geometry: "sphere",
            gravityScale: 0.15,
            drag: 0.88,
            emissiveStrength: 1.15,
        });
    }

    _emitExplosion(origin, palette) {
        for (let i = 0; i < this.burstCount; i++) {
            const direction = this._randomBurstDirection();
            const speed = this._randomBetween(this.burstSpeed * 0.6, this.burstSpeed * 1.15);

            this._spawnParticle({
                origin: new pc.Vec3(origin.x, origin.y, origin.z),
                velocity: {
                    x: direction.x * speed,
                    y: direction.y * speed + this.burstUpBias,
                    z: direction.z * speed,
                },
                life: this._randomBetween(this.burstLifetime * 0.75, this.burstLifetime * 1.2),
                size: this._randomBetween(this.flameSize * 0.45, this.flameSize * 1.15),
                color: this._pickFrom(palette),
                geometry: i % 4 === 0 ? "box" : "sphere",
                gravityScale: 1,
                drag: 0.985,
                emissiveStrength: 0.55,
            });
        }
    }

    _spawnParticle({
        origin,
        velocity,
        life,
        size,
        color,
        geometry,
        gravityScale,
        drag,
        emissiveStrength,
    }) {
        const entity = new pc.Entity("FireworkMarkerParticle");
        const material = this._createMaterial(color, emissiveStrength);
        const renderType = geometry === "box" ? "box" : "sphere";

        entity.addComponent("render", { type: renderType, material });
        (this.app.root ?? this.entity).addChild(entity);
        entity.setPosition(origin.x, origin.y, origin.z);
        entity.setLocalScale(size, size, size);
        entity.setEulerAngles(Math.random() * 360, Math.random() * 360, Math.random() * 360);

        this._particles.push({
            age: 0,
            drag,
            entity,
            gravityScale,
            life,
            material,
            size,
            spin: {
                x: this._randomBetween(-220, 220),
                y: this._randomBetween(-220, 220),
                z: this._randomBetween(-220, 220),
            },
            velocity: {
                x: velocity.x,
                y: velocity.y,
                z: velocity.z,
            },
        });
    }

    _updateParticles(dt) {
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const particle = this._particles[i];
            particle.age += dt;

            if (particle.age >= particle.life || !particle.entity) {
                this._destroyParticle(particle);
                this._particles.splice(i, 1);
                continue;
            }

            particle.velocity.y -= this.gravity * particle.gravityScale * dt;
            particle.velocity.x *= particle.drag;
            particle.velocity.y *= particle.drag;
            particle.velocity.z *= particle.drag;

            const position = particle.entity.getPosition();
            particle.entity.setPosition(
                position.x + particle.velocity.x * dt,
                position.y + particle.velocity.y * dt,
                position.z + particle.velocity.z * dt,
            );

            const euler = particle.entity.getEulerAngles();
            particle.entity.setEulerAngles(
                euler.x + particle.spin.x * dt,
                euler.y + particle.spin.y * dt,
                euler.z + particle.spin.z * dt,
            );

            const remaining = 1 - (particle.age / particle.life);
            const scale = Math.max(0.001, particle.size * remaining);
            particle.entity.setLocalScale(scale, scale, scale);
        }
    }

    _drawDebugAnchor() {
        const origin = this._getAnchorPosition();
        const color = this._hexToColor(this.burstAccentColor);
        const size = 0.22;

        this.app.drawLineArrays([
            origin.x - size, origin.y, origin.z, origin.x + size, origin.y, origin.z,
            origin.x, origin.y - size, origin.z, origin.x, origin.y + size, origin.z,
            origin.x, origin.y, origin.z - size, origin.x, origin.y, origin.z + size,
        ], color, false);
    }

    _randomBurstDirection() {
        const theta = Math.random() * Math.PI * 2;
        const y = this._randomBetween(-0.1, 1);
        const radial = Math.sqrt(Math.max(0, 1 - y * y));

        return {
            x: Math.cos(theta) * radial,
            y,
            z: Math.sin(theta) * radial,
        };
    }

    _getFlamePalette(markerColor) {
        return [
            markerColor,
            this.flameColor,
            this.flameAccentColor,
        ].filter(Boolean);
    }

    _getBurstPalette(markerColor) {
        return [
            markerColor,
            this.burstPrimaryColor,
            this.burstSecondaryColor,
            this.burstAccentColor,
        ].filter(Boolean);
    }

    _createMaterial(colorHex, emissiveStrength = 0.5) {
        const color = this._hexToColor(colorHex);
        const material = new pc.StandardMaterial();
        material.diffuse = new pc.Color(color.r * 0.22, color.g * 0.22, color.b * 0.22);
        material.emissive = new pc.Color(
            color.r * emissiveStrength,
            color.g * emissiveStrength,
            color.b * emissiveStrength,
        );
        material.opacity = 0.96;
        material.blendType = pc.BLEND_ADDITIVEALPHA;
        material.update();
        return material;
    }

    _destroyParticle(particle) {
        particle.material?.destroy?.();
        particle.entity?.destroy?.();
    }

    _pickFrom(list) {
        return list[Math.floor(Math.random() * list.length)] || this.flameColor;
    }

    _randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    _hexToColor(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) {
            return new pc.Color(1, 0.86, 0.4);
        }

        return new pc.Color(
            parseInt(match[1], 16) / 255,
            parseInt(match[2], 16) / 255,
            parseInt(match[3], 16) / 255,
        );
    }

    destroy() {
        this._clearRocketHideTimeout();
        this._unbindCutscene();

        for (const particle of this._particles) {
            this._destroyParticle(particle);
        }

        this._particles.length = 0;
    }
}
