/**
 * Piano — a playable keyboard, and the reference for pointer interaction.
 *
 * Every key is a plain box with no collider. It is clickable and hoverable anyway,
 * because the platform picks by rendering entity ids, not by raycasting physics.
 *
 * Features demonstrated:
 * - `this.setOutline(entity, on)` — the editor's silhouette highlight, driven by the
 *   vibe rather than by the pointer
 * - `event.stopPropagation()` — makes a mesh SOLID to the pointer, so a key is not
 *   played "through" by something behind it and clicking it does not walk the player
 * - `ArrivalSpace.onEntityClick` / `onEntityHover` on procedural geometry
 * - Sub-entities parented to `this.entity`, so the gizmo moves the whole instrument
 * - WebAudio note synthesis, so the vibe ships with no audio assets
 */
export class Piano extends ArrivalScript {
    static scriptName = "Piano";

    octaves = 2;
    baseOctave = 4;
    keyWidth = 0.023;
    keyLength = 0.145;
    volume = 0.35;
    pressDepth = 0.008;
    whiteColor = "#f7f5f0";
    blackColor = "#141418";
    bodyColor = "#5a3825";
    showBody = true;

    static properties = {
        octaves: { title: "Octaves", min: 1, max: 4, step: 1 },
        baseOctave: { title: "Lowest Octave", min: 1, max: 6, step: 1 },
        keyWidth: { title: "White Key Width (m)", min: 0.012, max: 0.08 },
        keyLength: { title: "White Key Length (m)", min: 0.05, max: 0.4 },
        volume: { title: "Volume", min: 0, max: 1 },
        pressDepth: { title: "Key Travel (m)", min: 0, max: 0.05 },
        whiteColor: { title: "White Keys" },
        blackColor: { title: "Black Keys" },
        bodyColor: { title: "Body" },
        showBody: { title: "Show Body" },
    };

    /// Semitone offsets within an octave. Blacks sit after these white indices.
    static WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
    static BLACK_AFTER_WHITE = [0, 1, 3, 4, 5];
    static NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    _keys = [];
    _offs = [];
    _audio = null;
    _master = null;

    initialize() {
        this._build();
    }

    /* ── Geometry ─────────────────────────────────────────────────────────── */

    _build() {
        this._teardownKeys();

        const whiteW = this.keyWidth;
        const whiteL = this.keyLength;
        const whiteH = 0.02;
        const blackW = whiteW * 0.58;
        const blackL = whiteL * 0.62;
        const blackH = whiteH * 1.6;
        const gap = whiteW * 0.02;

        const whitesPerOctave = Piano.WHITE_SEMITONES.length;
        const totalWhites = whitesPerOctave * this.octaves;
        /// Centre the keyboard on the entity so it rotates about itself.
        const originX = -((totalWhites * whiteW) / 2) + whiteW / 2;

        const whiteMat = this._material(this.whiteColor, 0.35);
        const blackMat = this._material(this.blackColor, 0.25);

        for (let o = 0; o < this.octaves; o++) {
            const octave = this.baseOctave + o;

            for (let i = 0; i < whitesPerOctave; i++) {
                const x = originX + (o * whitesPerOctave + i) * whiteW;
                this._addKey({
                    name: `White_${Piano.NOTE_NAMES[Piano.WHITE_SEMITONES[i]]}${octave}`,
                    semitone: Piano.WHITE_SEMITONES[i],
                    octave,
                    material: whiteMat,
                    size: [whiteW - gap, whiteH, whiteL],
                    pos: [x, whiteH / 2, 0],
                });
            }

            for (const i of Piano.BLACK_AFTER_WHITE) {
                /// A black key straddles the seam between two whites.
                const x = originX + (o * whitesPerOctave + i) * whiteW + whiteW / 2;
                this._addKey({
                    name: `Black_${Piano.NOTE_NAMES[Piano.WHITE_SEMITONES[i] + 1]}${octave}`,
                    semitone: Piano.WHITE_SEMITONES[i] + 1,
                    octave,
                    material: blackMat,
                    size: [blackW, blackH, blackL],
                    /// Sits on top of the whites, pushed towards the back of the board.
                    pos: [x, whiteH + blackH / 2 - whiteH * 0.35, -(whiteL - blackL) / 2],
                });
            }
        }

        if (this.showBody) {
            const body = new pc.Entity("PianoBody");
            this.entity.addChild(body);
            body.addComponent("render", { type: "box" });
            body.render.material = this._material(this.bodyColor, 0.5);
            body.setLocalScale(totalWhites * whiteW + whiteW * 0.6, whiteH, whiteL * 1.18);
            body.setLocalPosition(0, -whiteH / 2, -whiteL * 0.07);
            this._body = body;
        }
    }

