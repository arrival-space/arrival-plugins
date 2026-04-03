/**
 * Scavenger Hunt Leaderboard — minimal 3D panel showing best times.
 *
 * Place alongside the Scavenger Hunt controller.
 * Listens for "scavenger:complete", saves to pluginStore, and
 * displays a ranked leaderboard on a 3D texture panel.
 *
 * All persistence lives here — the Hunt stays a pure game controller.
 *
 * Features demonstrated:
 * - pluginStore.push / pluginStore.get (write + read)
 * - createTexturePanel for 3D rendered UI
 * - Event-driven save + refresh (scavenger:complete)
 */
export class ScavengerLeaderboard extends ArrivalScript {
    static scriptName = "Scavenger Leaderboard";

    storeKey = "scavenger-best";
    title = "BEST TIMES";
    maxEntries = 10;
    panelWidth = 1.4;
    panelHeight = 1.8;
    resolution = 256;
    offsetY = 1.2;
    refreshInterval = 30;

    static properties = {
        storeKey: { title: "Store Key (change to wipe full board)" },
        title: { title: "Title" },
        maxEntries: { title: "Max Entries", min: 3, max: 20, step: 1 },
        panelWidth: { title: "Panel Width", min: 0.5, max: 5 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 5 },
        resolution: { title: "Resolution", min: 100, max: 600, step: 50 },
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

        this._onComplete = (data) => this._saveAndRefresh(data);
        this._onReset = () => this._clearOwnEntry();
        ArrivalSpace.on("scavenger:complete", this._onComplete);
        ArrivalSpace.on("scavenger:leaderboard:reset", this._onReset);
    }

    update(dt) {
        this._refreshTimer -= dt;
        if (this._refreshTimer <= 0) {
            this._refreshTimer = this.refreshInterval;
            this._fetchData();
        }
    }

    // -- Data --

    /** Clear the current user's entry. To wipe the full board, change storeKey. */
    async _clearOwnEntry() {
        if (!this.storeKey) return;
        await ArrivalSpace.pluginStore.delete(this.storeKey);
        this._fetchData();
    }

    async _saveAndRefresh(data) {
        if (!this.storeKey) return;
        const user = ArrivalSpace.getUser();
        const name = user?.userName || "Unknown";
        await ArrivalSpace.pluginStore.push(this.storeKey, name, {
            numval: data.time,
            mode: "min",
        });
        this._fetchData();
    }

    async _fetchData() {
        if (!this.storeKey) return;
        const data = await ArrivalSpace.pluginStore.get(this.storeKey, {
            sort: "asc",
            limit: this.maxEntries,
        });
        if (data) {
            this._entries = data;
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
        });
        if (!panel) return;

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
        let rows = "";

        if (this._entries.length === 0) {
            rows = `<div style="text-align:center;opacity:0.5;margin-top:30px;font-size:14px;">No times yet</div>`;
        } else {
            for (let i = 0; i < this._entries.length; i++) {
                const e = this._entries[i];
                const rank = i + 1;
                const medal = rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : rank === 3 ? "\u{1F949}" : "";
                const time = e.numval != null ? `${e.numval.toFixed(1)}s` : "-";
                const name = this._esc(String(e.value || "Unknown"));

                const highlight = rank <= 3;
                const bg = highlight ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)";
                const nameColor = highlight ? "#fff" : "rgba(255,255,255,0.7)";
                const timeColor = highlight ? "#4ade80" : "rgba(255,255,255,0.5)";

                rows += `
                <div style="display:flex;align-items:center;padding:6px 8px;margin-bottom:4px;border-radius:6px;background:${bg};">
                    <div style="width:28px;text-align:center;font-size:${highlight ? "16px" : "12px"};flex-shrink:0;">
                        ${medal || `<span style="opacity:0.4">${rank}</span>`}
                    </div>
                    <div style="flex:1;font-size:13px;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${name}
                    </div>
                    <div style="font-size:13px;font-weight:bold;color:${timeColor};flex-shrink:0;margin-left:8px;">
                        ${time}
                    </div>
                </div>`;
            }
        }

        return `
        <div style="
            width:100%;height:100%;padding:16px;box-sizing:border-box;
            border-radius:14px;background:rgba(0,0,0,0.85);
            border:1px solid rgba(255,255,255,0.1);
            color:#fff;font-family:Arial,sans-serif;
            display:flex;flex-direction:column;
        ">
            <div style="
                text-align:center;font-size:16px;font-weight:bold;
                letter-spacing:3px;margin-bottom:12px;padding-bottom:8px;
                border-bottom:1px solid rgba(255,255,255,0.15);
            ">${this._esc(this.title)}</div>
            <div style="flex:1;overflow:hidden;">
                ${rows}
            </div>
        </div>`;
    }

    _esc(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
        if (this._onComplete) ArrivalSpace.off("scavenger:complete", this._onComplete);
        if (this._onReset) ArrivalSpace.off("scavenger:leaderboard:reset", this._onReset);
        this._destroyPanel();
    }
}
