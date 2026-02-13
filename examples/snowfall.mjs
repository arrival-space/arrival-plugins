/**
 * Snowfall Particle Plugin - Configurable snow effect using PlayCanvas particle system
 *
 * Features demonstrated:
 * - PlayCanvas particle system with tunable curves
 * - Procedural default texture (soft radial gradient)
 * - Custom texture loading via ArrivalSpace.loadTexture()
 * - Live property updates via onPropertyChanged()
 * - Hex color string (snowColor) → color picker in UI
 * - Vec3 property (windDirection) → X/Y/Z inputs
 *
 * Properties:
 * - numParticles: Max simulated particles (100-5000)
 * - lifetime: Particle lifespan in seconds
 * - emitterWidth / emitterDepth: Box emitter dimensions
 * - snowColor: Particle tint (#hex → color picker)
 * - opacity: Max alpha (0-1)
 * - particleSizeMin / particleSizeMax: Size range
 * - fallSpeed: Downward velocity
 * - windDirection: Wind vector (vec3 → X/Y/Z inputs)
 * - windStrength: Wind multiplier
 * - turbulence: Random sideways drift strength
 * - textureUrl: Custom snowflake texture URL
 * - rotationSpeed: Particle spin in degrees/second
 */

export class Snowfall extends ArrivalScript {
    static scriptName = "snowfall";

    // Public properties - configurable in UI
    debug = false;
    numParticles = 3000;
    lifetime = 100;
    emitterWidth = 20;
    emitterDepth = 20;
    spawnHeight = 7;
    killHeight = -5;
    snowColor = "#e8f0ff";
    opacity = 0.85;
    alphaTest = true;
    particleSizeMin = 0.01;
    particleSizeMax = 0.02;
    fallSpeed = 1.0;
    windDirection = { x: 0.3, y: 0, z: 0.2 };
    windStrength = 0.6;
    turbulence = 0.4;
    textureUrl = "https://dzrmwng2ae8bq.cloudfront.net/42485456/10d5001cb6a87179478df46a32bb03059f8da3334b6f4de83e16c5c8d98b8890_52-snowflake-png-image.png";
    rotationSpeed = 50;
    followCamera = true;

    // Optional UI hints
    static properties = {
        numParticles: { title: "Particle Count", min: 10, max: 16384 },
        lifetime: { title: "Lifetime (s)", min: 1, max: 100 },
        emitterWidth: { title: "Emitter Width", min: 1, max: 100 },
        emitterDepth: { title: "Emitter Depth", min: 1, max: 100 },
        spawnHeight: { title: "Spawn Height", min: -10, max: 40 },
        killHeight: { title: "Kill Height", min: -10, max: 40 },
        snowColor: { title: "Snow Color" },
        opacity: { title: "Opacity", min: 0, max: 1 },
        particleSizeMin: { title: "Size Min", min: 0.005, max: 0.5 },
        particleSizeMax: { title: "Size Max", min: 0.005, max: 1 },
        fallSpeed: { title: "Fall Speed", min: 0.1, max: 10 },
        windDirection: { title: "Wind Direction", min: -5, max: 5 },
        windStrength: { title: "Wind Strength", min: 0, max: 5 },
        turbulence: { title: "Turbulence", min: 0, max: 3 },
        textureUrl: { title: "Texture URL" },
        rotationSpeed: { title: "Rotation Speed", min: 0, max: 360 },
        followCamera: { title: "Follow Camera" },
        alphaTest: { title: "Alpha Test" },
        debug: { title: "Debug Mode" },
    };

    // Private state
    _particleEntity = null;
    _defaultTexture = null;
    _loadedTexture = null;
    _loadedTextureAsset = null;
    _currentTextureUrl = "";
    _isLoadingTexture = false;
    _debugTexture = null;
    _lastDebug = false;
    _logTimer = 0;

    initialize() {
        console.log("Snowfall initialized on entity:", this.entity.name);

        // Create procedural textures
        this._defaultTexture = this._createDefaultTexture();
        this._debugTexture = this._createDebugTexture();

        // Build the particle system
        this._buildParticleSystem();

        // If a texture URL is provided at init, load it
        if (this.textureUrl) {
            this._loadTexture(this.textureUrl);
        }
    }

