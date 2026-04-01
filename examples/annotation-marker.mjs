/**
 * Annotation Marker
 *
 * A 3D marker with an icon and a markdown description popup.
 *
 * - Icon: emoji, text, image URL, or raw HTML snippet
 * - Description: markdown text rendered as a styled popup panel
 * - Show modes: always visible, click to toggle, or distance-triggered
 * - Fixed screen size: icon stays the same apparent size regardless of distance
 */
export class AnnotationMarker extends ArrivalScript {
    static scriptName = "Annotation Marker";

    icon = "\u{1F4CD}";
    iconSize = 0.5;
    description = "# Title\n\nYour description here.\n\n- Supports **bold** and *italic*\n- [Links](https://arrival.space)\n- Lists and `code`";
    panelWidth = 2.0;
    panelHeight = 1.0;
    alwaysOpen = true;
    openByDistance = false;
    clickToToggle = true;
    triggerDistance = 5;
    iconBackground = "#131a28d9";
    iconShowBackground = true;
    iconBorderColor = "#78b4ff80";
    iconBorderWidth = 2;
    backgroundColor = "#131a28e0";
    textColor = "#ffffff";
    titleColor = "#8dd6ff";
    linkColor = "#60a5fa";
    showClose = true;
    showRotate = true;
    fixedScreenSize = false;
    billboard = true;
    castShadows = false;

    static properties = {
        icon: { title: "Icon", placeholder: "Emoji, text, image URL, or HTML" },
        iconSize: { title: "Icon Size", min: 0.1, max: 2 },
        description: { title: "Description (Markdown)" },
        panelWidth: { title: "Panel Width", min: 0.5, max: 6 },
        panelHeight: { title: "Panel Height", min: 0.3, max: 4 },
        alwaysOpen: { title: "Always Open" },
        openByDistance: { title: "Open by Distance" },
        clickToToggle: { title: "Click to Toggle" },
        triggerDistance: { title: "Trigger Distance", min: 1, max: 30 },
        iconBackground: { title: "Icon Background" },
        iconShowBackground: { title: "Icon Show Background" },
        iconBorderColor: { title: "Icon Border Color" },
        iconBorderWidth: { title: "Icon Border Width", min: 0, max: 8 },
        backgroundColor: { title: "Background Color" },
        textColor: { title: "Text Color" },
        titleColor: { title: "Title Color" },
        linkColor: { title: "Link Color" },
        showClose: { title: "Show Close Button" },
        showRotate: { title: "Show Rotate Button" },
        fixedScreenSize: { title: "Fixed Screen Size" },
        billboard: { title: "Billboard" },
        castShadows: { title: "Cast Shadows" },
    };

    _container = null;
    _iconPanel = null;
    _descPanel = null;
    _descVisible = false;
    _iconToken = 0;
    _descToken = 0;
    _wasInRange = false;
    _spinRemaining = 0;
    _descYaw = 0;

    static REF_DIST = 5;

    initialize() {
        // Disable the entity's default collision so it doesn't block panel clicks
        if (this.entity.collision) this.entity.collision.enabled = false;

        this._container = new pc.Entity("AnnotationContainer");
        this.entity.addChild(this._container);

        this._buildIcon().catch(console.error);

        if (this.alwaysOpen) {
            this._showDescription();
        }
    }

    // ── Icon ──

    async _buildIcon() {
        const token = ++this._iconToken;
        if (this._iconPanel) { this._iconPanel.destroy(); this._iconPanel = null; }

        const html = `<a href="arrival://toggle" style="display:block;width:100%;height:100%;text-decoration:none;">${this._renderIcon()}</a>`;

        const panel = await ArrivalSpace.createTexturePanel({
            position: this.entity.getPosition(),
            width: this.iconSize,
            height: this.iconSize,
            resolution: Math.round(256 / this.iconSize),
            html,
            transparent: true,
            billboard: this.billboard,
            onClick: () => this._onIconClick(),
        });

        if (token !== this._iconToken) { panel?.destroy(); return; }

        this._iconPanel = panel;
        panel.reparent(this._container);
        panel.setLocalPosition(0, 0, 0);
        if (!this.billboard) panel.setLocalEulerAngles(90, 0, 0);
        if (panel.render) panel.render.castShadows = this.castShadows;
        // Fix collision: createTexturePanel sets halfExtents in world units but entity is
        // already scaled by (width, 1, height), causing double-scaling. Use unit-space extents.
        if (panel.collision) panel.collision.halfExtents = new pc.Vec3(0.5, 0.01, 0.5);
    }

