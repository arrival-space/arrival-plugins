/**
 * Vibes Challenge Status — 3D panel showing timer and letter progress.
 *
 * Place this in the scene wherever you want the status display.
 * Listens for events from the "Scavenger Hunt" controller and
 * updates a texture panel with timer countdown, letter slots,
 * and who collected each letter.
 */
export class VibesChallengeStatus extends ArrivalScript {
    static scriptName = "Vibes Challenge Status";

    panelWidth = 1.6;
    panelHeight = 1.2;
    resolution = 300;
    billboard = false;
    offsetY = 1.5;

    static properties = {
        panelWidth: { title: "Panel Width", min: 0.5, max: 5 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 5 },
        resolution: { title: "Resolution", min: 10, max: 600, step: 50 },
        billboard: { title: "Billboard Mode" },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 },
    };

    _panel = null;
    _state = null;
    _lastFilledCount = -1;

    initialize() {
        this._state = null;

        this._onStateUpdated = (data) => this._onState(data);
        this._onReset = () => this._onGameReset();
        ArrivalSpace.on("vibes:state-updated", this._onStateUpdated);
        ArrivalSpace.on("vibes:game-reset", this._onReset);

        this._buildPanel();
    }

    _onState(data) {
        const prevStarted = this._state?.started;
        const prevComplete = this._state?.gameComplete;
        this._state = data;

        // Only re-render when something visual changes (not every frame for the timer)
        const filledCount = (data.slots || []).filter((s) => s.filled).length;
        const needsUpdate =
            data.started !== prevStarted ||
            data.gameComplete !== prevComplete ||
            filledCount !== this._lastFilledCount;

        if (needsUpdate) {
            this._lastFilledCount = filledCount;
            this._doUpdate();
        }
    }

    _onGameReset() {
        this._state = null;
        this._lastFilledCount = -1;
        this._doUpdate();
    }

    _doUpdate() {
        if (!this._panel?.updateContent) return;
        this._panel.updateContent(this._renderHTML());
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

    // -- Rendering --

    _renderHTML() {
        const s = this._state;
        const m = 4;

        if (!s || !s.started) {
            return `<div style="width:100%;height:100%;background:transparent;"></div>`;
        }

        // Slots
        const slots = s.slots || [];
        let slotsHtml = "";
        for (const slot of slots) {
            const filled = slot.filled;
            const bg = filled ? "#3d2e08" : "#1a1508";
            const border = filled ? "#f5c542" : "rgba(255,255,255,0.25)";
            const letterColor = filled ? "#f5c542" : "rgba(255,255,255,0.3)";
            const shadow = filled ? "text-shadow:0 0 10px rgba(245,197,66,0.5);" : "";
            const who = filled && slot.collectedBy
                ? `<div style="font-size:8px;color:rgba(255,255,255,0.5);max-width:46px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">${this._esc(slot.collectedBy)}</div>`
                : "";

            slotsHtml += `
            <div style="
                width:48px;height:56px;
                background:${bg};
                border:2px solid ${border};
                border-radius:8px;
                display:flex;flex-direction:column;
                align-items:center;justify-content:center;
            ">
                <div style="font-size:26px;font-weight:bold;color:${letterColor};${shadow}">${slot.letter}</div>
                ${who}
            </div>`;
        }

        // Participants
        const participants = Object.values(s.participants || {});
        const partNames = participants.map((p) => this._esc(p.userName)).join(", ");

        // Headline
        const filled = slots.filter((sl) => sl.filled).length;
        let headline = "";
        let headlineColor = "#f5c542";
        if (s.gameComplete) {
            headline = s.allCollected ? "NAILED IT!" : "WIPEOUT!";
            headlineColor = s.allCollected ? "#f5c542" : "#ff6666";
        } else if (filled === 0) {
            headline = "SHRED &amp; COLLECT!";
        } else if (filled < slots.length - 1) {
            headline = "KEEP RIDING!";
        } else {
            headline = "ONE MORE!";
        }

        return `
        <div style="
            width:100%;height:100%;
            box-sizing:border-box;
            background:transparent;
            color:#fff;font-family:Arial,sans-serif;
            display:flex;flex-direction:column;
            align-items:center;justify-content:center;
        ">
            <div style="font-size:28px;font-weight:bold;color:${headlineColor};letter-spacing:3px;margin-bottom:10px;text-shadow:0 0 12px rgba(245,197,66,0.3);">
                ${headline}
            </div>
            <div style="display:flex;gap:6px;margin-bottom:8px;">
                ${slotsHtml}
            </div>
            ${partNames ? `<div style="background:#1a1508;padding:3px 10px;border-radius:6px;font-size:11px;color:rgba(255,255,255,0.5);max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${partNames}</div>` : ""}
        </div>`;
    }

    _esc(str) {
        return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // -- Property changes --

    onPropertyChanged(name) {
        if (name === "offsetY" && this._panel) {
            this._panel.setLocalPosition(0, this.offsetY, 0);
            return;
        }
        this._buildPanel();
    }

    // -- Cleanup --

    destroy() {
        if (this._onStateUpdated) ArrivalSpace.off("vibes:state-updated", this._onStateUpdated);
        if (this._onReset) ArrivalSpace.off("vibes:game-reset", this._onReset);
        this._destroyPanel();
    }
}