    // ───────────────────────────────────────────────
    // Procedural default texture (soft radial circle)
    // ───────────────────────────────────────────────

    _createDefaultTexture() {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        const cx = size / 2;
        const cy = size / 2;
        const radius = size / 2;

        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
        gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.8)");
        gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.3)");
        gradient.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        const texture = new pc.Texture(this.app.graphicsDevice, {
            name: "SnowfallDefaultTexture",
            width: size,
            height: size,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: true,
            minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: pc.FILTER_LINEAR,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
            levels: [canvas],
        });
        return texture;
    }

    _createDebugTexture() {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, size, size);

        const texture = new pc.Texture(this.app.graphicsDevice, {
            name: "SnowfallDebugTexture",
            width: size,
            height: size,
            format: pc.PIXELFORMAT_R8_G8_B8_A8,
            mipmaps: false,
            minFilter: pc.FILTER_NEAREST,
            magFilter: pc.FILTER_NEAREST,
            addressU: pc.ADDRESS_CLAMP_TO_EDGE,
            addressV: pc.ADDRESS_CLAMP_TO_EDGE,
            levels: [canvas],
        });
        return texture;
    }

    // ───────────────────────────────────────────────
    // Texture loading
    // ───────────────────────────────────────────────

    async _loadTexture(url) {
        if (!url || this._isLoadingTexture) return;
        if (url === this._currentTextureUrl && this._loadedTexture) return;

        this._isLoadingTexture = true;
        console.log("Snowfall: Loading texture from:", url);

        // Clean up previous loaded texture
        if (this._loadedTextureAsset) {
            this.app.assets.remove(this._loadedTextureAsset);
            this._loadedTextureAsset.unload();
            this._loadedTextureAsset = null;
        }
        this._loadedTexture = null;

        try {
            const { texture, asset } = await ArrivalSpace.loadTexture(url, {
                mipmaps: true,
                anisotropy: 4,
            });
            this._loadedTexture = texture;
            this._loadedTextureAsset = asset;
            this._currentTextureUrl = url;
            this._applyTexture(texture);
            console.log("Snowfall: Texture loaded successfully");
        } catch (err) {
            console.error("Snowfall: Failed to load texture:", err);
            this._applyTexture(this._defaultTexture);
            this._currentTextureUrl = "";
        }

        this._isLoadingTexture = false;
    }

    _applyTexture(texture) {
        if (this._particleEntity?.particlesystem) {
            this._particleEntity.particlesystem.colorMap = texture;
        }
    }

    _getActiveTexture() {
        if (this.debug) return this._debugTexture;
        return this._loadedTexture || this._defaultTexture;
    }

    // ───────────────────────────────────────────────
    // Curve builders
    // ───────────────────────────────────────────────

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (result) {
            return {
                r: parseInt(result[1], 16) / 255,
                g: parseInt(result[2], 16) / 255,
                b: parseInt(result[3], 16) / 255,
            };
        }
        return { r: 0.91, g: 0.94, b: 1.0 }; // fallback: light blueish white
    }

    _buildLocalVelocityCurves() {
        const t = this.turbulence;

        const localVelocity = new pc.CurveSet([
            [0, -t, 1, -t],
            [0, -this.fallSpeed, 1, -this.fallSpeed],
            [0, -t * 0.7, 1, -t * 0.7],
        ]);

        const localVelocity2 = new pc.CurveSet([
            [0, t, 1, t],
            [0, -this.fallSpeed * 1.3, 1, -this.fallSpeed * 0.7],
            [0, t * 0.7, 1, t * 0.7],
        ]);

        return { localVelocity, localVelocity2 };
    }

    _buildWorldVelocityCurve() {
        const wx = this.windDirection.x * this.windStrength;
        const wy = this.windDirection.y * this.windStrength;
        const wz = this.windDirection.z * this.windStrength;

        const velocity = new pc.CurveSet([
            [0, wx, 1, wx],
            [0, wy, 1, wy],
            [0, wz, 1, wz],
        ]);
        return velocity;
    }

    _buildScaleGraphs() {
        const scaleGraph = new pc.Curve([0, this.particleSizeMin, 0.1, this.particleSizeMax, 0.8, this.particleSizeMax, 1, this.particleSizeMin * 0.5]);
        scaleGraph.type = pc.CURVE_SMOOTHSTEP;

        const scaleGraph2 = new pc.Curve([0, this.particleSizeMax, 0.1, this.particleSizeMax * 1.2, 0.8, this.particleSizeMax * 1.1, 1, this.particleSizeMin]);
        scaleGraph2.type = pc.CURVE_SMOOTHSTEP;

        return { scaleGraph, scaleGraph2 };
    }

    _buildAlphaGraph() {
        const alphaGraph = new pc.Curve([0, 0, 0.1, this.opacity, 0.8, this.opacity, 1, 0]);
        alphaGraph.type = pc.CURVE_SMOOTHSTEP;
        return alphaGraph;
    }

    _buildColorGraph() {
        const rgb = this._hexToRgb(this.snowColor);
        const colorGraph = new pc.CurveSet([
            [0, rgb.r, 1, rgb.r],
            [0, rgb.g, 1, rgb.g],
            [0, rgb.b, 1, rgb.b],
        ]);
        return colorGraph;
    }

    _buildRotationSpeedGraph() {
        const rSpeed = this.rotationSpeed;
        const rotationSpeedGraph = new pc.Curve([0, rSpeed, 1, rSpeed]);
        return rotationSpeedGraph;
    }

    // ───────────────────────────────────────────────
    // Particle system build / rebuild
    // ───────────────────────────────────────────────

    _buildParticleSystem() {
        // Destroy existing
        if (this._particleEntity) {
            this._particleEntity.destroy();
            this._particleEntity = null;
        }

        const { localVelocity, localVelocity2 } = this._buildLocalVelocityCurves();
        const velocityGraph = this._buildWorldVelocityCurve();
        const { scaleGraph, scaleGraph2 } = this._buildScaleGraphs();
        const alphaGraph = this._buildAlphaGraph();
        const colorGraph = this._buildColorGraph();
        const rotationSpeedGraph = this._buildRotationSpeedGraph();

        this._particleEntity = new pc.Entity("SnowfallParticles");
        this.entity.addChild(this._particleEntity);

        // Position emitter above the entity
        this._particleEntity.setLocalPosition(0, this.spawnHeight, 0);

        // Auto-calculate rate so the pool stays fully utilized
        const num = Math.max(10, Math.floor(this.numParticles));
        const pcRate = Math.max(0.0001, this.lifetime / num);

        this._particleEntity.addComponent("particlesystem", {
            numParticles: num,
            rate: pcRate,
            rate2: pcRate,
            lifetime: this.lifetime,
            emitterShape: pc.EMITTERSHAPE_BOX,
            emitterExtents: new pc.Vec3(this.emitterWidth, 0.5, this.emitterDepth),
            wrap: true,
            wrapBounds: new pc.Vec3(this.emitterWidth, this.spawnHeight - this.killHeight, this.emitterDepth),
            orientation: pc.PARTICLEORIENTATION_SCREEN,
            blendType: this.alphaTest ? pc.BLEND_NONE : pc.BLEND_NORMAL,
            depthWrite: true,
            localVelocityGraph: localVelocity,
            localVelocityGraph2: localVelocity2,
            velocityGraph: velocityGraph,
            scaleGraph: scaleGraph,
            scaleGraph2: scaleGraph2,
            alphaGraph: alphaGraph,
            colorGraph: colorGraph,
            startAngle: 0,
            startAngle2: 360,
            rotationSpeedGraph: rotationSpeedGraph,
            colorMap: this._getActiveTexture(),
            sort: pc.PARTICLESORT_NONE,
            lighting: false,
            halfLambert: false,
            loop: true,
            preWarm: true,
            animLoop: true,
            layers: [this.app.scene.layers.getLayerByName("Splats").id],
        });
    }

    // ───────────────────────────────────────────────
    // Update curves in-place (no rebuild needed)
    // ───────────────────────────────────────────────

    _updateCurvesInPlace() {
        const ps = this._particleEntity?.particlesystem;
        if (!ps) return;

        const { localVelocity, localVelocity2 } = this._buildLocalVelocityCurves();
        ps.localVelocityGraph = localVelocity;
        ps.localVelocityGraph2 = localVelocity2;

        ps.velocityGraph = this._buildWorldVelocityCurve();

        const { scaleGraph, scaleGraph2 } = this._buildScaleGraphs();
        ps.scaleGraph = scaleGraph;
        ps.scaleGraph2 = scaleGraph2;

        ps.alphaGraph = this._buildAlphaGraph();
        ps.colorGraph = this._buildColorGraph();
        ps.rotationSpeedGraph = this._buildRotationSpeedGraph();
    }

    // ───────────────────────────────────────────────
    // Property change handler
    // ───────────────────────────────────────────────

    onPropertyChanged(name, value, oldValue) {
        // Structural changes require full rebuild
        const rebuildProps = ['numParticles', 'lifetime', 'emitterWidth', 'emitterDepth', 'spawnHeight', 'killHeight', 'alphaTest'];
        if (rebuildProps.includes(name)) {
            this._buildParticleSystem();
            return;
        }

        // Texture URL change
        if (name === 'textureUrl') {
            if (value) {
                this._loadTexture(value);
            } else {
                if (this._loadedTextureAsset) {
                    this.app.assets.remove(this._loadedTextureAsset);
                    this._loadedTextureAsset.unload();
                    this._loadedTextureAsset = null;
                }
                this._loadedTexture = null;
                this._currentTextureUrl = "";
                this._applyTexture(this._defaultTexture);
            }
            return;
        }

        // Debug toggle
        if (name === 'debug') {
            this._applyTexture(this._getActiveTexture());
            return;
        }

        // Cheap curve property changes
        const curveProps = ['snowColor', 'opacity', 'particleSizeMin', 'particleSizeMax', 'fallSpeed', 'windDirection', 'windStrength', 'turbulence', 'rotationSpeed'];
        if (curveProps.includes(name)) {
            this._updateCurvesInPlace();
        }
    }

    // ───────────────────────────────────────────────
    // Update loop
    // ───────────────────────────────────────────────

    update(dt) {
        // Follow camera — position at volume center so top=spawnHeight, bottom=killHeight
        if (this.followCamera && this._particleEntity) {
            const camera = this.app.systems.camera?.cameras?.[0]?.entity;
            if (camera) {
                const camPos = camera.getPosition();
                this._particleEntity.setPosition(
                    camPos.x,
                    camPos.y + (this.spawnHeight + this.killHeight) / 2,
                    camPos.z
                );
            }
        }

        // Log alive particle count every 2 seconds (only when debug is on)
        if (this.debug) {
            this._logTimer += dt;
            if (this._logTimer >= 2) {
                this._logTimer = 0;
                const emitter = this._particleEntity?.particlesystem?.emitter;
                if (emitter && emitter.particleTex) {
                    const stride = emitter.numParticleVerts * 4;
                    const lifeOffset = 2 * 4 + 3;
                    const num = emitter.numParticles;
                    let alive = 0;
                    for (let i = 0; i < num; i++) {
                        const life = emitter.particleTex[i * stride + lifeOffset];
                        if (life > 0 && life < emitter.lifetime) alive++;
                    }
                    console.log(`Snowfall: ${alive} / ${num} particles alive`);
                }
            }
        }
    }

    destroy() {
        if (this._particleEntity) {
            this._particleEntity.destroy();
            this._particleEntity = null;
        }
        if (this._defaultTexture) {
            this._defaultTexture.destroy();
            this._defaultTexture = null;
        }
        if (this._debugTexture) {
            this._debugTexture.destroy();
            this._debugTexture = null;
        }
        if (this._loadedTextureAsset) {
            this.app.assets.remove(this._loadedTextureAsset);
            this._loadedTextureAsset.unload();
            this._loadedTextureAsset = null;
        }
        this._loadedTexture = null;
    }
}
