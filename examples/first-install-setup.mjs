/// <reference path="../types/arrival.d.ts" />
/**
 * First-Install Setup — demonstrates onInstall(ctx) + setParams() pre-configuration.
 *
 * onInstall() fires ONCE — right after a user adds this vibe to the space in-app
 * (library install, drag-drop, or upload). Here we pop a one-time setup panel where the
 * installer picks a greeting + accent colour, then write those straight into the vibe's
 * real editor parameters with this.setParams({...}).
 *
 * Why setParams() and not a side store: it persists to the entity's actual `params`, so
 * the values show up in the parameter panel, are applied automatically on every load
 * (PlayCanvas syncs them onto this.greeting / this.accent before initialize() runs), and
 * are seen by every visitor — exactly as if the user had typed them in the editor. No
 * separate load step needed.
 *
 * Requires ArrivalSpace.VERSION >= 1.12.0. Showcase: onInstall(), setParams(),
 * getUIContainer().
 */
export class FirstInstallSetup extends ArrivalScript {
    static scriptName = "firstInstallSetup";

    // Editor params. Saved values are applied onto these before initialize() runs, so
    // by the time we render they already hold the configured (or default) values.
    greeting = "Welcome!";
    accent = "#5ad1ff";

    static properties = {
        greeting: { title: "Greeting" },
        accent: { title: "Accent Colour" },
    };

    initialize() {
        // No config loading needed — params are already applied. Just render.
        this._renderBadge();
    }

    /**
     * Fired once, right after a user adds this vibe to the space in-app. It's tied to
     * that add action (not reload, not other visitors), so it's safe to show setup UI.
     */
    async onInstall(ctx) {
        console.log("[firstInstallSetup] added — opening setup panel", ctx);
        this._openSetupPanel();
    }

    // ── Persistent badge (everyone sees this) ───────────────────────────────────
    _renderBadge() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <div style="position:fixed;top:18px;left:18px;padding:10px 16px;border-radius:10px;
                    font-family:'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#06121a;
                    background:${this._esc(this.accent)};box-shadow:0 4px 18px rgba(0,0,0,.3);
                    pointer-events:none;user-select:none;">
            ${this._esc(this.greeting)}
        </div>`;
    }

    // ── One-time setup panel ────────────────────────────────────────────────────
    _openSetupPanel() {
        if (this._setupEl) return; // already open

        const el = document.createElement("div");
        el.style.cssText =
            "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
            "background:rgba(0,0,0,.55);font-family:'Segoe UI',sans-serif;";
        el.innerHTML = `
        <div style="width:340px;max-width:90vw;background:#0f1722;color:#eaf2ff;border-radius:14px;
                    padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);">
            <div style="font-size:18px;font-weight:700;margin-bottom:4px;">Set up your vibe</div>
            <div style="font-size:13px;opacity:.6;margin-bottom:18px;">This runs once, just for you.</div>

            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:6px;">Greeting</label>
            <input class="js-greeting" type="text" value="${this._esc(this.greeting)}"
                   style="width:100%;padding:9px 11px;border-radius:8px;border:1px solid #2a3850;
                          background:#0a1019;color:#eaf2ff;font-size:14px;margin-bottom:14px;outline:none;" />

            <label style="display:block;font-size:12px;opacity:.7;margin-bottom:6px;">Accent colour</label>
            <input class="js-accent" type="color" value="${this._esc(this.accent)}"
                   style="width:100%;height:38px;border-radius:8px;border:1px solid #2a3850;
                          background:#0a1019;cursor:pointer;margin-bottom:20px;" />

            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button class="js-skip" style="padding:9px 16px;border-radius:8px;border:1px solid #2a3850;
                        background:transparent;color:#9fb3cc;font-size:14px;cursor:pointer;">Skip</button>
                <button class="js-save" style="padding:9px 18px;border-radius:8px;border:none;
                        background:#5ad1ff;color:#06121a;font-weight:700;font-size:14px;cursor:pointer;">Save</button>
            </div>
        </div>`;

        const close = () => {
            el.remove();
            this._setupEl = null;
        };
        el.querySelector(".js-skip").addEventListener("click", close);
        el.querySelector(".js-save").addEventListener("click", async () => {
            const greeting = el.querySelector(".js-greeting").value.trim() || this.greeting;
            const accent = el.querySelector(".js-accent").value || this.accent;
            close();
            // Write to the real editor params — persists, shows in the panel, and every
            // visitor sees it. setParams() updates this.greeting / this.accent too.
            await this.setParams({ greeting, accent });
            this._renderBadge();
        });

        document.body.appendChild(el);
        this._setupEl = el;
    }

    onPropertyChanged() {
        // Fires for genuine editor edits (setParams() is silent), so just re-render.
        this._renderBadge();
    }

    _esc(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    destroy() {
        // getUIContainer() is auto-cleaned; just remove the setup modal if still open.
        if (this._setupEl) {
            this._setupEl.remove();
            this._setupEl = null;
        }
    }
}
