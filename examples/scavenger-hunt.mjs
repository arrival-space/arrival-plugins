/**
 * Scavenger Hunt — Controller plugin.
 *
 * Place this once in a scene alongside one or more "Scavenger Item" entities.
 * The controller automatically discovers items, tracks collection via
 * proximity, and shows a progress HUD + finish overlay.
 *
 * Features demonstrated:
 * - Plugin event bus (ArrivalSpace.on / ArrivalSpace.off)
 * - Inter-plugin discovery (ArrivalSpace.getPlugins)
 * - Proximity detection (ArrivalSpace.getPlayer)
 * - HUD overlay (getUIContainer)
 * - Cross-plugin method calls (item.collect / item.reset)
 */
export class ScavengerHunt extends ArrivalScript {
    static scriptName = "Scavenger Hunt";

    showHud = true;
    autoReset = true;
    resetDelay = 3;

    static properties = {
        showHud: { title: "Show HUD" },
        autoReset: { title: "Auto Reset" },
        resetDelay: { title: "Reset Delay (s)", min: 1, max: 30, step: 1 },
    };

    _items = [];
    _score = 0;
    _totalPoints = 0;
    _gameComplete = false;
    _resetTimer = 0;
    _startTime = 0;

    initialize() {
        this._items = [];
        this._score = 0;
        this._gameComplete = false;
        this._startTime = Date.now();

        // Listen for items that load after us
        this._onItemReady = (item) => this._registerItem(item);
        this._onItemRemoved = (item) => this._unregisterItem(item);
        ArrivalSpace.on("scavenger:item:ready", this._onItemReady);
        ArrivalSpace.on("scavenger:item:removed", this._onItemRemoved);

        // Discover items already in the scene
        this._discoverExistingItems();

        // Build UI
        this._buildUI();
        this._updateProgressHud();
    }

    update(dt) {
        if (this._gameComplete) {
            if (this.autoReset) {
                this._resetTimer -= dt;
                this._updateFinishCountdown();
                if (this._resetTimer <= 0) {
                    this._resetGame();
                }
            }
            return;
        }

        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        const playerPos = player.getPosition();

        for (const item of this._items) {
            if (item.collected) continue;

            const dist = playerPos.distance(item.position);
            if (dist < item.collectDistance) {
                item.collect();
                this._score += item.points;
                this._updateProgressHud();

                if (this._allCollected()) {
                    this._onAllCollected();
                }
            }
        }
    }

    // ── Item management ──

    _discoverExistingItems() {
        const plugins = ArrivalSpace.getPlugins();
        for (const p of plugins) {
            if (p.name !== "Scavenger Item") continue;
            const script = this._resolveScript(p.entity);
            if (script) this._registerItem(script);
        }
    }

    _resolveScript(umeEntity) {
        for (const child of umeEntity.children) {
            if (!child.name?.startsWith("Plugin_")) continue;
            const scripts = child.script?.scripts;
            if (scripts && scripts.length > 0) return scripts[0];
        }
        return null;
    }

    _registerItem(item) {
        if (this._items.includes(item)) return;
        this._items.push(item);
        this._totalPoints = this._items.reduce((s, i) => s + i.points, 0);
        this._updateProgressHud();
    }

    _unregisterItem(item) {
        const idx = this._items.indexOf(item);
        if (idx >= 0) {
            this._items.splice(idx, 1);
            this._totalPoints = this._items.reduce((s, i) => s + i.points, 0);
            this._updateProgressHud();
        }
    }

    _allCollected() {
        return this._items.length > 0 && this._items.every((i) => i.collected);
    }

    // ── Game flow ──

    _onAllCollected() {
        this._gameComplete = true;
        this._resetTimer = this.resetDelay;
        this._showFinishOverlay();

        const elapsed = (Date.now() - this._startTime) / 1000;
        ArrivalSpace.fire("scavenger:complete", {
            score: this._score,
            time: elapsed,
            items: this._items.length,
        });
    }

    _resetGame() {
        this._gameComplete = false;
        this._score = 0;
        this._startTime = Date.now();
        for (const item of this._items) {
            item.reset();
        }
        this._hideFinishOverlay();
        this._updateProgressHud();
    }

    // ── UI ──

    _buildUI() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
            #sh-progress {
                position: fixed; top: 16px; left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(6px);
                color: #fff; padding: 10px 24px;
                border-radius: 8px; font-family: sans-serif;
                font-size: 16px; pointer-events: none;
                user-select: none; z-index: 100;
            }

            #sh-finish {
                display: none;
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(8px);
                z-index: 200;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: sans-serif;
                color: #fff;
                user-select: none;
            }
            #sh-finish.visible { display: flex; }
            #sh-finish-title {
                font-size: 36px; font-weight: bold;
                margin-bottom: 12px;
                color: #4ade80;
            }
            #sh-finish-stats {
                font-size: 18px; opacity: 0.8;
                margin-bottom: 8px;
            }
            #sh-finish-countdown {
                font-size: 14px; opacity: 0.5;
                margin-top: 12px;
            }
            #sh-finish-btn {
                margin-top: 20px;
                padding: 10px 28px;
                font-size: 16px;
                border: none; border-radius: 6px;
                background: #4ade80; color: #000;
                font-weight: bold; cursor: pointer;
                pointer-events: auto;
            }
            #sh-finish-btn:hover { background: #22c55e; }
        </style>

        <div id="sh-progress">
            <span class="js-progress"></span>
        </div>

        <div id="sh-finish">
            <div id="sh-finish-title">You found them all!</div>
            <div id="sh-finish-stats" class="js-finish-stats"></div>
            <button id="sh-finish-btn" class="js-finish-btn">Play Again</button>
            <div id="sh-finish-countdown" class="js-finish-countdown"></div>
        </div>`;

        const btn = ui.querySelector(".js-finish-btn");
        if (btn) {
            btn.addEventListener("click", () => this._resetGame());
        }
    }

    _updateProgressHud() {
        const el = this._uiContainer?.querySelector(".js-progress");
        if (!el) return;

        const collected = this._items.filter((i) => i.collected).length;
        const total = this._items.length;

        if (total === 0) {
            el.textContent = "No items found";
        } else {
            el.textContent = `${collected} / ${total} collected`;
        }

        const hud = this._uiContainer?.querySelector("#sh-progress");
        if (hud) hud.style.display = this.showHud ? "" : "none";
    }

    _showFinishOverlay() {
        const overlay = this._uiContainer?.querySelector("#sh-finish");
        if (overlay) overlay.classList.add("visible");

        const stats = this._uiContainer?.querySelector(".js-finish-stats");
        if (stats) {
            const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
            stats.textContent = `${this._score} points \u00b7 ${elapsed}s`;
        }

        this._updateFinishCountdown();
    }

    _hideFinishOverlay() {
        const overlay = this._uiContainer?.querySelector("#sh-finish");
        if (overlay) overlay.classList.remove("visible");
    }

    _updateFinishCountdown() {
        const el = this._uiContainer?.querySelector(".js-finish-countdown");
        if (!el) return;

        if (this.autoReset && this._gameComplete) {
            el.textContent = `Resetting in ${Math.ceil(this._resetTimer)}s...`;
        } else {
            el.textContent = "";
        }
    }

    // ── Property changes ──

    onPropertyChanged(name) {
        if (name === "showHud") {
            this._updateProgressHud();
        }
    }

    // ── Cleanup ──

    destroy() {
        if (this._onItemReady) ArrivalSpace.off("scavenger:item:ready", this._onItemReady);
        if (this._onItemRemoved) ArrivalSpace.off("scavenger:item:removed", this._onItemRemoved);
    }
}
