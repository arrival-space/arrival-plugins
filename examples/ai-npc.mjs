/**
 * AI NPC
 *
 * An LLM-driven character built on the general ArrivalSpace.ai.complete API.
 * Visitors click the NPC to open a chat panel and ask questions; the plugin
 * sends its persona (`prePrompt`) as the system prompt plus the running chat.
 * Runs on the free GLM model by default — no setup needed. The space owner can
 * select OpenAI/Anthropic instead; their API key is a profile/account setting
 * (Settings → Profile → AI Keys, stored server-side, never visible to
 * visitors) and is spent only through this placed entity, bounded by daily
 * caps. Choosing a non-free provider without a stored key navigates the owner
 * there automatically.
 *
 * This is just one thing you can build on ai.complete — the same API drives
 * text tools, classifiers, or any other AI feature (see ai-text-tool.mjs).
 */
export class AiNpc extends ArrivalScript {
    static scriptName = 'AI NPC';

    prePrompt = 'You are a friendly guide for this space. Answer visitor questions briefly and helpfully.';
    npcName = 'Guide';
    greeting = 'Hi! Ask me anything about this space.';
    provider = 'glm';
    model = '';
    avatarConfig = {
        parts: {
            body: '57321F-2.glb',
            head: 'face-default.glb',
            hair: 'male-hair-63.glb',
            teeth: 'face-default.glb',
            eyeLeft: 'eyes-1.glb',
            eyeRight: 'eyes-1.glb',
            top: 'male-shirt-11.glb',
            bottom: 'male-pants-1.glb',
            footwear: 'male-shoes-18.glb',
        },
        tints: {
            skinColor: '#D48770',
            hairColor: '#4E433F',
        },
        gender: 'male',
        type: 'modular',
    };

    static properties = {
        prePrompt: { title: 'Persona / Pre-Prompt' },
        npcName: { title: 'NPC Name' },
        greeting: { title: 'Greeting' },
        provider: {
            title: 'AI Provider',
            options: [
                { label: 'GLM (free)', value: 'glm' },
                { label: 'OpenAI (own key)', value: 'openai' },
                { label: 'Anthropic (own key)', value: 'anthropic' },
            ],
        },
        model: { title: 'Model Override (optional)' },
        avatarConfig: { title: 'Avatar', editor: 'avatar-config' },
    };

    async initialize() {
        this._history = [];
        this._busy = false;
        this._panel = null;

        this._npc = await this.createNPC({
            name: `AiNpc_${this.entity._vibeEntityId || 'npc'}`,
            position: this.entity.getPosition().clone(),
            avatarConfig: this.avatarConfig,
            headLabel: this.npcName,
            onClick: () => this._togglePanel(),
        });
    }

    _togglePanel() {
        if (this._panel) {
            this._closePanel();
        } else {
            this._openPanel();
        }
    }

    _closePanel() {
        this.removeUI();
        this._panel = null;
    }

