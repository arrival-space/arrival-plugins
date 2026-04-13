/**
 * Visited Spaces Tracker — records every space the user enters
 * (that has this plugin installed) and shows a 3D panel listing them.
 *
 * Uses ArrivalSpace.userData for cross-space persistence.
 *
 * Features demonstrated:
 * - userData.set / userData.get / userData.keys (namespace-scoped, cross-space)
 * - createTexturePanel for 3D rendered UI
 */
export class VisitedSpaces extends ArrivalScript {
    static scriptName = "Visited Spaces";

    namespace = "";
    title = "SPACES VISITED";
    panelWidth = 1.4;
    panelHeight = 1.8;
    resolution = 256;
    offsetY = 1.2;

    static properties = {
        namespace: { title: "Namespace (your space ID)" },
        title: { title: "Title" },
        panelWidth: { title: "Panel Width", min: 0.5, max: 5 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 5 },
        resolution: { title: "Resolution", min: 100, max: 600, step: 50 },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 },
    };

    _panel = null;
    _visits = [];

    async initialize() {
        if (!this.namespace) {
            console.warn("VisitedSpaces: set the 'namespace' property (e.g. your space ID)");
            return;
        }

        await this._recordVisit();
        await this._loadVisits();
        await this._buildPanel();
    }

    // -- Data --

    async _recordVisit() {
        const room = ArrivalSpace.getRoom();
        if (!room?.roomId) return;

        await ArrivalSpace.userData.set(this.namespace, `visit/${room.roomId}`, {
            name: room.roomName || room.roomId,
            lastVisit: new Date().toISOString(),
        });
    }

    async _loadVisits() {
        const keys = await ArrivalSpace.userData.keys(this.namespace, { prefix: "visit/" });
        if (!keys || keys.length === 0) {
            this._visits = [];
            return;
        }

        const visits = [];
        for (const key of keys) {
            const data = await ArrivalSpace.userData.get(this.namespace, key);
            if (data) {
                visits.push(data);
            }
        }
        // Most recent first
        visits.sort((a, b) => (b.lastVisit || "").localeCompare(a.lastVisit || ""));
        this._visits = visits;
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
        const room = ArrivalSpace.getRoom();
        const currentId = room?.roomId;
        let rows = "";

        if (this._visits.length === 0) {
            rows = `<div style="text-align:center;opacity:0.5;margin-top:30px;font-size:14px;">No visits yet</div>`;
        } else {
            for (let i = 0; i < this._visits.length; i++) {
                const v = this._visits[i];
                const name = this._esc(v.name || "Unknown");
                const date = v.lastVisit ? new Date(v.lastVisit).toLocaleDateString() : "";
                const isCurrent = v.name === (room?.roomName || currentId);
                const bg = isCurrent ? "rgba(99,179,237,0.15)" : "rgba(255,255,255,0.04)";
                const border = isCurrent ? "border:1px solid rgba(99,179,237,0.3);" : "";
                const nameColor = isCurrent ? "#63b3ed" : "rgba(255,255,255,0.85)";

                rows += `
                <div style="display:flex;align-items:center;padding:6px 10px;margin-bottom:4px;border-radius:8px;background:${bg};${border}">
                    <div style="width:24px;text-align:center;font-size:12px;opacity:0.4;flex-shrink:0;">${i + 1}</div>
                    <div style="flex:1;font-size:13px;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${name}${isCurrent ? ' <span style="font-size:10px;opacity:0.6;">(here)</span>' : ''}
                    </div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.4);flex-shrink:0;margin-left:8px;">
                        ${date}
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
            <div style="
                text-align:center;font-size:24px;font-weight:bold;
                color:#63b3ed;margin-bottom:12px;
            ">${this._visits.length}</div>
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
        if (name === "namespace") {
            this._loadVisits().then(() => this._updatePanel());
            return;
        }
        if (name === "offsetY" && this._panel) {
            this._panel.setLocalPosition(0, this.offsetY, 0);
            return;
        }
        this._buildPanel();
    }

    // -- Cleanup --

    destroy() {
        this._destroyPanel();
    }
}
