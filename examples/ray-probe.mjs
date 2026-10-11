/**
 * Ray Probe — a drone circles above the vibe and measures its height above the ground twice:
 * against what is DRAWN (ArrivalSpace.raycastVisual - the splat the player sees) and against
 * COLLIDERS (ArrivalSpace.raycastPhysics - the space's ground box or collision mesh).
 *
 * Green: visible ground. Red: collider. In a splat space without a collision mesh the two
 * differ wherever the captured ground is not flat, and over a tent or a car the physics ray
 * goes straight through to the floor.
 *
 * Features demonstrated:
 * - ArrivalSpace.raycastVisual: a 3D ray through what is drawn, async (a few frames)
 * - ArrivalSpace.raycastPhysics: a synchronous ray against colliders
 * - keeping one async ray in flight from update() and drawing the latest result every frame
 * - an HTML label that follows a 3D point (camera.worldToScreen)
 *
 * Requires ArrivalSpace.VERSION >= 1.21.0.
 */
export class RayProbe extends ArrivalScript {
    static scriptName = "Ray Probe";

    radius = 3;
    height = 3;
    speed = 0.3;
    minSplatOpacity = 0.1;

    static properties = {
        radius: { title: "Orbit Radius (m)", min: 0.5, max: 20 },
        height: { title: "Flight Height (m)", min: 0.5, max: 20 },
        speed: { title: "Speed (laps/10 s)", min: 0, max: 3 },
        minSplatOpacity: { title: "Min Splat Opacity", min: 0.01, max: 1, step: 0.01 },
    };

    _t = 0;
    _drone = null;
    _visual = null;     // latest raycastVisual hit
    _physics = null;    // latest raycastPhysics hit
    _busy = false;

    initialize() {
        if (!ArrivalSpace.raycastVisual) {
            this.warn("Ray Probe needs ArrivalSpace.VERSION >= 1.21.0 (raycastVisual)");
            return;
        }
        const mat = new pc.StandardMaterial();
        mat.diffuse = new pc.Color(0.15, 0.15, 0.18);
        mat.emissive = new pc.Color(1, 0.8, 0.2);
        mat.update();
        this._drone = new pc.Entity("RayProbeDrone");
        this._drone.addComponent("render", { type: "sphere", material: mat });
        this._drone.setLocalScale(0.25, 0.12, 0.25);
        this.entity.addChild(this._drone);

        this._label = this.createUI("div", {
            interactive: false,
            style: {
                position: "fixed", left: "0", top: "0", padding: "3px 8px", borderRadius: "6px", pointerEvents: "none",
                background: "#111d", color: "white", font: "12px system-ui, sans-serif", whiteSpace: "nowrap", zIndex: "5",
            },
        });
    }

    update(dt) {
        if (!this._drone) return;
        this._t += dt * this.speed * Math.PI * 2 / 10;
        const c = this.entity.getPosition();
        const p = new pc.Vec3(c.x + Math.cos(this._t) * this.radius, c.y + this.height, c.z + Math.sin(this._t) * this.radius);
        this._drone.setPosition(p);

        // physics is synchronous: every frame
        this._physics = ArrivalSpace.raycastPhysics(p, { x: 0, y: -1, z: 0 }, 50, { ignore: [this._drone] });
        // the visual ray takes a few frames: keep one in flight, use the latest answer
        if (!this._busy) {
            this._busy = true;
            ArrivalSpace.raycastVisual(p, { x: 0, y: -1, z: 0 }, 50, { ignore: [this._drone], minSplatOpacity: this.minSplatOpacity })
                .then((hit) => { this._visual = hit && { ...hit, from: p.clone() }; })
                .finally(() => { this._busy = false; });
        }
        this._draw(p);
    }

    _draw(p) {
        const green = new pc.Color(0.2, 1, 0.4), red = new pc.Color(1, 0.25, 0.25);
        const v = this._visual, ph = this._physics;
        // the visual hit belongs to where the drone was when the ray left - draw it from there
        if (v) {
            this.app.drawLine(v.from, v.point, green, false);
            this._cross(v.point, green);
        }
        if (ph) {
            this.app.drawLine(p, ph.point, red, false);
            this._cross(ph.point, red);
        }

        const camera = ArrivalSpace.getCamera()?.camera;
        const s = camera?.worldToScreen(p, new pc.Vec3());
        if (!s || s.z < 0) { this._label.style.display = "none"; return; }
        this._label.style.display = "block";
        this._label.style.transform = `translate(${s.x + 14}px, ${s.y - 10}px)`;
        const m = (d) => (d === undefined ? "–" : `${d.toFixed(2)} m`);
        this._label.innerHTML = `<span style="color:#5f6">visible ${m(v?.distance)}</span> · <span style="color:#f66">collider ${m(ph?.distance)}</span>`;
    }

    _cross(at, color) {
        const s = 0.15;
        this.app.drawLine(new pc.Vec3(at.x - s, at.y, at.z), new pc.Vec3(at.x + s, at.y, at.z), color, false);
        this.app.drawLine(new pc.Vec3(at.x, at.y, at.z - s), new pc.Vec3(at.x, at.y, at.z + s), color, false);
    }

    destroy() {
        this._drone = null;
    }
}
