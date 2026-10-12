/**
 * Speaking Sign — a glowing orb that speaks its text when a visitor comes close, and pulses
 * with its own voice.
 *
 * Features demonstrated:
 * - ArrivalSpace.speak: streamed AI speech from an entity (positional, follows it)
 * - speech.level: the voice's loudness, here driving the glow (could open an NPC's mouth)
 * - speech.done / speech.stop(): one line at a time, stopped when the vibe unloads
 * - a proximity trigger that fires once per approach
 *
 * Requires ArrivalSpace.VERSION >= 1.23.0. The voice is AI-generated - say so in the text or
 * nearby when visitors could mistake it for a person.
 */
export class SpeakingSign extends ArrivalScript {
    static scriptName = "Speaking Sign";

    text = "Welcome! This voice is AI-generated. Walk on to see the rest of the space.";
    voice = "marin";
    instructions = "Friendly, clear, unhurried.";
    triggerDistance = 3;
    color = "#66ccff";

    static properties = {
        text: { title: "Text" },
        voice: {
            title: "Voice",
            options: ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
                .map((v) => ({ label: v, value: v })),
        },
        instructions: { title: "How to speak (tone, accent, pace)" },
        triggerDistance: { title: "Trigger Distance (m)", min: 1, max: 15 },
        color: { title: "Glow Color" },
    };

    _speech = null;
    _inside = false;

    initialize() {
        if (!ArrivalSpace.speak) {
            this.warn("Speaking Sign needs ArrivalSpace.VERSION >= 1.23.0");
            return;
        }
        this._material = new pc.StandardMaterial();
        this._material.diffuse = new pc.Color(0.05, 0.05, 0.05);
        this._applyColor();
        this._orb = new pc.Entity("SpeakingSignOrb");
        this._orb.addComponent("render", { type: "sphere", material: this._material, castShadows: false });
        this._orb.setLocalScale(0.4, 0.4, 0.4);
        this._orb.setLocalPosition(0, 1.5, 0);
        this.entity.addChild(this._orb);
    }

    onPropertyChanged(name) {
        if (name === "color" && this._material) this._applyColor();
    }

    _applyColor() {
        this._baseColor = new pc.Color().fromString(this.color);
        this._material.emissive = this._baseColor;
        this._material.update();
    }

    update() {
        if (!this._orb) return;
        const player = ArrivalSpace.getPlayer();
        const near = !!player && player.getPosition().distance(this._orb.getPosition()) < this.triggerDistance;
        if (near && !this._inside && !this._speech?.playing) this._say();
        this._inside = near;

        // glow with the voice: 0.3 at rest, up to 3 at full volume
        const level = this._speech?.playing ? this._speech.level : 0;
        this._material.emissiveIntensity = 0.3 + 2.7 * level;
        this._material.update();
    }

    async _say() {
        const speech = ArrivalSpace.speak(this.text, { entity: this._orb, voice: this.voice, instructions: this.instructions });
        this._speech = speech;
        if (!(await speech.done) && speech.error) this.warn(`speech failed: ${speech.error}`);
    }

    destroy() {
        this._speech?.stop();
    }
}
