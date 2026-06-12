/**
 * Splat Crop
 *
 * A movable crop box for the space's already-loaded Gaussian splat(s). This
 * vibe's OWN entity is the oriented box: move/rotate it with the gizmo and set
 * its dimensions with the Size property. Everything whose splat-center falls
 * inside the box is kept (or removed, with Invert); everything else is hidden.
 *
 * The crop is purely spatial. It applies to the scene's unified splat material
 * AND every non-unified gsplat material, so it crops all splats in the box at
 * once — the box is the only selector (a per-entity reference is meaningless for
 * the shared unified material). Implemented as a gsplatModifyVS shader chunk
 * (GLSL + WGSL) so it works on WebGL and WebGPU.
 */

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export class SplatCrop extends ArrivalScript {
    static scriptName = "Splat Crop";

    size = { x: 10, y: 10, z: 10 };
    invert = false;
    edgeScaleFactor = 0.5;
    showBox = true;

    static properties = {
        size: { title: "Box Size (m)", min: 0.1, max: 1000, step: 0.1 },
        invert: { title: "Invert (carve hole)" },
        edgeScaleFactor: { title: "Edge Softness", min: 0.01, max: 1, step: 0.01 },
        showBox: { title: "Show Box" },
    };

    // ── internal state (filled in later tasks) ──
    _boxColor = new pc.Color(0.2, 1, 0.4, 1);

    initialize() {
        // shader acquisition wired up in Task 2
    }

    update(dt) {
        if (this.showBox) this._drawBox();
    }

    onPropertyChanged(name) {
        // uniform updates wired up in Task 3
    }

    destroy() {
        // material restore wired up in Task 2
    }

    // ────────────────────────────────────────────
    // Debug box (oriented wireframe of the crop volume)
    // ────────────────────────────────────────────

    /** World-space corners of the oriented box (entity pos+rot, size dims, scale ignored). */
    _boxCorners() {
        const m = new pc.Mat4();
        m.setTRS(this.entity.getPosition(), this.entity.getRotation(), pc.Vec3.ONE);
        const hx = this.size.x / 2, hy = this.size.y / 2, hz = this.size.z / 2;
        const signs = [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ];
        return signs.map(([sx, sy, sz]) =>
            m.transformPoint(new pc.Vec3(sx * hx, sy * hy, sz * hz)));
    }

    _drawBox() {
        const c = this._boxCorners();
        const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0], // bottom
            [4, 5], [5, 6], [6, 7], [7, 4], // top
            [0, 4], [1, 5], [2, 6], [3, 7], // verticals
        ];
        for (const [a, b] of edges) {
            this.app.drawLine(c[a], c[b], this._boxColor);
        }
    }
}