    _material(hex, gloss) {
        const mat = new pc.StandardMaterial();
        const c = new pc.Color();
        c.fromString(hex);
        mat.diffuse = c;
        mat.gloss = gloss;
        mat.useMetalness = true;
        mat.metalness = 0.05;
        mat.update();
        return mat;
    }

    _addKey({ name, semitone, octave, material, size, pos }) {
        const key = new pc.Entity(name);
        /// Parented to this.entity: the gizmo moves the whole piano, and the keys are
        /// destroyed with the vibe instead of leaking onto the scene root.
        this.entity.addChild(key);
        key.addComponent("render", { type: "box" });
        key.render.material = material;
        key.setLocalScale(size[0], size[1], size[2]);
        key.setLocalPosition(pos[0], pos[1], pos[2]);

        const record = { entity: key, restY: pos[1], midi: 12 * (octave + 1) + semitone, held: 0 };
        this._keys.push(record);

        this._offs.push(
            ArrivalSpace.onEntityHover(key, {
                /// stopPropagation() claims the hover: nothing behind the key highlights
                /// through it, and no pointer cursor from another object bleeds in.
                enter: (event) => {
                    event.stopPropagation();
                    this.setOutline(key);
                },
                leave: () => this.setOutline(key, false),
            }),
        );

        this._offs.push(
            ArrivalSpace.onEntityClick(key, (event) => {
                /// Without this the click ALSO reaches whatever sits behind the key, and
                /// the player walks to where you clicked.
                event.stopPropagation();
                this._strike(record);
            }),
        );

        return record;
    }

    /* ── Sound ────────────────────────────────────────────────────────────── */

    /// Created on the first click: browsers only allow audio to start from a gesture.
    _context() {
        if (this._audio) return this._audio;

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            this.warn("Piano: no WebAudio in this browser, keys will be silent");
            return null;
        }

        this._audio = new Ctx();
        this._master = this._audio.createGain();
        this._master.gain.value = this.volume;
        this._master.connect(this._audio.destination);
        return this._audio;
    }

    _strike(key) {
        key.held = 1;

        const ctx = this._context();
        if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume();

        const freq = 440 * Math.pow(2, (key.midi - 69) / 12);
        const now = ctx.currentTime;
        const dur = 1.6;

        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, now);
        env.gain.exponentialRampToValueAtTime(1, now + 0.006);      // hammer strike
        env.gain.exponentialRampToValueAtTime(0.0001, now + dur);   // string decay
        env.connect(this._master);

        /// Fundamental plus a quieter octave — enough overtone to read as a piano
        /// rather than a test tone, without loading a sample.
        for (const [type, mult, gain] of [["triangle", 1, 0.6], ["sine", 2, 0.18]]) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = freq * mult;
            const g = ctx.createGain();
            g.gain.value = gain;
            osc.connect(g);
            g.connect(env);
            osc.start(now);
            osc.stop(now + dur);
        }
    }

    /* ── Animation ────────────────────────────────────────────────────────── */

    update(dt) {
        for (const key of this._keys) {
            if (key.held <= 0) continue;
            key.held = Math.max(0, key.held - dt * 4);
            const p = key.entity.getLocalPosition();
            key.entity.setLocalPosition(p.x, key.restY - this.pressDepth * key.held, p.z);
        }
    }

    /* ── Editor + teardown ────────────────────────────────────────────────── */

    onPropertyChanged(name) {
        if (name === "volume") {
            if (this._master) this._master.gain.value = this.volume;
            return;
        }
        /// Anything else changes the geometry, so rebuild the keyboard.
        this._build();
    }

    _teardownKeys() {
        this._offs.forEach((off) => off());
        this._offs = [];
        /// Outlines are cleared on destroy anyway, but a rebuild throws away the
        /// entities they point at, so drop them here too.
        this.clearOutlines();
        for (const key of this._keys) key.entity.destroy();
        this._keys = [];
        if (this._body) {
            this._body.destroy();
            this._body = null;
        }
    }

    destroy() {
        this._teardownKeys();
        if (this._audio) {
            this._audio.close();
            this._audio = null;
            this._master = null;
        }
    }
}
