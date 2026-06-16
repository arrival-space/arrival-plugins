/**
 * Sound Press Button — a clickable 3D button that controls a Custom Sound entity.
 *
 * Setup:
 * 1. Drop a Custom Sound entity in your space (with its audio URL set).
 * 2. Add this plugin and pick that sound entity in the editor.
 * 3. Choose a behavior (toggle / play / pause / stop) and press the button.
 *
 * The button is an HTML-styled panel rendered in-world via
 * `ArrivalSpace.createTexturePanel` (icon + label). Pressing it resolves the
 * picked entity's `customSoundEntity` script and drives playback.
 *
 * Features demonstrated:
 * - Entity picker filtered to Custom Sound entities
 *   (`editor: "entity"`, `filterTypes: ["custom-sound-entity"]`)
 * - In-world HTML button via `createTexturePanel` with an `arrival://` click link
 * - Behavior modes: toggle / play / pause / stop
 * - Optional keyboard shortcut and editor action buttons (Play / Pause / Stop)
 * - Max-distance guard with an error flash
 */
export class SoundPressButton extends ArrivalScript {
    static scriptName = "Sound Press Button";

    soundEntityId = "";
    behavior = "toggle";
    label = "Play";
    icon = "\u25B6";
    buttonWidth = 1.0;
    buttonHeight = 0.45;
    billboard = true;
    backgroundColor = "#101827e6";
    accentColor = "#38bdf8";
    textColor = "#ffffff";
    cornerRadius = 16;
    keyShortcut = "";
    maxDistance = 25;

    static properties = {
        soundEntityId: {
            title: "Sound Entity",
            editor: "entity",
            filterTypes: ["custom-sound-entity"],
        },
        behavior: {
            title: "Behavior",
            options: [
                { label: "Toggle Play / Pause", value: "toggle" },
                { label: "Play", value: "play" },
                { label: "Pause", value: "pause" },
                { label: "Stop", value: "stop" },
            ],
        },
        label: { title: "Label", placeholder: "Play" },
        icon: { title: "Icon", placeholder: "Emoji or text (e.g. \u25B6)" },
        buttonWidth: { title: "Button Width", min: 0.2, max: 4, step: 0.05 },
        buttonHeight: { title: "Button Height", min: 0.1, max: 2, step: 0.05 },
        billboard: { title: "Face Camera" },
        backgroundColor: { title: "Background Color" },
        accentColor: { title: "Accent Color" },
        textColor: { title: "Text Color" },
        cornerRadius: { title: "Corner Radius", min: 0, max: 64, step: 1 },
        keyShortcut: { title: "Keyboard Shortcut", placeholder: "e.g. p" },
        maxDistance: { title: "Max Press Distance", min: 1, max: 100, step: 1 },
        play: { title: "Play", editor: "action" },
        pause: { title: "Pause", editor: "action" },
        stop: { title: "Stop", editor: "action" },
    };

    _panel = null;
    _panelToken = 0;
    _unsubKey = null;
    _flashRemaining = 0;
    _flashing = false;

    initialize() {
        this._rebuildPanel();
        this._bindKeyboardShortcut();
    }

    update(dt) {
        if (this._flashRemaining > 0) {
            this._flashRemaining = Math.max(0, this._flashRemaining - dt);
            if (this._flashRemaining === 0 && this._flashing) {
                this._flashing = false;
                this._rebuildPanel();
            }
        }
    }

    onPropertyChanged(name) {
        if (name === "keyShortcut") {
            this._bindKeyboardShortcut();
            return;
        }

        // These are read live when the button is pressed, so changing them
        // needs no panel rebuild. Everything else affects the visuals.
        if (name === "behavior" || name === "maxDistance" || name === "soundEntityId") {
            return;
        }

        this._rebuildPanel();
    }

    play() {
        const sound = this._getSoundScript();
        if (!sound) return false;
        sound.play?.();
        return true;
    }

    pause() {
        const sound = this._getSoundScript();
        if (!sound) return false;
        sound.pause?.();
        return true;
    }

    stop() {
        const sound = this._getSoundScript();
        if (!sound) return false;
        sound.stop?.();
        return true;
    }

