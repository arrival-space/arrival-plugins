/// <reference path="../types/arrival.d.ts" />
/**
 * AI Text Tool
 *
 * A non-NPC example of the general ArrivalSpace.ai.complete API. A small HUD
 * panel: the visitor pastes text, picks an operation (summarize / translate /
 * rewrite), and the plugin builds its OWN system prompt and runs a one-shot
 * completion — `prompt` only, no chat history. Same API the AI NPC uses for
 * chat, here doing arbitrary text work: ai.complete is general, not NPC-shaped.
 *
 * Runs free on GLM by default. If the space owner has stored a paid provider
 * key, set `provider` and the call spends it through this placed entity
 * (bounded by daily caps). Uses the `this.aiComplete(...)` forwarder, which
 * auto-fills this entity's id.
 */
export class AiTextTool extends ArrivalScript {
    static scriptName = 'AI Text Tool';

    title = 'AI Text Tool';
    provider = 'glm';

    static properties = {
        title: { title: 'Panel Title' },
        provider: {
            title: 'AI Provider',
            options: [
                { label: 'GLM (free)', value: 'glm' },
                { label: 'OpenAI (own key)', value: 'openai' },
                { label: 'Anthropic (own key)', value: 'anthropic' },
            ],
        },
    };

    // Each operation is just a system prompt the plugin supplies itself — the
    // whole point of the general API. Add your own here.
    _ops = {
        'Summarize': 'Summarize the user\'s text in 1-2 concise sentences. Output only the summary.',
        'Translate → Spanish': 'Translate the user\'s text into natural Spanish. Output only the translation.',
        'Rewrite friendlier': 'Rewrite the user\'s text in a warmer, friendlier tone. Output only the rewrite, nothing else.',
    };

    initialize() {
        this._busy = false;
        this._openPanel();
    }

    _openPanel() {
        this._panel = this.createUI('div', {
            id: 'aiTextTool-panel',
            style: {
                position: 'fixed',
                bottom: '8px',
                left: '16px',
                width: '320px',
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

        const options = Object.keys(this._ops)
            .map((k) => `<option value="${k}">${k}</option>`)
            .join('');

        this._panel.innerHTML = `
            <div style="padding: 0 15px; height: 40px; background: #00000026; display: flex; align-items: center;">
                <span id="aiTextTool-title" style="color: white; font-weight: 600; font-size: 14px;"></span>
            </div>
            <div style="padding: 10px; display: flex; flex-direction: column; gap: 8px;">
                <textarea id="aiTextTool-input" rows="4" placeholder="Paste text…" maxlength="2000"
                    style="resize: vertical; padding: 8px 10px; border-radius: 12px; border: none; background: #00000026; color: white; font-size: 13px; outline: none; font-family: inherit;"></textarea>
                <div style="display: flex; gap: 8px;">
                    <select id="aiTextTool-op"
                        style="flex: 1; padding: 8px 10px; border-radius: 12px; border: none; background: #00000026; color: white; font-size: 13px; outline: none;">
                        ${options}
                    </select>
                    <button id="aiTextTool-run" style="padding: 8px 16px; border-radius: 12px; border: none; background: #38b4b0; color: #fff; cursor: pointer; font-weight: 600;">Run</button>
                </div>
                <div id="aiTextTool-result" style="min-height: 20px; padding: 8px 12px; border-radius: 10px; background: #00000026; color: white; font-size: 13px; white-space: pre-wrap; word-wrap: break-word;"></div>
            </div>
        `;

        this._panel.querySelector('#aiTextTool-title').textContent = this.title;
        this._inputEl = this._panel.querySelector('#aiTextTool-input');
        this._opEl = this._panel.querySelector('#aiTextTool-op');
        this._resultEl = this._panel.querySelector('#aiTextTool-result');
        this._panel.querySelector('#aiTextTool-run').onclick = () => this._run();
    }

    async _run() {
        if (this._busy) return;
        const text = this._inputEl.value.trim();
        if (!text) return;
        this._busy = true;
        this._resultEl.textContent = '…';

        const system = this._ops[this._opEl.value] || this._ops.Summarize;
        // One-shot: `prompt` only, no history. entityId is auto-filled by the forwarder.
        const res = await this.aiComplete({ system, prompt: text, provider: this.provider });

        this._busy = false;
        this._resultEl.textContent = (res && res.answer)
            ? res.answer
            : (res?.error || 'No answer — please try again.');
    }

    onPropertyChanged(name) {
        if (name === 'title' && this._panel) {
            this._panel.querySelector('#aiTextTool-title').textContent = this.title;
        }
    }

    destroy() {
        this.removeUI();
    }
}
