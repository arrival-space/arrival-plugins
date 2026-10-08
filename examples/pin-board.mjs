/**
 * Pin Board — space files (ArrivalSpace.fs) for editors AND visitors.
 *
 * Editors write the board's headline and intro into a shared file of the space.
 * Visitors pin one note each into their own home folder (fs.homedir()) — that
 * needs the space setting `allowVisitorFiles: true` (room.json data).
 * Everyone sees every note; the board refreshes when anyone saves.
 *
 * Features demonstrated:
 * - ArrivalSpace.fs: readFile / writeFile / readdir / watch, like Node's fs/promises
 * - the ENOENT "nothing saved yet" pattern
 * - editor data in the space root vs. visitor data in fs.homedir()
 * - ArrivalSpace.canEditSpace() to show editor-only controls
 *
 * Requires ArrivalSpace.VERSION >= 1.17.0.
 */
export class PinBoard extends ArrivalScript {
    static scriptName = "Pin Board";

    folder = "pin-board";
    panelWidth = 1.6;
    panelHeight = 2.0;
    offsetY = 1.5;

    static properties = {
        folder: { title: "Data Folder" },
        panelWidth: { title: "Panel Width", min: 0.5, max: 5 },
        panelHeight: { title: "Panel Height", min: 0.5, max: 5 },
        offsetY: { title: "Vertical Offset", min: -5, max: 10 },
    };

    _panel = null;
    _watchers = [];
    _board = { headline: "Pin Board", intro: "Leave a note for the next visitor." };
    _notes = [];

    async initialize() {
        if (!ArrivalSpace.fs) {
            this.warn("Pin Board needs ArrivalSpace.VERSION >= 1.17.0 (space files)");
            return;
        }
        this._buildPanel();
        await this._load();

        // Refresh when an editor changes the board or any visitor pins a note.
        this._watchers.push(ArrivalSpace.fs.watch(this._boardPath(), () => this._load()));
        this._watchers.push(ArrivalSpace.fs.watch("visitors", (type, name) => {
            if (name.endsWith(this._noteFileName())) this._load();
        }));
    }

    onPropertyChanged(name) {
        if (name === "folder") {
            this.destroy();
            this.initialize();
        } else if (this._panel) {
            this._buildPanel();
            this._render();
        }
    }

    destroy() {
        for (const w of this._watchers) w.close();
        this._watchers = [];
        this._panel?.destroy();
        this._panel = null;
    }

    // -- Paths --

    /** Editor data: a shared file in the space (only editors can write it). */
    _boardPath() {
        return `${this.folder}/board.json`;
    }

    /** One note per visitor, in their own home folder: visitors/<userId>/<folder>.json */
    _noteFileName() {
        return `${this.folder}.json`;
    }

    // -- Data --

    async _readJSON(path, fallback) {
        try {
            return JSON.parse(await ArrivalSpace.fs.readFile(path, "utf8"));
        } catch (e) {
            if (e.code === "ENOENT") return fallback;
            throw e;
        }
    }

    async _load() {
        this._board = await this._readJSON(this._boardPath(), this._board);

        let visitorIds = [];
        try {
            visitorIds = await ArrivalSpace.fs.readdir("visitors");
        } catch (e) {
            if (e.code !== "ENOENT") throw e;
        }
        const notes = await Promise.all(visitorIds.map((id) =>
            this._readJSON(`visitors/${id}/${this._noteFileName()}`, null)));
        this._notes = notes.filter(Boolean).sort((a, b) => b.time - a.time);
        this._render();
    }

    async _saveBoard(headline, intro) {
        await ArrivalSpace.fs.writeFile(this._boardPath(), JSON.stringify({ headline, intro }));
    }

    async _pinNote(text) {
        const user = ArrivalSpace.getUser();
        const note = { name: user?.userName || "Visitor", text, time: Date.now() };
        await ArrivalSpace.fs.writeFile(`${ArrivalSpace.fs.homedir()}/${this._noteFileName()}`, JSON.stringify(note));
    }

    // -- UI --

    _buildPanel() {
        this._panel?.destroy();
        this._panel = ArrivalSpace.createHTMLPanel({
            position: { x: 0, y: 0, z: 0 },
            width: this.panelWidth,
            height: this.panelHeight,
            html: this._html(),
            backgroundColor: "#1c1917",
            interactive: true,
        });
        if (!this._panel) return;
        this._panel.reparent(this.entity);
        this._panel.setLocalPosition(0, this.offsetY, 0);
        this._panel.setLocalEulerAngles(90, 0, 0);
        this._bindEvents();
    }

    _html() {
        const editor = ArrivalSpace.canEditSpace();
        return `
        <div style="font-family:sans-serif;color:#fafaf9;padding:16px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px">
            <div id="pbHeadline" style="font-size:26px;font-weight:700"></div>
            <div id="pbIntro" style="font-size:15px;opacity:.8"></div>
            ${editor ? `
            <div style="display:flex;flex-direction:column;gap:6px;border:1px dashed #78716c;padding:8px">
                <input id="pbEditHeadline" placeholder="Headline" style="font-size:14px">
                <input id="pbEditIntro" placeholder="Intro" style="font-size:14px">
                <button id="pbSaveBoard">Save board (editors)</button>
            </div>` : ""}
            <div style="display:flex;gap:6px">
                <input id="pbNote" maxlength="140" placeholder="Your note" style="flex:1;font-size:14px">
                <button id="pbPin">Pin</button>
            </div>
            <div id="pbStatus" style="font-size:12px;opacity:.7;min-height:14px"></div>
            <div id="pbNotes" style="flex:1;overflow:auto;display:flex;flex-direction:column;gap:6px"></div>
        </div>`;
    }

    _el(id) {
        return this._panel?._iframePlane?.htmlElement?.querySelector("#" + id) || null;
    }

    _bindEvents() {
        const status = (text) => { const s = this._el("pbStatus"); if (s) s.textContent = text; };
        const explain = (e) => e.code === "EACCES"
            ? "Saving notes isn't possible here (log in, and the space must allow visitor files)."
            : `Could not save: ${e.message}`;

        const pin = this._el("pbPin");
        if (pin) pin.onclick = async () => {
            const text = this._el("pbNote")?.value.trim();
            if (!text) return;
            status("Saving…");
            try {
                await this._pinNote(text);
                this._el("pbNote").value = "";
                status("Pinned!");
            } catch (e) {
                status(explain(e));
            }
        };

        const save = this._el("pbSaveBoard");
        if (save) save.onclick = async () => {
            status("Saving…");
            try {
                await this._saveBoard(this._el("pbEditHeadline").value, this._el("pbEditIntro").value);
                status("Board saved.");
            } catch (e) {
                status(explain(e));
            }
        };
    }

    _render() {
        const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const headline = this._el("pbHeadline");
        if (!headline) return;
        headline.textContent = this._board.headline;
        this._el("pbIntro").textContent = this._board.intro;
        const editHeadline = this._el("pbEditHeadline");
        if (editHeadline && document.activeElement !== editHeadline) editHeadline.value = this._board.headline;
        const editIntro = this._el("pbEditIntro");
        if (editIntro && document.activeElement !== editIntro) editIntro.value = this._board.intro;
        this._el("pbNotes").innerHTML = this._notes.length
            ? this._notes.map((n) => `<div style="background:#fef08a;color:#1c1917;padding:6px 8px">
                <b>${esc(n.name)}</b>: ${esc(n.text)}</div>`).join("")
            : `<div style="opacity:.6">No notes yet.</div>`;
    }
}
