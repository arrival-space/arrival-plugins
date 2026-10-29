/**
 * AI Guide — a host for your space that visitors can talk to.
 *
 * Click the guide to open a chat: type a question, or press the microphone to talk to it out
 * loud. It already knows the space's title and description; anything else it should know
 * (opening hours, prices, links, the story behind a piece) goes into "What it knows".
 * It answers in the visitor's language and turns to look at whoever walks up.
 *
 * Features demonstrated:
 * - ArrivalSpace.ai.complete: typed chat on the free platform model (GPT-6 Luna) by default;
 *   the owner can switch to their own OpenAI/Anthropic/GLM key (Settings → Profile → AI Keys)
 * - ArrivalSpace.ai.voiceChat: the same conversation by voice, typed text still works during it
 *   (chat.sendText); voice is a Business feature paid by the space's owner
 * - ArrivalSpace.getRoom(): the space's own title and description in the system prompt
 * - npc.setLookTarget / npc.setActivity: the guide looks at you and gestures while it talks
 *
 * Requires ArrivalSpace.VERSION >= 1.26.0. The voice is AI-generated - the greeting says so.
 */
export class AiGuide extends ArrivalScript {
    static scriptName = "AI Guide";

    npcName = "Alex";
    persona = "You are Alex, the friendly host of this space. You welcome visitors, answer their questions and suggest what to look at. Keep answers short: one to three sentences.";
    greeting = "Hi, I'm Alex, an AI guide. Ask me anything about this place!";
    knowledge = "";
    voice = "marin";
    provider = "luna";
    lookDistance = 6;
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
        knowledge: { title: "What it knows (facts, opening hours, links)" },
        voice: {
            title: "Voice (microphone conversations)",
            options: ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"].map((v) => ({ label: v, value: v })),
        },
        provider: {
            title: "AI provider (typed chat)",
            options: [
                { label: "GPT-6 Luna (free)", value: "luna" },
                { label: "OpenAI (own key)", value: "openai" },
                { label: "Anthropic (own key)", value: "anthropic" },
                { label: "GLM (own key)", value: "glm" },
            ],
        },
        lookDistance: { title: "Looks at visitors within (m)", min: 2, max: 20 },
        avatarConfig: { title: "Avatar", editor: "avatar-config" },
    };

    _history = [];
    _busy = false;
    _panel = null;
    _voice = null;
    _looking = false;

    async initialize() {
        this._npc = await this.createNPC({
            name: `AiGuide_${this.entity._vibeEntityId || "npc"}`,
            position: this.entity.getPosition().clone(),
            avatarConfig: this.avatarConfig,
            headLabel: this.npcName,
            onClick: () => (this._panel ? this._closePanel() : this._openPanel()),
        });
    }

    // The persona plus what the space says about itself and what the owner added.
    _instructions() {
        const room = ArrivalSpace.getRoom();
        const title = room.roomData?.roomTitle || room.roomName || "";
        const description = room.roomData?.roomDescription || "";
        return [
            this.persona,
            `You are standing in a 3D space on arrival.space called "${title}".`,
            description && `The space describes itself like this:\n${description}`,
            this.knowledge && `What you know about it:\n${this.knowledge}`,
            "Answer in the language the visitor writes or speaks in. If you don't know something, say so instead of making it up.",
        ].filter(Boolean).join("\n\n");
    }

    _openPanel() {
        // On a phone the panel spans the top of the screen, clear of the on-screen keyboard
        // and of the client's 48px button column on the right edge (Main menu would take the × tap).
        const phone = window.innerWidth < 500;
        this._panel = this.createUI("div", {
            style: {
                position: "fixed",
                ...(phone
                    ? { top: "12px", left: "12px", right: "64px", height: "min(440px, 45dvh)" }
                    : { bottom: "60px", right: "56px", width: "340px", height: "min(440px, calc(100dvh - 80px))" }),
                background: "#80808066", backdropFilter: "blur(50px)", WebkitBackdropFilter: "blur(50px)",
                borderRadius: "20px", display: "flex", flexDirection: "column", overflow: "hidden",
                fontFamily: "Inter, system-ui, sans-serif", zIndex: "1001", boxShadow: "0 0 20px 5px rgba(0, 0, 0, 0.15)",
            },
        });
        this._panel.innerHTML = `
            <div style="padding: 0 15px; height: 40px; background: #00000026; display: flex; align-items: center; justify-content: space-between;">
                <span data-title style="color: white; font-weight: 600; font-size: 14px;"></span>
                <button data-close style="background: none; border: none; color: white; cursor: pointer; font-size: 18px; opacity: 0.7;">×</button>
            </div>
            <div data-messages style="flex: 1; overflow-y: auto; padding: 10px; color: white; font-size: 13px;"></div>
            <div style="padding: 10px; display: flex; gap: 8px;">
                <input data-input type="text" placeholder="Ask a question..." maxlength="1000"
                    style="flex: 1; min-width: 0; padding: 10px 12px; border-radius: 16px; border: none; background: #00000026; color: white; font-size: ${this.isMobile ? 16 : 13}px; outline: none;">
                <button data-mic title="Talk out loud" style="width: 38px; border-radius: 16px; border: none; background: #00000026; color: #fff; cursor: pointer; font-size: 16px;">🎤</button>
                <button data-send style="padding: 10px 14px; border-radius: 16px; border: none; background: #38b4b0; color: #fff; cursor: pointer; font-weight: 600;">Ask</button>
            </div>`;
        const $ = (name) => this._panel.querySelector(`[data-${name}]`);
        $("title").textContent = this.npcName;
        this._messagesEl = $("messages");
        this._inputEl = $("input");
        this._micEl = $("mic");
        $("close").onclick = () => this._closePanel();
        $("send").onclick = () => this._send();
        this._micEl.onclick = () => (this._voice ? this._voice.stop() : this._startVoice());
        this._inputEl.addEventListener("keydown", (e) => {
            e.stopPropagation(); // typing must not walk the player
            if (e.key === "Enter") this._send();
        });

        if (this._history.length === 0) this._render(this.greeting, false);
        for (const m of this._history) this._render(m.content, m.role === "user");
        this._updateMic();
        if (!this.isMobile) this._inputEl.focus(); // a touch keyboard would cover the space right away
    }

    _closePanel() {
        this._voice?.stop();
        this.removeUI();
        this._panel = null;
    }

    _remember(role, content) {
        this._history.push({ role, content });
        while (this._history.length > 12) this._history.shift();
    }

    async _send() {
        const text = this._inputEl.value.trim();
        if (!text || this._busy) return;
        this._inputEl.value = "";
        if (this._voice) {
            this._voice.sendText(text); // answered aloud; onUserText/onReply put it in the chat
            return;
        }
        this._busy = true;
        this._render(text, true);
        const pending = this._render("…", false);
        this._npc.setActivity("thinking");
        const res = await this.aiComplete({
            system: this._instructions(),
            provider: this.provider,
            messages: [...this._history, { role: "user", content: text }],
        });
        this._busy = false;
        this._npc?.setActivity(null);
        if (!res?.answer) {
            pending.textContent = res?.error || "No connection — please try again.";
            pending.style.opacity = "0.7";
            if (res?.error && this.provider !== "luna" && ArrivalSpace.isOwner()) {
                const hint = this._render("Open settings to add your API key →", false);
                hint.style.cursor = "pointer";
                hint.style.textDecoration = "underline";
                hint.onclick = () => ArrivalSpace.ai.openKeySettings();
            }
            return;
        }
        pending.textContent = res.answer;
        this._remember("user", text);
        this._remember("assistant", res.answer);
    }

    _startVoice() {
        const recent = this._history.map((m) => `${m.role === "user" ? "Visitor" : "You"}: ${m.content}`).join("\n");
        const voice = ArrivalSpace.ai.voiceChat({
            instructions: this._instructions() + (recent ? `\n\nThe conversation so far (typed):\n${recent}` : ""),
            voice: this.voice,
            greeting: this._history.length ? undefined : this.greeting,
            entity: this._npc.entity,
            // the greeting is already on screen; an empty transcript is noise the mic picked up
            onUserText: (text) => text.trim() && (this._render(text, true), this._remember("user", text)),
            onReply: (text) => text !== this.greeting && (this._render(text, false), this._remember("assistant", text)),
            onStateChange: (state) => {
                if (state === "ended") return;
                this._npc.setHeadLabel(`${this.npcName} (${state})`);
                this._npc.setActivity(state === "speaking" ? "talking" : "listening");
            },
        });
        this._voice = voice;
        this._updateMic();
        voice.done.then(() => {
            if (this._voice !== voice) return;
            this._voice = null;
            this._npc?.setActivity(null);
            this._npc?.setHeadLabel(this.npcName);
            if (voice.error && this._panel) this._render(voice.error, false).style.opacity = "0.7";
            this._updateMic();
        });
    }

    _updateMic() {
        if (!this._panel) return;
        this._micEl.style.background = this._voice ? "#e5484d" : "#00000026";
        this._micEl.title = this._voice ? "End the voice conversation" : "Talk out loud";
        this._inputEl.placeholder = this._voice ? "Speak, or type..." : "Ask a question...";
    }

    _render(text, isVisitor) {
        const el = document.createElement("div");
        el.style.cssText = `margin-bottom: 8px; padding: 8px 12px; border-radius: 10px; word-wrap: break-word; white-space: pre-wrap;
            background: ${isVisitor ? "#38b4b0" : "#00000026"}; ${isVisitor ? "margin-left: 30px;" : "margin-right: 30px;"}`;
        el.textContent = text;
        this._messagesEl.appendChild(el);
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
        return el;
    }

    // Looks at the visitor while they are near; walking away ends the conversation.
    update() {
        const player = ArrivalSpace.getPlayer();
        if (!this._npc || !player) return;
        const near = player.getPosition().distance(this._npc.entity.getPosition()) < this.lookDistance;
        if (near !== this._looking) {
            this._looking = near;
            this._npc.setLookTarget(near ? player : null);
        }
        if (!near && this._panel && player.getPosition().distance(this._npc.entity.getPosition()) > this.lookDistance * 2) this._closePanel();
    }

    async onPropertyChanged(name) {
        if (!this._npc) return;
        if (name === "npcName") {
            this._npc.setHeadLabel(this.npcName);
            if (this._panel) this._panel.querySelector("[data-title]").textContent = this.npcName;
        }
        if (name === "avatarConfig") await this._npc.applyAvatarConfig(this.avatarConfig);
        if (name === "provider" && this.provider !== "luna" && ArrivalSpace.isOwner()) {
            const status = await ArrivalSpace.ai.keyStatus();
            if (status && !status[this.provider]) ArrivalSpace.ai.openKeySettings();
        }
    }

    // The NPC is its own entity: follow the placed entity when it is moved in the editor.
    onEntityMoved(position) {
        const npcEntity = this._npc?.entity;
        if (!npcEntity) return;
        const pos = new pc.Vec3(position.x, position.y, position.z);
        if (npcEntity.rigidbody?.enabled) npcEntity.rigidbody.teleport(pos);
        else npcEntity.setPosition(pos);
    }

    destroy() {
        this._voice?.stop();
        this._npc?.destroy();
        this.removeUI();
    }
}