    _openPanel() {
        this._panel = this.createUI('div', {
            id: 'aiNpc-panel',
            style: {
                position: 'fixed',
                bottom: '8px',
                right: '16px',
                width: '340px',
                height: '440px',
                background: '#80808066',
                backdropFilter: 'blur(50px)',
                WebkitBackdropFilter: 'blur(50px)',
                borderRadius: '20px',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, system-ui, sans-serif',
                zIndex: '1001',
                boxShadow: '0 0 20px 5px rgba(0, 0, 0, 0.15)',
                overflow: 'hidden',
            },
        });

        this._panel.innerHTML = `
            <div style="padding: 0 15px; height: 40px; background: #00000026; display: flex; align-items: center; justify-content: space-between;">
                <span id="aiNpc-title" style="color: white; font-weight: 600; font-size: 14px;"></span>
                <button id="aiNpc-close" style="background: none; border: none; color: white; cursor: pointer; font-size: 18px; opacity: 0.7; padding: 0 4px;">×</button>
            </div>
            <div id="aiNpc-messages" style="flex: 1; overflow-y: auto; padding: 10px; color: white; font-size: 13px;"></div>
            <div style="padding: 10px; display: flex; gap: 8px;">
                <input type="text" id="aiNpc-input" placeholder="Ask a question..."
                    style="flex: 1; padding: 10px 12px; border-radius: 16px; border: none; background: #00000026; color: white; font-size: 13px; outline: none;"
                    maxlength="1000">
                <button id="aiNpc-send" style="padding: 10px 16px; border-radius: 16px; border: none; background: #38b4b0; color: #fff; cursor: pointer; font-weight: 600;">Ask</button>
            </div>
        `;

        this._panel.querySelector('#aiNpc-title').textContent = this.npcName;
        this._messagesEl = this._panel.querySelector('#aiNpc-messages');
        this._inputEl = this._panel.querySelector('#aiNpc-input');
        this._panel.querySelector('#aiNpc-close').onclick = () => this._closePanel();
        this._panel.querySelector('#aiNpc-send').onclick = () => this._sendQuestion();
        this._inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._sendQuestion();
        });

        // replay history so reopening keeps the conversation
        if (this._history.length === 0 && this.greeting) {
            this._renderMessage(this.greeting, false);
        } else {
            for (const m of this._history) this._renderMessage(m.content, m.role === 'user');
        }

        this._inputEl.focus();
    }

    async _sendQuestion() {
        const question = this._inputEl.value.trim();
        if (!question || this._busy) return;
        this._inputEl.value = '';
        this._busy = true;

        this._renderMessage(question, true);
        const pendingEl = this._renderMessage('…', false);

        const res = await ArrivalSpace.ai.complete({
            entityId: this.entity._vibeEntityId,
            system: this.prePrompt,
            provider: this.provider,
            messages: [...this._history.slice(-10), { role: 'user', content: question }],
        });

        this._busy = false;
        if (!res || res.error || !res.answer) {
            pendingEl.textContent = res?.error || 'No connection — please try again.';
            pendingEl.style.opacity = '0.7';
            // a paid provider without a stored key: point the owner at the settings
            if (res?.error && this.provider !== 'glm' && ArrivalSpace.isOwner()) {
                this._renderSettingsHint();
            }
            return;
        }

        pendingEl.textContent = res.answer;
        this._history.push({ role: 'user', content: question });
        this._history.push({ role: 'assistant', content: res.answer });
        while (this._history.length > 10) this._history.shift();
    }

    _renderMessage(text, isVisitor) {
        const msgEl = document.createElement('div');
        msgEl.style.cssText = `
            margin-bottom: 8px;
            padding: 8px 12px;
            border-radius: 10px;
            background: ${isVisitor ? '#38b4b0' : '#00000026'};
            word-wrap: break-word;
            white-space: pre-wrap;
        `;
        msgEl.textContent = text;
        this._messagesEl.appendChild(msgEl);
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
        return msgEl;
    }

    // Owner-only line in the panel linking to Settings → Profile → AI Keys.
    _renderSettingsHint() {
        const hintEl = this._renderMessage('Open settings to add your API key →', false);
        hintEl.style.cursor = 'pointer';
        hintEl.style.textDecoration = 'underline';
        hintEl.onclick = () => ArrivalSpace.ai.openKeySettings();
    }

    // The owner picked a paid provider in the property editor: if they have no
    // key stored for it yet, take them to the account settings to add one.
    async _checkProviderKey() {
        if (this.provider === 'glm' || !ArrivalSpace.isOwner()) return;
        const status = await ArrivalSpace.ai.keyStatus();
        if (status && !status[this.provider]) {
            ArrivalSpace.ai.openKeySettings();
        }
    }

    onPropertyChanged(name) {
        if (!this._npc) return;
        if (name === 'npcName') {
            this._npc.setHeadLabel(this.npcName);
            if (this._panel) this._panel.querySelector('#aiNpc-title').textContent = this.npcName;
        }
        if (name === 'provider') {
            this._checkProviderKey();
        }
    }

    destroy() {
        if (this._npc) {
            this._npc.destroy();
            this._npc = null;
        }
        this.removeUI();
    }
}