    _renderIcon() {
        const icon = this.icon.trim();
        if (icon.startsWith("<")) return icon; // raw HTML

        const bg = this.iconShowBackground ? this.iconBackground : "transparent";
        const bw = this.iconBorderWidth;
        const border = bw > 0 ? `${bw}px solid ${this.iconBorderColor}` : "none";
        const inset = bw > 0 ? bw + 2 : 0;
        const circle = `width:calc(100% - ${inset * 2}px);height:calc(100% - ${inset * 2}px);margin:${inset}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
            background:${bg};border-radius:50%;border:${border};`;
        const pxSize = Math.round(this.iconSize * Math.round(256 / this.iconSize));
        const fontSize = Math.round(pxSize * 0.55);

        if (/^https?:\/\//i.test(icon)) {
            return `<div style="${circle}"><img src="${icon}" style="width:75%;height:75%;object-fit:contain;border-radius:50%;"></div>`;
        }

        return `<div style="${circle}font-size:${fontSize}px;line-height:1;">${icon}</div>`;
    }

    _onIconClick() {
        if (!this.clickToToggle) return;
        if (this._descVisible) {
            this._hideDescription();
        } else {
            this._showDescription();
        }
    }

    // ── Description ──

    _showDescription() {
        if (this._descPanel) {
            this._descPanel.enabled = true;
            this._descVisible = true;
            return;
        }
        this._buildDescription().catch(console.error);
    }

    _hideDescription() {
        if (this._descPanel) this._descPanel.enabled = false;
        this._descVisible = false;
    }

    async _buildDescription() {
        const token = ++this._descToken;
        if (this._descPanel) { this._descPanel.destroy(); this._descPanel = null; }

        const bodyHtml = this._markdownToHtml(this.description);
        const m = 4;
        const closeBtn = this.showClose ? `<a href="arrival://close" style="
            position:absolute;top:10px;right:10px;
            width:28px;height:28px;display:flex;align-items:center;justify-content:center;
            background:rgba(255,255,255,0.1);border-radius:50%;
            color:${this.textColor};text-decoration:none;font-size:16px;line-height:1;
        ">\u2715</a>` : "";
        const spinBtn = this.showRotate ? `<a href="arrival://spin" style="
            position:absolute;top:10px;right:${this.showClose ? 44 : 10}px;
            width:28px;height:28px;display:flex;align-items:center;justify-content:center;
            background:rgba(255,255,255,0.1);border-radius:50%;
            color:${this.textColor};text-decoration:none;font-size:14px;line-height:1;
        ">\u21BB</a>` : "";
        const html = `<div style="
            position:relative;
            width:calc(100% - ${m * 2}px);height:calc(100% - ${m * 2}px);margin:${m}px;padding:20px;box-sizing:border-box;
            background:${this.backgroundColor};border-radius:16px;
            border:1px solid rgba(120,180,255,0.35);
            color:${this.textColor};font-family:Arial,sans-serif;font-size:16px;line-height:1.5;
            overflow:hidden;
        ">${spinBtn}${closeBtn}${bodyHtml}</div>`;

        const panel = await ArrivalSpace.createTexturePanel({
            position: this.entity.getPosition(),
            width: this.panelWidth,
            height: this.panelHeight,
            resolution: 200,
            html,
            transparent: true,
            billboard: false,
            onClick: (href) => {
                if (!href) return;
                if (href.includes("arrival://close")) {
                    this._hideDescription();
                    return;
                }
                if (href.includes("arrival://spin")) {
                    this._spinRemaining += 360;
                    return;
                }
                window.open(href, "_blank");
            },
        });

        if (token !== this._descToken) { panel?.destroy(); return; }

        this._descPanel = panel;
        panel.reparent(this._container);
        const yOffset = this.iconSize / 2 + this.panelHeight / 2 + 0.15;
        panel.setLocalPosition(0, yOffset, 0);
        if (!this.billboard) panel.setLocalEulerAngles(90, 0, 0);
        if (panel.render) panel.render.castShadows = this.castShadows;
        this._descVisible = true;
    }

    // ── Markdown ──

