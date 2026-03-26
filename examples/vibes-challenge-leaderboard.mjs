/**
 * Vibes Challenge Leaderboard — 3D panel showing best times.
 *
 * Place this in the scene as a physical leaderboard sign.
 * Uses createTexturePanel for a texture-rendered 3D panel and
 * pluginStore to fetch the top times.
 *
 * Refreshes automatically when a player completes the challenge
 * (listens for scavenger:leaderboard:updated) and on a timer.
 */
export class VibesLeaderboard extends ArrivalScript {
    static scriptName = "Vibes Leaderboard";

    storeKey = "vibes-best-time";
    title = "BEST TIMES";
    maxEntries = 10;
    panelWidth = 1.8;
    panelHeight = 2.2;
    resolution = 300;
    billboard = false;
    offsetY = 1.5;
    refreshInterval = 30;

    static properties = {
        storeKey: { title: "Store Key" },
        title: { title: "Title" },
        maxEntries: { title: "Max Entries", min: 3, max: 20, step: 1 },
        panelWidth: { title: "Panel Width", min: 0.5, max: 5 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 5 },
        resolution: { title: "Resolution", min: 100, max: 600, step: 50 },
        billboard: { title: "Billboard Mode" },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 },
        refreshInterval: { title: "Refresh (s)", min: 5, max: 120, step: 5 },
    };

    _panel = null;
    _entries = [];
    _refreshTimer = 0;

    async initialize() {
        this._entries = [];
        await this._buildPanel();
        this._fetchData();

        this._onUpdated = () => this._fetchData();
        ArrivalSpace.on("scavenger:leaderboard:updated", this._onUpdated);
    }

    update(dt) {
        this._refreshTimer -= dt;
        if (this._refreshTimer <= 0) {
            this._refreshTimer = this.refreshInterval;
            this._fetchData();
        }
    }

    async _fetchData() {
        if (!this.storeKey) return;
        const data = await ArrivalSpace.pluginStore.get(this.storeKey, {
            sort: "desc",
            limit: this.maxEntries,
            prefix: true,
        });
        if (data) {
            console.log("== leaderboard raw entries:", data.map(e => ({ numval: e.numval, value: e.value })));
            const seen = new Set();
            this._entries = data.filter((e) => {
                let name = "";
                try { name = JSON.parse(e.value).names; } catch { name = e.value; }
                if (seen.has(name)) return false;
                seen.add(name);
                return true;
            });
            this._updatePanel();
        }
    }

    // -- Panel --

    async _buildPanel() {
        this._destroyPanel();

        const panel = await ArrivalSpace.createTexturePanel({
            position: { x: 0, y: 0, z: 0 },
            width: this.panelWidth,
            height: this.panelHeight,
            resolution: this.resolution,
            html: this._renderHTML(),
            transparent: true,
            billboard: this.billboard,
        });

        if (!panel) return;

        // Add specularity to the panel material
        if (panel.render?.meshInstances?.length) {
            const mat = panel.render.meshInstances[0].material;
            if (mat) {
                mat.shininess = 90;
                mat.metalness = 0.7;
                mat.useMetalness = true;
                mat.twoSidedLighting = true;
                mat.cull = pc.CULLFACE_NONE;
                mat.update();
            }
        }

        this._panel = panel;
        this._panel.reparent(this.entity);
        this._panel.setLocalPosition(0, this.offsetY, 0);
        this._panel.setLocalEulerAngles(90, 180, 0);
    }

    _destroyPanel() {
        if (this._panel) {
            ArrivalSpace.disposeEntity(this._panel);
            this._panel = null;
        }
    }

    _updatePanel() {
        if (!this._panel?.updateContent) return;
        this._panel.updateContent(this._renderHTML());
    }

    _renderHTML() {
        const m = 4;
        let rows = "";

        if (this._entries.length === 0) {
            rows = `<div style="text-align:center;opacity:0.5;margin-top:30px;font-size:15px;">No times yet — be the first!</div>`;
        } else {
            for (let i = 0; i < this._entries.length; i++) {
                const e = this._entries[i];
                const rank = i + 1;
                const isTop3 = rank <= 3;
                const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
                const score = e.numval || 0;
                const filledCount = Math.round(score / 10000);
                const timeTaken = (filledCount * 10000 - score).toFixed(1);
                const time = filledCount >= 1 ? `${timeTaken}s` : "-";

                // Parse value: JSON with { names, slots } or plain string
                let name = "";
                try {
                    const parsed = JSON.parse(e.value);
                    name = this._escapeHtml(parsed.names || "Unknown");
                } catch {
                    name = this._escapeHtml(String(e.value || "Unknown"));
                }

                const slotsHtml = "";

                const rowBg = rank === 1
                    ? "rgba(245,197,66,0.15)"
                    : isTop3
                        ? "rgba(245,197,66,0.07)"
                        : "rgba(255,255,255,0.04)";
                const rowBorder = rank === 1 ? "border:1px solid rgba(245,197,66,0.3);" : "";
                const nameStyle = isTop3
                    ? "color:#f5c542;font-weight:bold;"
                    : "color:rgba(255,255,255,0.85);";
                const timeStyle = isTop3
                    ? "color:#f5c542;"
                    : "color:rgba(255,255,255,0.6);";

                rows += `
                <div style="
                    display:flex;flex-direction:column;
                    padding:7px 10px;margin-bottom:5px;
                    border-radius:10px;
                    background:${rowBg};${rowBorder}
                ">
                    <div style="display:flex;align-items:center;">
                        <div style="width:32px;text-align:center;font-size:${isTop3 ? "18px" : "13px"};flex-shrink:0;">
                            ${medal || '<span style="opacity:0.35">' + rank + "</span>"}
                        </div>
                        <div style="flex:1;font-size:15px;${nameStyle}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            ${name}
                        </div>
                        <div style="font-size:15px;font-weight:bold;${timeStyle}flex-shrink:0;margin-left:10px;">
                            ${time}
                        </div>
                    </div>
                    ${slotsHtml ? `<div style="margin-top:4px;margin-left:32px;">${slotsHtml}</div>` : ""}
                </div>`;
            }
        }

        return `
        <div style="
            width:calc(100% - ${m * 2}px);height:calc(100% - ${m * 2}px);
            margin:${m}px;padding:22px;box-sizing:border-box;
            border-radius:20px;
            border:1px solid rgba(245,197,66,0.35);
            background:#1a1508;
            color:#fff;font-family:Arial,sans-serif;
            display:flex;flex-direction:column;
        ">
            <div style="
                text-align:center;font-size:20px;font-weight:bold;
                color:#f5c542;letter-spacing:4px;
                margin-bottom:16px;padding-bottom:12px;
                border-bottom:1px solid rgba(245,197,66,0.2);
            ">${this._escapeHtml(this.title)}</div>
            <div style="flex:1;overflow:hidden;">
                ${rows}
            </div>
        </div>`;
    }

    _escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // -- Property changes --

    onPropertyChanged(name) {
        if (name === "offsetY" && this._panel) {
            this._panel.setLocalPosition(0, this.offsetY, 0);
            return;
        }
        if (name === "storeKey" || name === "maxEntries") {
            this._fetchData();
            return;
        }
        this._buildPanel();
        this._fetchData();
    }

    // -- Cleanup --

    destroy() {
        if (this._onUpdated) ArrivalSpace.off("scavenger:leaderboard:updated", this._onUpdated);
        this._destroyPanel();
    }
}
