/**
 * AI NPC
 *
 * An LLM-driven character. Visitors click the NPC to open a chat panel and ask
 * questions; answers come from ArrivalSpace.ai.ask (backend /ai/ask). Runs on
 * the free GLM model by default — no setup needed. The space owner can select
 * OpenAI/Anthropic instead and store their own API key via the owner-only
 * section in the panel — the key is kept server-side and is never visible to
 * visitors.
 *
 * The persona lives in the `prePrompt` parameter. The server reads it from
 * this entity directly, so visitors cannot override it.
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
            <div id="aiNpc-owner" style="display: none; padding: 8px 10px; background: #00000033; font-size: 11px; color: #ddd;"></div>
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

        this._setupOwnerSection();
        this._inputEl.focus();
    }

    async _sendQuestion() {
        const question = this._inputEl.value.trim();
        if (!question || this._busy) return;
        this._inputEl.value = '';
        this._busy = true;

        this._renderMessage(question, true);
        const pendingEl = this._renderMessage('…', false);

        const res = await ArrivalSpace.ai.ask({
            entityId: this.entity._vibeEntityId,
            question,
            history: this._history.slice(-10),
        });

        this._busy = false;
        if (!res || res.error || !res.answer) {
            pendingEl.textContent = res?.error || 'No connection — please try again.';
            pendingEl.style.opacity = '0.7';
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

    async _setupOwnerSection() {
        const me = ArrivalSpace.getUser();
        const room = ArrivalSpace.getRoom();
        if (!me?.userID || me.userID !== room?.owner) return;

        const ownerEl = this._panel.querySelector('#aiNpc-owner');
        ownerEl.style.display = 'block';
        ownerEl.innerHTML = `
            <div style="margin-bottom: 6px;">Owner: API key for
                <select id="aiNpc-keyProvider" style="background: #00000044; color: white; border: none; border-radius: 6px; padding: 2px 4px;">
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="glm">GLM</option>
                </select>
                <span id="aiNpc-keyState" style="opacity: 0.8;"></span>
            </div>
            <div style="display: flex; gap: 6px;">
                <input type="password" id="aiNpc-keyInput" placeholder="paste key, stored server-side"
                    style="flex: 1; padding: 5px 8px; border-radius: 8px; border: none; background: #00000044; color: white; font-size: 11px; outline: none;">
                <button id="aiNpc-keySave" style="padding: 5px 10px; border-radius: 8px; border: none; background: #38b4b0; color: #fff; cursor: pointer;">Save</button>
                <button id="aiNpc-keyClear" style="padding: 5px 10px; border-radius: 8px; border: none; background: #00000044; color: #fff; cursor: pointer;">Clear</button>
            </div>
        `;

        const providerSel = ownerEl.querySelector('#aiNpc-keyProvider');
        const keyInput = ownerEl.querySelector('#aiNpc-keyInput');
        const stateEl = ownerEl.querySelector('#aiNpc-keyState');

        const refreshState = async () => {
            const status = await ArrivalSpace.ai.keyStatus();
            if (!status) { stateEl.textContent = ''; return; }
            stateEl.textContent = status[providerSel.value] ? '✓ key stored' : 'no key';
        };
        providerSel.onchange = refreshState;

        ownerEl.querySelector('#aiNpc-keySave').onclick = async () => {
            const key = keyInput.value.trim();
            if (!key) return;
            const ok = await ArrivalSpace.ai.setKey(providerSel.value, key);
            if (ok) keyInput.value = '';
            stateEl.textContent = ok ? '✓ key stored' : 'save failed';
        };
        ownerEl.querySelector('#aiNpc-keyClear').onclick = async () => {
            await ArrivalSpace.ai.clearKey(providerSel.value);
            refreshState();
        };

        refreshState();
    }

    onPropertyChanged(name) {
        if (!this._npc) return;
        if (name === 'npcName') {
            this._npc.setHeadLabel(this.npcName);
            if (this._panel) this._panel.querySelector('#aiNpc-title').textContent = this.npcName;
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
