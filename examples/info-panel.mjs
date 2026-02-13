/**
 * Dynamic Iframe UI
 * 3D panel rendered with createHTMLPanel (iframe/CSS3).
 * Shows real HTML interactivity: input fields, button handlers, and live updates.
 */
export class InfoPanel extends ArrivalScript {
    static scriptName = "Dynamic Iframe UI";
    static description = "Interactive iframe-based 3D UI with real button events, text input, and live state updates.";

    panelWidth = 2;
    panelHeight = 1;
    billboard = false;
    offsetY = 1;

    static properties = {
        panelWidth: { title: "Panel Width", min: 0.5, max: 10 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 10 },
        billboard: { title: "Billboard Mode" },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 }
    };

    _panel = null;
    _clockTimer = null;
    _clickCount = 0;
    _altAccent = false;
    _panelYaw = 0;
    _spinRemaining = 0;

    initialize() {
        this.rebuildPanel();
    }

    destroyPanel() {
        if (this._clockTimer) {
            clearInterval(this._clockTimer);
            this._clockTimer = null;
        }

        if (!this._panel) return;
        this._panel.destroy();
        this._panel = null;
    }

    rebuildPanel() {
        this.destroyPanel();

        const panel = ArrivalSpace.createHTMLPanel({
            position: { x: 0, y: 0, z: 0 },
            width: this.panelWidth,
            height: this.panelHeight,
            html: this.getHTML(),
            backgroundColor: "#111827",
            textColor: "#ffffff",
            interactive: true,
            billboard: this.billboard
        });

        if (!panel) return;

        this._panel = panel;
        this._panel.reparent(this.entity);
        this._panel.setLocalPosition(0, this.offsetY, 0);
        this._panel.setLocalEulerAngles(90, this._panelYaw, 0);
        this.bindPanelEvents();
    }

    getHTML() {
        return `
        <div id="iframeUiCard" style="
            width:100%;height:100%;padding:20px;box-sizing:border-box;
            border-radius:16px;
            border:1px solid rgba(96,165,250,.45);
            background:#1f2937;
            color:#fff;font-family:Arial,sans-serif;
            display:flex;flex-direction:column;gap:10px;
        ">
            <h2 style="margin:0;color:#93c5fd;font-size:24px;">Dynamic Iframe UI</h2>
            <p style="margin:0;line-height:1.35;opacity:.92;">
                Real HTML events and input fields in 3D space.
            </p>

            <div style="display:flex;gap:10px;font-size:13px;opacity:.9;">
                <span>Clicks: <strong id="iframeUiCount">0</strong></span>
                <span>Clock: <strong id="iframeUiClock">--:--:--</strong></span>
            </div>

            <input id="iframeUiInput" type="text" placeholder="Type something..."
                style="
                    width:100%;padding:10px 12px;border-radius:10px;
                    border:1px solid rgba(255,255,255,.2);
                    background:#0f172a;color:#fff;outline:none;
                ">

            <div id="iframeUiPreview" style="
                min-height:36px;padding:8px 10px;border-radius:10px;
                background:rgba(255,255,255,.08);font-size:13px;opacity:.95;
            ">Type above to update this preview.</div>

            <div style="display:flex;gap:10px;margin-top:auto;">
                <button id="iframeUiCountBtn" style="
                    flex:1;padding:10px 12px;border-radius:10px;border:none;
                    background:#3b82f6;color:#fff;cursor:pointer;font-weight:700;
                ">Count +1</button>
                <button id="iframeUiThemeBtn" style="
                    flex:1;padding:10px 12px;border-radius:10px;
                    border:1px solid rgba(255,255,255,.25);
                    background:#374151;color:#fff;cursor:pointer;font-weight:700;
                ">Toggle Theme</button>
                <button id="iframeUiSpinBtn" style="
                    flex:1;padding:10px 12px;border-radius:10px;
                    border:1px solid rgba(16,185,129,.55);
                    background:rgba(16,185,129,.25);color:#d1fae5;
                    cursor:pointer;font-weight:700;
                ">Spin 360</button>
            </div>
        </div>
        `.trim();
    }

    bindPanelEvents() {
        const root = this._panel?._iframePlane?.htmlElement;
        if (!root) return;

        const cardEl = root.querySelector("#iframeUiCard");
        const countEl = root.querySelector("#iframeUiCount");
        const clockEl = root.querySelector("#iframeUiClock");
        const inputEl = root.querySelector("#iframeUiInput");
        const previewEl = root.querySelector("#iframeUiPreview");
        const countBtn = root.querySelector("#iframeUiCountBtn");
        const themeBtn = root.querySelector("#iframeUiThemeBtn");
        const spinBtn = root.querySelector("#iframeUiSpinBtn");

        const refreshClock = () => {
            if (!clockEl) return;
            clockEl.textContent = new Date().toLocaleTimeString();
        };

        refreshClock();
        this._clockTimer = setInterval(refreshClock, 1000);

        if (countBtn) {
            countBtn.onclick = () => {
                this._clickCount += 1;
                if (countEl) countEl.textContent = String(this._clickCount);
            };
        }

        if (themeBtn && cardEl) {
            themeBtn.onclick = () => {
                this._altAccent = !this._altAccent;
                if (this._altAccent) {
                    cardEl.style.borderColor = "rgba(250,204,21,.55)";
                    cardEl.style.background = "#3f2f16";
                } else {
                    cardEl.style.borderColor = "rgba(96,165,250,.45)";
                    cardEl.style.background = "#1f2937";
                }
            };
        }

        if (inputEl && previewEl) {
            inputEl.oninput = () => {
                const text = String(inputEl.value || "").trim();
                previewEl.textContent = text || "Type above to update this preview.";
            };
        }

        if (spinBtn) {
            spinBtn.onclick = () => {
                this._spinRemaining += 360;
            };
        }
    }

    update(dt) {
        if (!this._panel || this._spinRemaining <= 0) return;

        const step = Math.min(this._spinRemaining, dt * 540);
        this._spinRemaining -= step;
        this._panelYaw = (this._panelYaw + step) % 360;
        this._panel.setLocalEulerAngles(90, this._panelYaw, 0);
    }

    onPropertyChanged(name, value) {
        if (name === "offsetY" && this._panel) {
            this._panel.setLocalPosition(0, value, 0);
            return;
        }

        this.rebuildPanel();
    }

    destroy() {
        this.destroyPanel();
    }
}
