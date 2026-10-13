/**
 * Voice NPC — a character you talk to with your voice. Click it and speak: it listens and
 * answers aloud in realtime (you can interrupt it), in character, in the visitor's language.
 * Click again or walk away to end the conversation.
 *
 * Features demonstrated:
 * - ArrivalSpace.ai.voiceChat: realtime speech in, speech out, with a persona and a greeting
 * - onStateChange: the head label shows whether it is listening or speaking, and the body
 *   gestures while it talks (npc.setActivity)
 * - npc.setLookTarget: it keeps looking at you, turning its body when you walk around it
 * - ending a conversation on click, on distance, and on unload
 *
 * Requires ArrivalSpace.VERSION >= 1.25.0. The browser asks for the microphone on first use.
 * The voice is AI-generated - the greeting says so.
 */
export class VoiceNpc extends ArrivalScript {
    static scriptName = "Voice NPC";

    npcName = "Marco";
    persona = "You are Marco, who has run the noodle stand in this market for thirty years. You are warm and a little proud of your broth. Answer in one or two short sentences, in the visitor's language.";
    greeting = "Hi, I'm Marco - an AI voice. Hungry?";
    voice = "cedar";
    talkDistance = 6;
    avatarConfig = {
        parts: {
            body: "57321F-2.glb",
            head: "face-default.glb",
            hair: "male-hair-63.glb",
            teeth: "face-default.glb",
            eyeLeft: "eyes-1.glb",
            eyeRight: "eyes-1.glb",
            top: "male-shirt-11.glb",
            bottom: "male-pants-1.glb",
            footwear: "male-shoes-18.glb",
        },
        tints: { skinColor: "#D48770", hairColor: "#4E433F" },
        gender: "male",
        type: "modular",
    };

    static properties = {
        npcName: { title: "Name" },
        persona: { title: "Persona (who it is, how it talks)" },
        greeting: { title: "Greeting" },
        voice: {
            title: "Voice",
            options: ["cedar", "marin", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"].map((v) => ({ label: v, value: v })),
        },
        talkDistance: { title: "Ends when you walk away (m)", min: 2, max: 20 },
        avatarConfig: { title: "Avatar", editor: "avatar-config" },
    };

    _chat = null;

    async initialize() {
        if (ArrivalSpace.VERSION.localeCompare("1.25.0", undefined, { numeric: true }) < 0) {
            this.warn("Voice NPC needs ArrivalSpace.VERSION >= 1.25.0");
            return;
        }
        this._npc = await this.createNPC({
            name: `VoiceNpc_${this.entity._vibeEntityId || "npc"}`,
            position: this.entity.getPosition().clone(),
            avatarConfig: this.avatarConfig,
            headLabel: `${this.npcName} (click to talk)`,
            onClick: () => (this._chat ? this._chat.stop() : this._talk()),
        });
    }

    _talk() {
        const label = { connecting: "connecting...", listening: "listening", speaking: "speaking" };
        const chat = ArrivalSpace.ai.voiceChat({
            instructions: this.persona,
            voice: this.voice,
            greeting: this.greeting,
            entity: this._npc.entity,
            onStateChange: (state) => {
                if (state === "ended") return;
                this._npc.setHeadLabel(`${this.npcName} (${label[state]})`);
                this._npc.setActivity(state === "speaking" ? "talking" : "listening");
            },
        });
        this._chat = chat;
        this._npc.setLookTarget(ArrivalSpace.getPlayer());
        chat.done.then(() => {
            if (this._chat !== chat) return;
            this._chat = null;
            this._npc?.setActivity(null);
            this._npc?.setLookTarget(null);
            if (chat.error) this.warn(`voice chat ended: ${chat.error}`);
            this._npc?.setHeadLabel(`${this.npcName} (click to talk)`);
        });
    }

    update() {
        if (!this._chat || !this._npc) return;
        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        if (player.getPosition().distance(this._npc.entity.getPosition()) > this.talkDistance) this._chat.stop();
    }

    destroy() {
        this._chat?.stop();
        this._npc?.destroy();
    }
}
