/**
 * XR Activation Plugin
 *
 * Demonstrates the ArrivalSpace.xr API for entering / exiting
 * WebXR sessions (VR and AR passthrough) from a plugin.
 *
 * Only shows buttons for available modes. If neither VR nor AR
 * is supported, shows a single "XR not available" indicator.
 */
export class XRActivation extends ArrivalScript {
    static scriptName = "XR Activation";

    hideUI = true;

    static properties = {
        hideUI: { title: "Hide UI in XR" },
    };

    initialize() {
        this._panel = null;

        this._unsub = ArrivalSpace.xr.onStateChange((state) => {
            if (state.active && this.hideUI) ArrivalSpace.setAppUIVisible(false);
            if (!state.active && this.hideUI) ArrivalSpace.setAppUIVisible(true);
            this._updateButtons();
        });

        this._createUI();
    }

    _createUI() {
        this._panel = this.createUI("div", {
            id: "xr-activation-panel",
            style: {
                position: "fixed",
                bottom: "24px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "8px",
                zIndex: 1000,
            },
        });

        this._btnBase = "padding:12px 24px; border:none; border-radius:8px; color:#fff; font:600 15px Arial,sans-serif; ";

        this._updateButtons();
    }

    _updateButtons() {
        if (!this._panel) return;

        const { active, mode, availableVR, availableAR } = ArrivalSpace.xr.getState();
        const supported = availableVR || availableAR;

        if (!supported) {
            this._panel.innerHTML = `<button disabled style="${this._btnBase} background:#555; opacity:0.5; cursor:default;">XR not available</button>`;
            return;
        }

        const btns = [];

        if (active) {
            const exitColor = "#e04040";
            if (mode === "vr") btns.push(`<button id="xr-btn-vr" style="${this._btnBase} background:${exitColor}; cursor:pointer;">Exit VR</button>`);
            else btns.push(`<button id="xr-btn-ar" style="${this._btnBase} background:${exitColor}; cursor:pointer;">Exit AR Passthrough</button>`);
        } else {
            if (availableVR) btns.push(`<button id="xr-btn-vr" style="${this._btnBase} background:#4a6cf7; cursor:pointer;">Enter VR</button>`);
            if (availableAR) btns.push(`<button id="xr-btn-ar" style="${this._btnBase} background:#0ea574; cursor:pointer;">Enter AR Passthrough</button>`);
        }

        this._panel.innerHTML = btns.join("");

        const vrBtn = this._panel.querySelector("#xr-btn-vr");
        const arBtn = this._panel.querySelector("#xr-btn-ar");
        if (vrBtn) vrBtn.onclick = () => this._toggle("vr");
        if (arBtn) arBtn.onclick = () => this._toggle("ar");
    }

    async _toggle(mode) {
        if (ArrivalSpace.xr.active) {
            await ArrivalSpace.xr.exit();
            return;
        }
        await ArrivalSpace.xr.enter({ mode });
    }

    destroy() {
        if (this._unsub) this._unsub();
        if (ArrivalSpace.xr.active) ArrivalSpace.xr.exit();
    }
}
