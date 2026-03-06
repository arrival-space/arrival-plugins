export class LocalizedLightProbePlugin extends ArrivalScript {
    static scriptName = "Light Probe";

    probeEnabled = true;
    radius = 2;
    falloffExponent = 2;
    priority = 0;
    overridePrimaryLight = true;
    overrideEnvironment = false;
    overridePostEffects = false;
    azimuth = 0;
    elevation = -45;
    primaryLightColor = "#ffffff";
    primaryLightIntensity = 2.2;
    primaryShadowIntensity = 1.0;
    hdrUrl = "";
    hdrEncoding = "linear";
    environmentRotation = 0;
    environmentIntensity = 3;
    postSaturation = 1.0;
    postContrast = 1.0;
    postBrightness = 1.0;
    postSharpness = 1.0;
    postBloomIntensity = 0.14;
    postBloomThreshold = 0.9;
    debugVolume = false;

    static properties = {
        probeEnabled: { title: "Enabled" },
        debugVolume: { title: "Debug Volume" },
        radius: { title: "Radius", min: 0.1, max: 100, step: 0.1 },
        falloffExponent: { title: "Falloff", min: 0.1, max: 8, step: 0.1 },
        priority: { title: "Priority", min: -100, max: 100, step: 1 },
        overridePrimaryLight: { title: "Override Light" },
        azimuth: { title: "Azimuth", min: -180, max: 180, step: 1, enabledBy: "overridePrimaryLight" },
        elevation: { title: "Elevation", min: -89, max: 89, step: 1, enabledBy: "overridePrimaryLight" },
        primaryLightColor: { title: "Light Color", enabledBy: "overridePrimaryLight" },
        primaryLightIntensity: { title: "Light Intensity", min: 0, max: 20, step: 0.01, enabledBy: "overridePrimaryLight" },
        primaryShadowIntensity: { title: "Shadow Intensity", min: 0, max: 1, step: 0.01, enabledBy: "overridePrimaryLight" },
        overrideEnvironment: { title: "Override Environment" },
        hdrUrl: { title: "HDR URL", editor: "asset", enabledBy: "overrideEnvironment" },
        hdrEncoding: { title: "HDR Encoding", enabledBy: "overrideEnvironment" },
        environmentRotation: { title: "Env Rotation", min: -180, max: 180, step: 1, enabledBy: "overrideEnvironment" },
        environmentIntensity: { title: "Env Intensity", min: 0, max: 20, step: 0.01, enabledBy: "overrideEnvironment" },
        overridePostEffects: { title: "Override Post FX" },
        postSaturation: { title: "Saturation", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" },
        postContrast: { title: "Contrast", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" },
        postBrightness: { title: "Brightness", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" },
        postSharpness: { title: "Sharpness", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" },
        postBloomIntensity: { title: "Bloom Intensity", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" },
        postBloomThreshold: { title: "Bloom Threshold", min: 0, max: 3, step: 0.01, enabledBy: "overridePostEffects" }
    };

    initialize() {
        this._localizedProbe = null;
        this._lastPosition = this.position.clone();
        this._ensureProbe();

    }

    update() {
        this._ensureProbe();

        const currentPosition = this.position;
        if (this._localizedProbe && !currentPosition.equals(this._lastPosition)) {
            if (this._localizedProbe.setPosition(currentPosition)) {
                this._lastPosition.copy(currentPosition);
            } else {
                console.warn("LocalizedLightProbePlugin: setPosition failed", currentPosition);
            }
        }

        if (this.debugVolume) this._drawDebug();
    }

    destroy() {
        this._localizedProbe?.destroy();
        this._localizedProbe = null;
    }

    onPropertyChanged() {
        if (!this._localizedProbe) {
            this._ensureProbe();
            return;
        }

        const updated = this._localizedProbe.update({
            ...this._buildConfig(),
            radius: this.radius,
            falloffExponent: this.falloffExponent
        });

        if (!updated) {
            console.warn("LocalizedLightProbePlugin: update failed");
        }
    }

    _ensureProbe() {
        if (this._localizedProbe) return;

        this._localizedProbe = ArrivalSpace.createLocalizedLightProbe(
            this._buildConfig(),
            this.position,
            {
                radius: this.radius,
                falloffExponent: this.falloffExponent
            }
        );

        if (!this._localizedProbe) {
            console.warn("LocalizedLightProbePlugin: createLocalizedLightProbe failed");
        }
    }

    _buildConfig() {
        const config = {
            enabled: this.probeEnabled,
            priority: this.priority,
            primaryLight: undefined,
            environment: undefined,
            postEffects: undefined
        };

        if (this.overridePrimaryLight) {
            config.primaryLight = {
                direction: this._directionFromAngles(),
                color: this.primaryLightColor,
                intensity: this.primaryLightIntensity,
                shadowIntensity: this.primaryShadowIntensity
            };
        }

        if (this.overrideEnvironment) {
            config.environment = {
                hdrUrl: this.hdrUrl || null,
                hdrEncoding: this.hdrEncoding || "linear",
                rotation: this.environmentRotation,
                intensity: this.environmentIntensity
            };
        }

        if (this.overridePostEffects) {
            config.postEffects = {
                saturation: this.postSaturation,
                contrast: this.postContrast,
                brightness: this.postBrightness,
                sharpness: this.postSharpness,
                bloomIntensity: this.postBloomIntensity,
                bloomThreshold: this.postBloomThreshold
            };
        }

        return config;
    }

    _directionFromAngles() {
        const rotation = new pc.Quat().setFromEulerAngles(this.elevation, this.azimuth, 0);
        return rotation.transformVector(pc.Vec3.FORWARD.clone());
    }

    _drawDebug() {
        const center = this.position;
        const color = this._parseColor(this.primaryLightColor);
        this._drawCircle(center, this.radius, color);

        const lightVecQ = new pc.Quat().setFromEulerAngles(this.elevation +90, this.azimuth, 0);
        const direction = lightVecQ.transformVector(pc.Vec3.FORWARD.clone());
        
        const arrowEnd = center.clone().add(direction.mulScalar(Math.max(1, this.radius * 0.5)));
        this.app.drawLine(center, arrowEnd, color, false);
    }

    _drawCircle(center, radius, color) {
        if (radius <= 0) return;

        const segments = Math.min(40, Math.round(radius * Math.PI * 6));
        const step = (2 * Math.PI) / Math.max(3, segments);
        const positions = [];

        for (let i = 0; i < segments; i++) {
            const a0 = i * step;
            const a1 = (i + 1) * step;
            positions.push(
                center.x + radius * Math.cos(a0), center.y, center.z + radius * Math.sin(a0),
                center.x + radius * Math.cos(a1), center.y, center.z + radius * Math.sin(a1)
            );
        }

        this.app.drawLineArrays(positions, color, false);
    }

    _parseColor(value) {
        if (typeof value !== "string") {
            return new pc.Color(1, 1, 1);
        }

        let normalized = value;
        if (normalized[0] === "#") normalized = normalized.slice(1);
        if (normalized.length === 3) {
            normalized = normalized.split("").map((part) => part + part).join("");
        }
        if (normalized.length !== 6) {
            return new pc.Color(1, 1, 1);
        }

        const r = parseInt(normalized.slice(0, 2), 16) / 255;
        const g = parseInt(normalized.slice(2, 4), 16) / 255;
        const b = parseInt(normalized.slice(4, 6), 16) / 255;
        return new pc.Color(r, g, b);
    }
}

export function createPlugin() {
    return new LocalizedLightProbePlugin();
}