    _press() {
        if (!this._isInRange()) {
            this._flashError();
            return false;
        }

        const sound = this._getSoundScript();
        if (!sound) {
            this._flashError();
            return false;
        }

        switch (this.behavior) {
            case "play":
                sound.play?.();
                return true;
            case "pause":
                sound.pause?.();
                return true;
            case "stop":
                sound.stop?.();
                return true;
            case "toggle":
            default:
                if (sound.controller?.isPlaying?.()) {
                    sound.pause?.();
                } else {
                    sound.play?.();
                }
                return true;
        }
    }

    _isInRange() {
        const camera = ArrivalSpace.getCamera?.();
        const cameraPos = camera?.getPosition?.();
        if (!cameraPos) return true;
        return cameraPos.distance(this.position) <= Math.max(1, Number(this.maxDistance) || 25);
    }

    _getSoundScript() {
        const id = typeof this.soundEntityId === "string" ? this.soundEntityId.trim() : "";
        if (!id) {
            this.warn?.("SoundPressButton: No sound entity selected.");
            return null;
        }

        const gateServer = this.app?.root?.findByName?.("GateServer")?.script?.gateServer;
        const entity = gateServer?.getEntity?.(id);
        const script = entity?.script?.customSoundEntity;
        if (!script) {
            this.warn?.(`SoundPressButton: Sound entity "${id}" not found.`);
            return null;
        }
        return script;
    }

    _rebuildPanel() {
        this._buildPanel().catch((err) => console.error("SoundPressButton: Failed to build button.", err));
    }

    async _buildPanel() {
        const token = ++this._panelToken;
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }

        const accent = this._flashing ? "#ef4444" : this.accentColor;
        const fontSize = Math.max(14, Math.round(this.buttonHeight * 220));
        const iconSize = Math.round(fontSize * 1.0);
        const icon = (this.icon || "").trim();
        const label = (this.label || "").trim();
        const iconHtml = icon ? `<span style="font-size:${iconSize}px;line-height:1;">${icon}</span>` : "";
        const labelHtml = label ? `<span style="font-size:${fontSize}px;line-height:1;">${label}</span>` : "";
        const gap = icon && label ? 10 : 0;

        const html = `<a href="arrival://press" style="
            display:flex;align-items:center;justify-content:center;gap:${gap}px;
            width:100%;height:100%;box-sizing:border-box;padding:8px 18px;
            background:${this.backgroundColor};
            border:2px solid ${accent};
            border-radius:${Math.max(0, Number(this.cornerRadius) || 0)}px;
            color:${this.textColor};
            font-family:Arial,sans-serif;font-weight:600;
            text-decoration:none;
            box-shadow:0 0 24px ${accent}66, inset 0 0 12px ${accent}33;
        ">${iconHtml}${labelHtml}</a>`;

        const panel = await ArrivalSpace.createTexturePanel({
            position: this.entity.getPosition(),
            width: Math.max(0.2, Number(this.buttonWidth) || 1),
            height: Math.max(0.1, Number(this.buttonHeight) || 0.45),
            resolution: 320,
            html,
            transparent: true,
            billboard: !!this.billboard,
            onClick: (href) => {
                if (!href || href.includes("arrival://press")) {
                    this._press();
                }
            },
        });

        if (token !== this._panelToken) {
            panel?.destroy();
            return;
        }
        if (!panel) return;

        this._panel = panel;
        panel.reparent(this.entity);
        panel.setLocalPosition(0, 0, 0);
        if (!this.billboard) panel.setLocalEulerAngles(90, 0, 0);
    }

    _bindKeyboardShortcut() {
        if (this._unsubKey) {
            this._unsubKey();
            this._unsubKey = null;
        }
        const key = typeof this.keyShortcut === "string" ? this.keyShortcut.trim() : "";
        if (!key) return;
        this._unsubKey = this.onKeyDown?.(key, () => this._press());
    }

    _flashError() {
        this._flashing = true;
        this._flashRemaining = 0.22;
        this._rebuildPanel();
    }

    destroy() {
        this._panelToken++;
        if (this._unsubKey) {
            this._unsubKey();
            this._unsubKey = null;
        }
        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
    }
}
