/**
 * Visibility Groups — toggle groups of scene content from one panel.
 *
 * Each group is a NAME + a CONTENT array. The array's entity-picker
 * (`filterTypes: ["all","folder"]`) lets you pick individual entities AND whole
 * content folders from a tree; a folder pick is stored as "folder:<id>".
 *
 * Toggling a group:
 *   - folders  → flip the native `hidden` flag in roomData.contentFolders and
 *     fire FOLDER_VISIBILITY_CHANGED (ephemeral; each content script recomputes
 *     its own visibility). Original hidden state is restored on destroy.
 *   - entities → set `entity.enabled`.
 *
 * Modes:
 *   - independent: targets are shown if ANY group containing them is on.
 *   - single select: only one configured group can be on at a time.
 */
export class VisibilityGroups extends ArrivalScript {
    static scriptName = "visibilityGroups";
    static FOLDER_PREFIX = "folder:";   // matches the editor picker's FOLDER_VALUE_PREFIX

    panelTitle = "Layers";
    showPanel = true;
    singleSelect = false;

    group1Name = "Group 1";
    group1Entities = [];
    group2Name = "Group 2";
    group2Entities = [];
    group3Name = "Group 3";
    group3Entities = [];
    group4Name = "";
    group4Entities = [];
    group5Name = "";
    group5Entities = [];

    static properties = (() => {
        const props = {
            panelTitle: { title: "Panel Title" },
            showPanel: { title: "Show Panel" },
            singleSelect: { title: "Only One Group At A Time" }
        };
        for (let i = 1; i <= 5; i++) {
            props[`group${i}Name`] = { title: `Group ${i} · Name` };
            props[`group${i}Entities`] = {
                title: `Group ${i} · Content`,
                editor: "entity",
                array: true,
                filterTypes: ["all", "folder"]   // pick entities and/or folders
            };
        }
        return props;
    })();

    initialize() {
        this._on = {};
        for (let i = 1; i <= 5; i++) this._on[i] = true;   // groups start visible unless single-select is enabled
        this._origHidden = {};                              // folderId -> hidden before we touched it
        if (this.singleSelect) this._enforceSingleSelection();
        this.log(`VisibilityGroups initialized (${this.singleSelect ? "single-select" : "independent"} mode).`);
        this._apply();
        this._render();
    }

    onPropertyChanged(name) {
        if (name === "singleSelect" && this.singleSelect) {
            this._enforceSingleSelection();
            this.log("Single-select mode enabled; keeping one group active.");
        }
        this._apply();
        this._render();
    }

    destroy() {
        this.unlockInput();
        this.removeUI();
        this._restoreFolders();
    }

    // --- groups & content ---
    _groups() {
        const out = [];
        for (let i = 1; i <= 5; i++) {
            const name = String(this[`group${i}Name`] || "").trim();
            const content = Array.isArray(this[`group${i}Entities`]) ? this[`group${i}Entities`] : [];
            if (name || content.length) out.push({ i, name: name || `Group ${i}`, content });
        }
        return out;
    }

    // Split a group's content array into plain entity ids and folder ids.
    _split(content) {
        const prefix = VisibilityGroups.FOLDER_PREFIX;
        const entities = [];
        const folders = [];
        for (const value of content) {
            const v = typeof value === "string" ? value.trim() : "";
            if (!v) continue;
            if (v.startsWith(prefix)) folders.push(v.slice(prefix.length));
            else entities.push(v);
        }
        return { entities, folders };
    }

    _findEntity(id) {
        const gateServer = this.app?.root?.findByName("GateServer")?.script?.gateServer;
        return gateServer?.getEntity?.(id) ?? null;
    }

    _fireFolderChange() {
        // Content scripts recompute their visibility on this event (the arg is ignored).
        this.app.fire(ReactUI.EVENT.FOLDER_VISIBILITY_CHANGED, null);
    }

    _enforceSingleSelection(preferredIndex = null) {
        const activeGroupIds = this._groups().map((g) => g.i);
        if (!activeGroupIds.length) return;

        let selected = Number(preferredIndex);
        if (!activeGroupIds.includes(selected)) {
            selected = activeGroupIds.find((i) => !!this._on[i]) ?? activeGroupIds[0];
        }

        for (let i = 1; i <= 5; i++) {
            this._on[i] = activeGroupIds.includes(i) && i === selected;
        }
    }

