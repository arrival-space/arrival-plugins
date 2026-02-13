/**
 * Texture HTML UI
 * Static HTML rendered to a transparent texture in 3D.
 * Shows rounded corners, alpha transparency, and clickable <a> buttons.
 * Note: texture mode supports clickable <a href> links only (no JS events / no <button> behavior).
 */
export class TextureHtmlUI extends ArrivalScript {
    static scriptName = "Texture HTML UI";
    static description = "Transparent texture-based HTML UI: rounded corners, alpha transparency, and clickable <a> links only (no JS events / no <button> behavior).";

    panelWidth = 2;
    panelHeight = 1;
    resolution = 300;
    billboard = false;
    offsetY = 1;

    static properties = {
        panelWidth: { title: "Panel Width", min: 0.5, max: 10 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 10 },
        resolution: { title: "Resolution (px/unit)", min: 100, max: 600 },
        billboard: { title: "Billboard Mode" },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 }
    };

    _htmlContent = `
    <div style="
        width:100%;height:100%;padding:20px;box-sizing:border-box;
        background:rgba(19,26,40,.72);
        border-radius:24px;
        border:2px solid rgba(120,180,255,.45);
        color:white;font-family:Arial,sans-serif;
        display:flex;flex-direction:column;gap:12px;
    ">
        <h2 style="margin:0;color:#8dd6ff;font-size:24px;">Texture HTML UI</h2>
        <p style="margin:0;line-height:1.45;opacity:.95;">
            Rounded corners and transparency that are hard to do with iframe UI.
        </p>

        <div style="display:flex;gap:10px;margin-top:auto;">
            <a href="https://explore.arrival.space/" style="
                flex:1;display:flex;align-items:center;justify-content:center;
                padding:10px 12px;border-radius:10px;
                background:#3b82f6;color:white;text-decoration:none;font-weight:bold;
            "><span style="display:block;transform:translateY(2px);">Explore</span></a>
            <a href="https://arrival.space/" style="
                flex:1;display:flex;align-items:center;justify-content:center;
                padding:10px 12px;border-radius:10px;
                background:rgba(255,255,255,.16);
                border:1px solid rgba(255,255,255,.25);
                color:white;text-decoration:none;font-weight:bold;
            "><span style="display:block;transform:translateY(2px);">Website</span></a>
            <a href="arrival://spin-panel" style="
                flex:1;display:flex;align-items:center;justify-content:center;
                padding:10px 12px;border-radius:10px;
                background:rgba(16,185,129,.24);
                border:1px solid rgba(16,185,129,.5);
                color:#d1fae5;text-decoration:none;font-weight:bold;
            "><span style="display:block;transform:translateY(2px);">Spin 360°</span></a>
        </div>
    </div>
    `.trim();

    _panel = null;
    _buildToken = 0;
    _panelYaw = 0;
    _spinRemaining = 0;

    initialize() {
        this.rebuildPanel();
    }

    destroyPanel() {
        if (!this._panel) return;
        this._panel.destroy();
        this._panel = null;
    }

    async rebuildPanel() {
        const token = ++this._buildToken;
        this.destroyPanel();

        try {
            const panel = await ArrivalSpace.createTexturePanel({
                position: { x: 0, y: 0, z: 0 },
                width: this.panelWidth,
                height: this.panelHeight,
                resolution: this.resolution,
                html: this._htmlContent,
                transparent: true,
                billboard: this.billboard,
                onClick: (href) => {
                    href = String(href || "");
                    if (href.includes("spin-panel")) {
                        this._spinRemaining += 360;
                        return;
                    }
                    window.open(href, "_blank");
                }
            });

            if (token !== this._buildToken) {
                panel?.destroy();
                return;
            }

            this._panel = panel;
            this._panel.reparent(this.entity);
            this._panel.setLocalPosition(0, this.offsetY, 0);
            this._panel.setLocalEulerAngles(90, this._panelYaw, 0);
        } catch (err) {
            console.error("TextureHtmlUI: Failed to create panel:", err);
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
        this._buildToken++;
        this.destroyPanel();
    }
}