    _markdownToHtml(md) {
        md = md.replace(/\\n/g, "\n");
        return md.split(/\n\n+/).map(block => {
            block = block.trim();
            if (!block) return "";
            if (block.startsWith("### ")) return `<h3 style="margin:0 0 8px;font-size:18px;color:${this.titleColor};">${this._inline(block.slice(4))}</h3>`;
            if (block.startsWith("## "))  return `<h2 style="margin:0 0 8px;font-size:22px;color:${this.titleColor};">${this._inline(block.slice(3))}</h2>`;
            if (block.startsWith("# "))   return `<h1 style="margin:0 0 8px;font-size:26px;color:${this.titleColor};">${this._inline(block.slice(2))}</h1>`;
            if (/^[-*] /m.test(block)) {
                const items = block.split("\n")
                    .filter(l => /^[-*] /.test(l))
                    .map(l => `<li style="margin:2px 0;">${this._inline(l.replace(/^[-*] /, ""))}</li>`)
                    .join("");
                return `<ul style="margin:4px 0;padding-left:20px;">${items}</ul>`;
            }
            return `<p style="margin:4px 0;">${this._inline(block.replace(/\n/g, "<br>"))}</p>`;
        }).join("");
    }

    _inline(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${this.linkColor};text-decoration:underline;">$1</a>`)
            .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:3px;font-family:monospace;">$1</code>');
    }

    // ── Update ──

    update(dt) {
        const cam = ArrivalSpace.getCamera();
        if (!cam || !this._container) return;

        if (this._descPanel && this._descVisible) {
            if (this._spinRemaining > 0) {
                const step = Math.min(this._spinRemaining, dt * 540);
                this._spinRemaining -= step;
                this._descYaw = (this._descYaw + step) % 360;
                this._descPanel.setLocalEulerAngles(90, this._descYaw, 0);
            } else if (this.billboard) {
                this._descPanel.lookAt(cam.getPosition());
                this._descPanel.rotateLocal(90, 180, 0);
            }
        }

        const dist = cam.getPosition().distance(this.position);

        if (this.fixedScreenSize) {
            const s = Math.max(0.15, dist / AnnotationMarker.REF_DIST);
            this._container.setLocalScale(s, s, s);
            // Collision shapes don't inherit parent scale (PlayCanvas known issue) — update manually
            if (this._iconPanel?.collision) {
                const hs = this.iconSize / 2 * s;
                this._iconPanel.collision.halfExtents = new pc.Vec3(hs, 0.01, hs);
            }
            if (this._descPanel?.collision) {
                this._descPanel.collision.halfExtents = new pc.Vec3(this.panelWidth / 2 * s, 0.01, this.panelHeight / 2 * s);
            }
        } else {
            this._container.setLocalScale(1, 1, 1);
        }

        if (this.openByDistance) {
            const inRange = dist <= this.triggerDistance;
            if (inRange !== this._wasInRange) {
                this._wasInRange = inRange;
                if (inRange) this._showDescription();
                else this._hideDescription();
            }
        }
    }

    // ── Properties ──

    onPropertyChanged(name) {
        if (name === "icon" || name === "iconSize" || name === "billboard") {
            this._buildIcon().catch(console.error);
            if (this._descPanel) {
                // Rebuild desc too (billboard change) or reposition (iconSize change)
                if (name === "billboard") {
                    if (this._descVisible) this._buildDescription().catch(console.error);
                } else {
                    const yOffset = this.iconSize / 2 + this.panelHeight / 2 + 0.15;
                    this._descPanel.setLocalPosition(0, yOffset, 0);
                }
            }
            return;
        }

        if (name === "iconBackground" || name === "iconShowBackground" || name === "iconBorderColor" || name === "iconBorderWidth") {
            this._buildIcon().catch(console.error);
            return;
        }

        if (name === "backgroundColor" || name === "textColor" || name === "titleColor" || name === "linkColor") {
            if (this._descVisible) this._buildDescription().catch(console.error);
            return;
        }

        if (name === "description" || name === "panelWidth" || name === "panelHeight" || name === "showClose" || name === "showRotate") {
            if (this._descVisible) this._buildDescription().catch(console.error);
            return;
        }

        if (name === "castShadows") {
            if (this._iconPanel?.render) this._iconPanel.render.castShadows = this.castShadows;
            if (this._descPanel?.render) this._descPanel.render.castShadows = this.castShadows;
            return;
        }

        if (name === "alwaysOpen") {
            if (this.alwaysOpen) this._showDescription();
            else this._hideDescription();
            return;
        }

        if (name === "openByDistance") {
            this._wasInRange = false; // reset so next update re-evaluates
        }
    }

    // ── Cleanup ──

    destroy() {
        this._iconToken++;
        this._descToken++;
        if (this._descPanel) { this._descPanel.destroy(); this._descPanel = null; }
        if (this._iconPanel) { this._iconPanel.destroy(); this._iconPanel = null; }
        if (this._container) { this._container.destroy(); this._container = null; }
    }
}