    // --- visibility ---
    _apply() {
        if (this.singleSelect) this._enforceSingleSelection();

        // Aggregate the desired state per target: shown if ANY of its groups is on.
        const entityShow = new Map();
        const folderShow = new Map();
        for (const g of this._groups()) {
            const on = !!this._on[g.i];
            const { entities, folders } = this._split(g.content);
            for (const id of entities) entityShow.set(id, (entityShow.get(id) || false) || on);
            for (const fid of folders) folderShow.set(fid, (folderShow.get(fid) || false) || on);
        }

        // Entities → enabled flag (own-flag only, reversible).
        for (const [id, show] of entityShow) {
            const entity = this._findEntity(id);
            if (entity) entity.enabled = show;
        }

        // Folders → native hidden flag, with a single recompute event.
        const folders = this.app?.customTravelCenter?.roomData?.contentFolders || [];
        const folderById = new Map(folders.map((f) => [f.id, f]));
        let changed = false;
        for (const [fid, show] of folderShow) {
            const folder = folderById.get(fid);
            if (!folder) continue;
            if (!(fid in this._origHidden)) this._origHidden[fid] = !!folder.hidden;
            if (!!folder.hidden !== !show) {
                folder.hidden = !show;
                changed = true;
            }
        }
        if (changed) this._fireFolderChange();
    }

    _restoreFolders() {
        const folders = this.app?.customTravelCenter?.roomData?.contentFolders || [];
        const folderById = new Map(folders.map((f) => [f.id, f]));
        let changed = false;
        for (const [fid, original] of Object.entries(this._origHidden)) {
            const folder = folderById.get(fid);
            if (folder && !!folder.hidden !== !!original) {
                folder.hidden = !!original;
                changed = true;
            }
        }
        if (changed) this._fireFolderChange();
    }

    // --- panel ---
    _render() {
        const ui = this.getUIContainer();
        if (!ui) return;
        if (!this.showPanel) { ui.innerHTML = ""; return; }

        const groups = this._groups();
        const buttons = groups
            .map((g) => `<button type="button" class="vg-btn ${this._on[g.i] ? "on" : ""}" data-g="${g.i}"><span class="vg-dot"></span>${this._esc(g.name)}</button>`)
            .join("");

        ui.innerHTML = `
            <style>
                /* Dark, minimal, purple-accent panel — Sony XYN (xyn.sony.net) aesthetic. */
                #vg, #vg * { box-sizing: border-box; }
                #vg { position: fixed; bottom: 18px; left: 18px; width: 224px; padding: 18px 16px 16px;
                    border-radius: 10px; z-index: 9999; pointer-events: auto;
                    background: #0d0a16; color: #f3f1fa; border: 1px solid rgba(255,255,255,0.09);
                    font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; font-size: 13px;
                    box-shadow: 0 16px 50px rgba(0,0,0,0.55); backdrop-filter: blur(10px); }
                #vg h3 { margin: 0 0 14px; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: #f3f1fa; }
                #vg .vg-btn { display: flex; align-items: center; gap: 11px; width: 100%; margin-bottom: 8px;
                    padding: 11px 13px; border-radius: 7px; cursor: pointer; font: inherit; font-weight: 600;
                    text-align: left; color: #c7c2d6; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
                    transition: background .15s ease, border-color .15s ease, color .15s ease; }
                #vg .vg-btn:last-child { margin-bottom: 0; }
                #vg .vg-btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(167,139,255,0.5); color: #ffffff; }
                #vg .vg-btn.on { color: #ffffff; background: #7a5af8; border-color: #7a5af8; }
                #vg .vg-btn.on:hover { background: #8b6dff; border-color: #8b6dff; }
                #vg .vg-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: rgba(255,255,255,0.25); }
                #vg .vg-btn.on .vg-dot { background: #ffffff; }
                #vg .vg-empty { font-size: 12px; color: rgba(243,241,250,0.5); }
            </style>
            <div id="vg">
                <h3>${this._esc(this.panelTitle || "Layers")}</h3>
                ${groups.length ? buttons : `<div class="vg-empty">No groups configured yet.</div>`}
            </div>
        `;

        ui.onclick = (event) => {
            const btn = event.target?.closest?.("[data-g]");
            if (!btn) return;
            const i = Number(btn.getAttribute("data-g"));

            if (this.singleSelect) {
                this._enforceSingleSelection(i);
                this.log(`Selected group ${i}; all other groups disabled.`);
            } else {
                this._on[i] = !this._on[i];
                this.log(`Group ${i} ${this._on[i] ? "enabled" : "disabled"}.`);
            }

            this._apply();
            this._render();
        };
        ui.onmouseenter = () => this.lockInput();
        ui.onmouseleave = () => this.unlockInput();
    }

    _esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }
}
