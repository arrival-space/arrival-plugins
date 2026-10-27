/**
 * Kickable Ball — a football everyone in the space plays with together.
 *
 * Run into it to kick it the way you are running (the faster you run, the harder the kick),
 * or click it to kick it away from the camera. It rolls, bounces off the space's collision and
 * comes to rest. Everyone sees the same ball, players who join later included. A ball that falls
 * out of the world or rolls too far goes back to where it was placed, and so does a ball left
 * lying away from home for a while.
 *
 * Features demonstrated:
 * - a dynamic rigidbody with a sphere collider, CCD so hard kicks don't tunnel through walls
 * - a procedural texture: a canvas painted per pixel from directions on the sphere
 * - multiplayer by authority hand-over: the last kicker simulates the ball and streams its
 *   state through one synced attribute (late joiners get it too); everyone else shows it as a
 *   kinematic body that follows the stream smoothly
 * - kicking by walking: the local player's position and velocity against the ball
 * - ArrivalSpace.onEntityClick with stopPropagation, so a click kicks instead of walking there
 *
 * Requires ArrivalSpace.VERSION >= 1.12.0.
 */
export class KickableBall extends ArrivalScript {
    static scriptName = "Kickable Ball";

    size = 0.22;
    pattern = "Football";
    color = "#ffffff";
    patternColor = "#111111";
    bounciness = 0.6;
    kickStrength = 1;
    respawnDistance = 40;
    idleRespawnMinutes = 2;

    static properties = {
        size: { title: "Diameter (m)", min: 0.1, max: 2, step: 0.01 },
        pattern: { title: "Pattern", options: ["Football", "Beach ball", "Plain"] },
        color: { title: "Colour" },
        patternColor: { title: "Pattern colour" },
        bounciness: { title: "Bounciness", min: 0, max: 0.95, step: 0.05 },
        kickStrength: { title: "Kick strength ×", min: 0.2, max: 3, step: 0.1 },
        respawnDistance: { title: "Back home when this far away (m)", min: 5, max: 500, step: 1 },
        idleRespawnMinutes: { title: "Back home after lying away for (min, 0 = never)", min: 0, max: 60, step: 0.5 },
    };

    // The ball as the last kicker simulates it: { p, q, v, w: arrays, owner: userID, sid, rest }.
    // sid tells this client's own stream from the same account's other tab or earlier visit.
    _state = attribute(null, { sync: true, throttle: 100, onChange: "_onState" });

    _ball = null;
    _material = null;
    _texture = null;
    _offClick = null;
    _home = new pc.Vec3();
    _placed = new pc.Vec3();
    _target = null;       // remote: { p: Vec3, q: Quat, v: Vec3, at: ms }
    _sendAcc = 0;
    _kickCooldown = 0;
    _idleSince = 0;
    _owning = true;       // this client simulates the ball (else it follows the stream)
    _orphanCheck = 0;
    _tmp = new pc.Vec3();

    // Lengths are real metres; k maps them into this space's units (a space without a world
    // scale is 0.7).
    get _k() {
        const s = Number(this.app.worldScale);
        return s > 0 ? s : 0.7;
    }

    get _radius() {
        return this.size * 0.5 * this._k;
    }

    _sid = Math.random().toString(36).slice(2);

    initialize() {
        this._material = new pc.StandardMaterial();
        this._material.gloss = 0.55;
        this._material.useMetalness = true;
        this._material.metalness = 0;
        this._paint();
        this._build();
        this._placed.copy(this.entity.getPosition());
        this._respawn(false);
    }

    _build() {
        this._ball?.destroy();
        const r = this._radius;
        const ball = new pc.Entity("KickableBall");
        ball.addComponent("render", { type: "sphere", material: this._material });
        ball.setLocalScale(2 * r, 2 * r, 2 * r);
        ball.addComponent("collision", { type: "sphere", radius: r });
        ball.addComponent("rigidbody", {
            type: pc.BODYTYPE_DYNAMIC,
            mass: 0.43,
            friction: 0.6,
            restitution: this.bounciness,
            linearDamping: 0.05,
            angularDamping: 0.3,
        });
        this.entity.addChild(ball);
        this._ball = ball;
        this._setCcd();
        this._offClick?.();
        this._offClick = ArrivalSpace.onEntityClick(ball, (e) => {
            e.stopPropagation();
            const dir = ArrivalSpace.getCamera().forward.clone();
            dir.y = 0;
            dir.normalize();
            this._kick(dir, 8, 0.35);
        });
    }

