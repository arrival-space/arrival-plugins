/**
 * Dynamic Iframe UI
 * 3D panel rendered with createHTMLPanel (iframe/CSS3).
 * Shows real HTML interactivity: input fields, button handlers, and live updates.
 */
export class InfoPanel extends ArrivalScript {
    static scriptName = "Dynamic Iframe UI";
    static description = "Interactive iframe-based 3D UI with real button events, text input, and live animated state updates.";

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
    _signalTimer = null;
    _clickCount = 0;
    _altAccent = false;
    _panelYaw = 0;
    _spinRemaining = 0;
    _signalPhase = 0;
    _sweepAngle = 0;

    initialize() {
        this.rebuildPanel();
    }

    destroyPanel() {
        if (this._clockTimer) {
            clearInterval(this._clockTimer);
            this._clockTimer = null;
        }
        if (this._signalTimer) {
            clearInterval(this._signalTimer);
            this._signalTimer = null;
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
                Real HTML events, input fields, and live animated widgets in 3D space.
            </p>

            <div style="display:flex;gap:12px;align-items:center;">
                <div id="iframeUiRadar" style="
                    position:relative;width:84px;height:84px;border-radius:999px;
                    border:1px solid rgba(96,165,250,.45);
                    background:radial-gradient(circle at 50% 50%, rgba(59,130,246,.22), rgba(17,24,39,.75) 70%);
                    overflow:hidden;flex-shrink:0;
                ">
                    <div style="position:absolute;inset:14px;border-radius:999px;border:1px solid rgba(147,197,253,.25);"></div>
                    <div style="position:absolute;inset:28px;border-radius:999px;border:1px solid rgba(147,197,253,.18);"></div>
                    <div id="iframeUiSweep" style="
                        position:absolute;left:50%;bottom:50%;
                        width:2px;height:36px;transform:translateX(-50%) rotate(0deg);
                        transform-origin:50% 100%;
                        background:linear-gradient(to top, rgba(16,185,129,.95), rgba(16,185,129,.1));
                    "></div>
                    <div id="iframeUiTarget" style="
                        position:absolute;left:50%;top:50%;width:8px;height:8px;
                        transform:translate(-50%,-50%);border-radius:999px;
                        background:#fbbf24;box-shadow:0 0 10px rgba(251,191,36,.75);
                    "></div>
                    <div style="
                        position:absolute;left:50%;top:50%;width:8px;height:8px;
                        transform:translate(-50%,-50%);border-radius:999px;
                        background:#34d399;
                    "></div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:12px;opacity:.85;margin-bottom:6px;">Live Signal</div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.82;margin-bottom:6px;">
                        <span id="iframeUiBearing">Bearing --°</span>
                        <span id="iframeUiRange">Range --m</span>
                    </div>
                    <div id="iframeUiBars" style="display:flex;align-items:flex-end;gap:4px;height:58px;">
                        <div data-bar style="flex:1;height:14px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:20px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:26px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:18px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:30px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:16px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:24px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:22px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:28px;border-radius:999px;background:#22d3ee;"></div>
                        <div data-bar style="flex:1;height:19px;border-radius:999px;background:#22d3ee;"></div>
                    </div>
                </div>
            </div>

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

    getPlayerScanData() {
        if (!this._panel) return null;

        const camera = ArrivalSpace.getCamera ? ArrivalSpace.getCamera() : this.app.root.findByName("Camera");
        if (!camera) return null;

        const panelPos = this._panel.getPosition();
        const cameraPos = camera.getPosition();
        const toPlayer = cameraPos.clone().sub(panelPos);
        const distance = toPlayer.length();
        if (distance <= 0.001) return null;

        const worldAngle = Math.atan2(toPlayer.x, toPlayer.z) * (180 / Math.PI);
        const panelYaw = this._panel.getEulerAngles().y;
        const localAngle = (worldAngle - panelYaw + 360) % 360;

        return { angle: localAngle, distance };
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
        const sweepEl = root.querySelector("#iframeUiSweep");
        const targetEl = root.querySelector("#iframeUiTarget");
        const bearingEl = root.querySelector("#iframeUiBearing");
        const rangeEl = root.querySelector("#iframeUiRange");
        const barEls = Array.from(root.querySelectorAll("[data-bar]"));

        const refreshClock = () => {
            if (!clockEl) return;
            clockEl.textContent = new Date().toLocaleTimeString();
        };

        refreshClock();
        this._clockTimer = setInterval(refreshClock, 1000);

        const updateSignal = () => {
            this._signalPhase += 0.28;
            const scanData = this.getPlayerScanData();
            const targetAngle = scanData ? scanData.angle : this._sweepAngle;
            const deltaToTarget = ((targetAngle - this._sweepAngle + 540) % 360) - 180;
            this._sweepAngle = (this._sweepAngle + deltaToTarget * 0.2 + 360) % 360;

            if (bearingEl) {
                bearingEl.textContent = scanData ? `Bearing ${Math.round(targetAngle)}°` : "Bearing --°";
            }
            if (rangeEl) {
                rangeEl.textContent = scanData ? `Range ${scanData.distance.toFixed(1)}m` : "Range --m";
            }

            if (sweepEl) {
                sweepEl.style.transform = `translateX(-50%) rotate(${this._sweepAngle}deg)`;
            }
            if (targetEl) {
                const radius = 30;
                const rad = (targetAngle * Math.PI) / 180;
                const x = Math.sin(rad) * radius;
                const y = -Math.cos(rad) * radius;
                targetEl.style.left = `calc(50% + ${x.toFixed(1)}px)`;
                targetEl.style.top = `calc(50% + ${y.toFixed(1)}px)`;
                targetEl.style.opacity = scanData ? "1" : "0.35";
            }

            for (let i = 0; i < barEls.length; i += 1) {
                const bar = barEls[i];
                const wave = (Math.sin(this._signalPhase + i * 0.55) + 1) * 0.5;
                const wobble = (Math.sin(this._signalPhase * 0.33 + i * 1.1) + 1) * 0.5;
                const lockStrength = 1 - Math.min(Math.abs(deltaToTarget) / 180, 1);
                const h = Math.round(10 + wave * (24 + lockStrength * 14) + wobble * 8);
                bar.style.height = `${h}px`;
                bar.style.opacity = `${0.45 + wave * 0.55}`;
                bar.style.background = lockStrength > 0.7 ? "#34d399" : "#22d3ee";
            }
        };
        updateSignal();
        this._signalTimer = setInterval(updateSignal, 50);

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