    // Paints the texture: sphere directions from the sphere's UVs, coloured by pattern.
    _paint() {
        const W = 512, H = 256;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(W, H);
        const a = this._rgb(this.color), b = this._rgb(this.patternColor);
        const seam = [a[0] * 0.55, a[1] * 0.55, a[2] * 0.55];
        const centers = this.pattern === "Football" ? footballCenters() : null;
        for (let y = 0; y < H; y++) {
            const theta = ((y + 0.5) / H) * Math.PI;
            for (let x = 0; x < W; x++) {
                const phi = ((x + 0.5) / W) * 2 * Math.PI;
                let c = a;
                if (centers) {
                    const d = [Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
                    let best = -2, second = -2, bestI = 0;
                    for (let i = 0; i < centers.length; i++) {
                        const dot = d[0] * centers[i][0] + d[1] * centers[i][1] + d[2] * centers[i][2];
                        if (dot > best) { second = best; best = dot; bestI = i; }
                        else if (dot > second) second = dot;
                    }
                    c = best - second < 0.012 ? seam : bestI < 12 ? b : a;
                } else if (this.pattern === "Beach ball") {
                    const polar = theta < 0.3 || theta > Math.PI - 0.3;
                    c = polar ? a : Math.floor(phi / (Math.PI / 3)) % 2 ? b : a;
                }
                const o = (y * W + x) * 4;
                img.data[o] = c[0] * 255;
                img.data[o + 1] = c[1] * 255;
                img.data[o + 2] = c[2] * 255;
                img.data[o + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        this._texture?.destroy();
        this._texture = new pc.Texture(this.app.graphicsDevice, { width: W, height: H, mipmaps: true, name: "KickableBallTexture" });
        this._texture.setSource(canvas);
        this._material.diffuseMap = this._texture;
        this._material.update();
    }

    _rgb(hex) {
        const n = parseInt(String(hex).replace("#", ""), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    // dir: horizontal unit vector; speed in m/s; up: vertical share of the speed.
    _kick(dir, speed, up) {
        const v = dir.clone().mulScalar(speed * this.kickStrength * this._k);
        v.y = speed * up * this.kickStrength * this._k;
        this._takeOver();
        const rb = this._ball.rigidbody;
        rb.linearVelocity = v;
        rb.activate();
        this._idleSince = 0;
        this._publish(false);
    }

    // Become the one simulating the ball, starting from where it is drawn now.
    _takeOver() {
        const rb = this._ball.rigidbody;
        this._owning = true;
        this._target = null;
        if (rb.type !== pc.BODYTYPE_DYNAMIC) {
            rb.type = pc.BODYTYPE_DYNAMIC;
            this._setCcd();
        }
        rb.teleport(this._ball.getPosition(), this._ball.getRotation());
    }

    // Continuous collision: a hard kick moves the ball more than its radius per physics step.
    _setCcd() {
        const body = this._ball.rigidbody.body;
        body.setCcdMotionThreshold(this._radius);
        body.setCcdSweptSphereRadius(this._radius * 0.8);
    }

    _publish(rest) {
        const rb = this._ball.rigidbody;
        const p = this._ball.getPosition(), q = this._ball.getRotation();
        const v = rest ? pc.Vec3.ZERO : rb.linearVelocity, w = rest ? pc.Vec3.ZERO : rb.angularVelocity;
        const r3 = (n) => Math.round(n * 1000) / 1000;
        this._state = {
            p: [r3(p.x), r3(p.y), r3(p.z)],
            q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
            v: [r3(v.x), r3(v.y), r3(v.z)],
            w: [r3(w.x), r3(w.y), r3(w.z)],
            owner: ArrivalSpace.getUser()?.userID,
            sid: this._sid,
            rest,
        };
    }

    _respawn(publish = true) {
        this._home.copy(this.entity.getPosition());
        this._home.y += this._radius + 0.05 * this._k;
        this._takeOver();
        const rb = this._ball.rigidbody;
        rb.teleport(this._home, pc.Quat.IDENTITY);
        rb.linearVelocity = pc.Vec3.ZERO;
        rb.angularVelocity = pc.Vec3.ZERO;
        this._idleSince = 0;
        if (publish) this._publish(true);
    }

    // Synced state arrived (another player kicked, streamed, or this is the late-join state).
    _onState(state, old, isRemote) {
        if (!isRemote || !state || !state.p || state.sid === this._sid) return;
        const rb = this._ball.rigidbody;
        if (rb.type !== pc.BODYTYPE_KINEMATIC) rb.type = pc.BODYTYPE_KINEMATIC;
        this._owning = false;
        const target = {
            p: new pc.Vec3(...state.p),
            q: new pc.Quat(...state.q),
            v: new pc.Vec3(...state.v),
            at: performance.now(),
        };
        // First sight of the ball (late join): jump there instead of gliding in from home.
        if (!this._target && state.rest) {
            this._ball.setPosition(target.p);
            this._ball.setRotation(target.q);
        }
        this._target = target;
    }

    update(dt) {
        if (!this._ball) return;
        this._kickCooldown -= dt;

        // Placed after initialize, or moved in the editor: the ball goes with it. Only a ball
        // that has been played with tells the others; an untouched one is home everywhere.
        if (this.entity.getPosition().distance(this._placed) > 0.01) {
            this._placed.copy(this.entity.getPosition());
            if (this._owning) this._respawn(!!this._state);
            return;
        }

        if (this._owning) this._simulate(dt);
        else this._follow(dt);

        this._checkWalkKick();
    }

    _follow(dt) {
        const t = this._target;
        // A ball left lying by a player who has gone: simulate it here again (idle respawn).
        this._orphanCheck -= dt;
        if (this._state.rest && this._orphanCheck <= 0) {
            this._orphanCheck = 1;
            if (!ArrivalSpace.net.getPlayers().some((p) => p.userID == this._state.owner)) {
                this._takeOver();
                return;
            }
        }
        const ahead = Math.min((performance.now() - t.at) / 1000, 0.25);
        this._tmp.copy(t.v).mulScalar(ahead).add(t.p);
        const pos = this._ball.getPosition().clone();
        const f = 1 - Math.exp(-dt * 12);
        if (pos.distance(this._tmp) > 3 * this._k) pos.copy(this._tmp);
        else pos.lerp(pos, this._tmp, f);
        this._ball.setPosition(pos);
        const rot = new pc.Quat().slerp(this._ball.getRotation(), t.q, f);
        this._ball.setRotation(rot);
    }

    _simulate(dt) {
        const pos = this._ball.getPosition();
        const away = Math.hypot(pos.x - this._home.x, pos.z - this._home.z);
        if (pos.y < this._home.y - 50 * this._k || away > this.respawnDistance * this._k) {
            this._respawn(true);
            return;
        }

        const rb = this._ball.rigidbody;
        this._rollingResistance(rb, dt);
        // Only the player whose kick (or respawn) the shared state is streams it: a ball that
        // just settles after loading must not overwrite the game the others are playing.
        const streaming = this._state?.sid === this._sid;
        const moving = rb.linearVelocity.length() > 0.03 * this._k || rb.angularVelocity.length() > 0.1;
        if (moving) {
            this._idleSince = 0;
            this._sendAcc += dt;
            if (streaming && this._sendAcc >= 0.1) {
                this._sendAcc = 0;
                this._publish(false);
            }
            return;
        }
        if (streaming && !this._state.rest) this._publish(true);

        if (this.idleRespawnMinutes > 0 && away > 1 * this._k) {
            this._idleSince ||= performance.now();
            if (performance.now() - this._idleSince > this.idleRespawnMinutes * 60000) this._respawn(true);
        }
    }

    // Grass-like roll-out: a steady deceleration while the ball rolls (Bullet's rolling friction
    // does not slow a sphere, and damping alone leaves it creeping for many seconds).
    _rollingResistance(rb, dt) {
        const v = rb.linearVelocity;
        if (Math.abs(v.y) > 0.3 * this._k) return;
        const speed = Math.hypot(v.x, v.z);
        const slow = 2 * this._k * dt;
        if (speed <= slow) {
            if (speed > 0) {
                rb.linearVelocity = new pc.Vec3(0, v.y, 0);
                rb.angularVelocity = pc.Vec3.ZERO;
            }
            return;
        }
        const f = (speed - slow) / speed;
        rb.linearVelocity = new pc.Vec3(v.x * f, v.y, v.z * f);
    }

    // Running into the ball kicks it along the run.
    _checkWalkKick() {
        if (this._kickCooldown > 0) return;
        const player = ArrivalSpace.getPlayer();
        if (!player?.rigidbody) return;
        const pv = player.rigidbody.linearVelocity;
        const speed = Math.hypot(pv.x, pv.z);
        if (speed < 0.8 * this._k) return;
        const pp = player.getPosition(), bp = this._ball.getPosition();
        const to = new pc.Vec3(bp.x - pp.x, 0, bp.z - pp.z);
        const dist = to.length();
        if (dist > this._radius + 0.45 * this._k || Math.abs(bp.y - pp.y) > 1.2 * this._k) return;
        const run = new pc.Vec3(pv.x, 0, pv.z).normalize();
        to.normalize();
        if (run.dot(to) < 0.3) return;
        this._kickCooldown = 0.4;
        const dir = run.add(to).normalize();
        this._kick(dir, Math.min(speed / this._k * 1.6, 12), 0.2);
    }

    onPropertyChanged(name) {
        if (name === "pattern" || name === "color" || name === "patternColor") {
            this._paint();
        } else if (name === "size" || name === "bounciness") {
            this._build();
            this._respawn(this._owning);
        }
    }

    destroy() {
        this._offClick?.();
        this._ball?.destroy();
        this._texture?.destroy();
        this._material?.destroy();
    }
}

// Face centres of a truncated icosahedron: the 12 pentagons (icosahedron vertices) first, then
// the 20 hexagons (dodecahedron vertices). The nearest centre to a direction names its patch.
function footballCenters() {
    const g = (1 + Math.sqrt(5)) / 2;
    const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
    const pent = [];
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
        pent.push(norm([0, s1, s2 * g]), norm([s1, s2 * g, 0]), norm([s2 * g, 0, s1]));
    }
    const hex = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) hex.push(norm([x, y, z]));
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
        hex.push(norm([0, s1 / g, s2 * g]), norm([s1 / g, s2 * g, 0]), norm([s2 * g, 0, s1 / g]));
    }
    return [...pent, ...hex];
}
