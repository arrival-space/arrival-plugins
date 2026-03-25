/**
 * Vibes Challenge — Multiplayer co-op controller.
 *
 * Place this once in a scene alongside "Scavenger Item" collectibles
 * and a "Scavenger Start Trigger". One player starts the game,
 * becoming the host. All players on boards can collect letters.
 * Game state is synced via network messages (host authority).
 *
 * A separate "Vibes Challenge Status" plugin displays the 3D
 * timer and letter progress panel — place it wherever you like.
 */
export class ScavengerHunt extends ArrivalScript {
    static scriptName = "Scavenger Hunt";

    autoReset = true;
    resetDelay = 5;
    challengeWord = "VIBES";
    duration = 1800;
    storeKey = "vibes-best-time";

    static properties = {
        autoReset: { title: "Auto Reset" },
        resetDelay: { title: "Reset Delay (s)", min: 1, max: 30, step: 1 },
        challengeWord: { title: "Challenge Word" },
        duration: { title: "Duration (s)", min: 10, max: 3600, step: 5 },
        storeKey: { title: "Leaderboard Key" },
    };

    _items = [];
    _started = false;
    _gameComplete = false;
    _resetTimer = 0;
    _timeRemaining = 0;
    _slots = []; // { letter, filled, collectedBy }
    _participants = {}; // { [userId]: { userName, letters: [] } }
    _isHost = false;
    _hostUserId = null;
    _stateInterval = null;
    _networkUnsubs = [];
    _finishTime = 0;
    _lastHostHeartbeat = 0;

    initialize() {
        this._items = [];
        this._started = false;
        this._gameComplete = false;
        this._isHost = false;
        this._hostUserId = null;
        this._participants = {};

        // Item discovery
        this._onItemReady = (item) => this._registerItem(item);
        this._onItemRemoved = (item) => this._unregisterItem(item);
        ArrivalSpace.on("scavenger:item:ready", this._onItemReady);
        ArrivalSpace.on("scavenger:item:removed", this._onItemRemoved);
        this._discoverExistingItems();

        // Local start trigger
        this._onLocalStart = (data) => this._hostStartGame(data);
        ArrivalSpace.on("scavenger:start", this._onLocalStart);

        // Network messages
        this._sub("vibes:start", (data) => this._onNetStart(data));
        this._sub("vibes:collect-request", (data, sender) => this._onNetCollectRequest(data, sender));
        this._sub("vibes:collect-confirm", (data) => this._onNetCollectConfirm(data));
        this._sub("vibes:state", (data) => this._onNetState(data));
        this._sub("vibes:end", (data) => this._onNetEnd(data));
        this._sub("vibes:reset", () => this._onNetReset());

        // Player join/leave
        const unJoin = ArrivalSpace.net.onPlayerJoin((player) => {
            if (this._isHost && this._started) {
                ArrivalSpace.net.sendTo(player.userID, "vibes:state", this._buildStatePayload());
            }
        });
        const unLeave = ArrivalSpace.net.onPlayerLeave((player) => {
            if (player.userID === this._hostUserId && !this._isHost) {
                this._onHostDisconnected();
            }
        });
        this._networkUnsubs.push(unJoin, unLeave);

        // Build finish overlay HUD
        this._buildUI();
    }

    _sub(type, callback) {
        const unsub = ArrivalSpace.net.on(type, callback);
        this._networkUnsubs.push(unsub);
    }

    update(dt) {
        if (!this._started) return;

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

        // Host: run timer
        if (this._isHost) {
            this._timeRemaining -= dt;
            if (this._timeRemaining <= 0) {
                this._timeRemaining = 0;
                this._onTimeout();
                return;
            }
        } else {
            // Non-host: interpolate timer locally
            this._timeRemaining -= dt;
            if (this._timeRemaining < 0) this._timeRemaining = 0;
        }

        // Non-host: if no host message in 6s, assume host is gone
        if (!this._isHost && this._lastHostHeartbeat > 0) {
            const silence = Date.now() - this._lastHostHeartbeat;
            if (silence > 6000) {
                this._lastHostHeartbeat = 0; // prevent re-triggering
                this._onHostDisconnected();
                if (this._isHost) return; // we just became host, let next frame settle
            }
        }

        // All clients: check local player proximity
        this._checkProximity();

        // Fire state update for status panel
        this._fireStateUpdated();
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
    }

    _unregisterItem(item) {
        const idx = this._items.indexOf(item);
        if (idx >= 0) this._items.splice(idx, 1);
    }

    // ── Slot logic ──

    _buildSlots() {
        this._slots = [...this.challengeWord.toUpperCase()].map((letter) => ({
            letter,
            filled: false,
            collectedBy: null,
        }));
    }

    _tryFillSlot(letter, userName) {
        if (!letter) return -1;
        const upper = letter.toUpperCase();
        const idx = this._slots.findIndex((s) => s.letter === upper && !s.filled);
        if (idx >= 0) {
            this._slots[idx].filled = true;
            this._slots[idx].collectedBy = userName;
        }
        return idx;
    }

    _allSlotsFilled() {
        return this._slots.length > 0 && this._slots.every((s) => s.filled);
    }

    _resetSlots() {
        this._slots = [];
    }

    _filledCount() {
        return this._slots.filter((s) => s.filled).length;
    }

    // ── Proximity check ──

    _checkProximity() {
        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        const playerPos = player.getPosition();

        for (const item of this._items) {
            if (item.collected) continue;
            const dist = playerPos.distance(item.position);
            if (dist < item.collectDistance) {
                const letter = item.letter?.toUpperCase();
                if (!letter) continue;

                // Check if slot is available locally (optimistic)
                const slotAvailable = this._slots.some((s) => s.letter === letter && !s.filled);
                if (!slotAvailable) continue;

                if (this._isHost) {
                    this._hostProcessCollect(letter, item);
                } else {
                    // Send request to host
                    ArrivalSpace.net.send("vibes:collect-request", { letter });
                    // Optimistic: mark locally to avoid re-sending
                    item.collect();
                }
            }
        }
    }

    // ── Host game logic ──

    _hostStartGame() {
        if (this._started) return;

        const user = ArrivalSpace.getUser?.();
        this._isHost = true;
        this._hostUserId = user?.userID;
        this._lastHostHeartbeat = 0;
        this._started = true;
        this._gameComplete = false;
        this._timeRemaining = this.duration;
        this._participants = {};
        this._buildSlots();

        // Show items
        for (const item of this._items) item.reset();

        // Broadcast start
        ArrivalSpace.net.send("vibes:start", {
            hostUserId: this._hostUserId,
            challengeWord: this.challengeWord,
            duration: this.duration,
        });

        // Periodic state broadcast
        this._startStateBroadcast();
        this._fireStateUpdated();
    }

    _hostProcessCollect(letter, item) {
        const user = ArrivalSpace.getUser?.();
        const userId = user?.userID;
        const userName = user?.userName || "Unknown";
        this._processCollect(letter, userId, userName, item);
    }

    _processCollect(letter, userId, userName, item) {
        const slotIndex = this._tryFillSlot(letter, userName);
        if (slotIndex < 0) return; // no slot available

        // Add participant
        if (!this._participants[userId]) {
            this._participants[userId] = { userName, letters: [] };
        }
        this._participants[userId].letters.push(letter);

        // Collect the item
        if (item) item.collect();

        // Broadcast confirmation
        ArrivalSpace.net.send("vibes:collect-confirm", {
            letter,
            userId,
            userName,
            slotIndex,
        });

        this._fireStateUpdated();

        // Check win
        if (this._allSlotsFilled()) {
            this._onAllCollected();
        }
    }

    _onAllCollected() {
        this._gameComplete = true;
        this._resetTimer = this.resetDelay;
        this._finishTime = this.duration - this._timeRemaining;

        const score = this._computeScore(this._filledCount(), this._finishTime);
        const endData = {
            score,
            allCollected: true,
            timeTaken: this._finishTime,
            filledCount: this._filledCount(),
            participants: this._participants,
            slots: this._slots,
        };

        ArrivalSpace.net.send("vibes:end", endData);
        this._onGameEnd(endData);
    }

    _onTimeout() {
        this._gameComplete = true;
        this._resetTimer = this.resetDelay;
        this._finishTime = this.duration;

        const score = this._computeScore(this._filledCount(), this._finishTime);
        const endData = {
            score,
            allCollected: false,
            timeTaken: this.duration,
            filledCount: this._filledCount(),
            participants: this._participants,
            slots: this._slots,
        };

        ArrivalSpace.net.send("vibes:end", endData);
        this._onGameEnd(endData);
    }

    _computeScore(filledCount, timeTaken) {
        return filledCount * 10000 - timeTaken;
    }

    // ── Network handlers ──

    _onNetStart(data) {
        if (this._started) return;
        this._lastHostHeartbeat = Date.now();
        this._isHost = false;
        this._hostUserId = data.hostUserId;
        this._started = true;
        this._gameComplete = false;
        this._timeRemaining = data.duration;
        this._participants = {};

        // Use host's challenge word
        this._slots = [...data.challengeWord.toUpperCase()].map((letter) => ({
            letter,
            filled: false,
            collectedBy: null,
        }));

        // Show items
        ArrivalSpace.fire("scavenger:start");
        for (const item of this._items) item.reset();

        this._fireStateUpdated();
    }

    _onNetCollectRequest(data, sender) {
        if (!this._isHost || this._gameComplete) return;

        const letter = data.letter?.toUpperCase();
        if (!letter) return;

        // Find a matching uncollected item
        const item = this._items.find(
            (i) => !i.collected && i.letter?.toUpperCase() === letter
        );
        if (item) item.collect();

        this._processCollect(letter, sender.userID, sender.userName, null);
    }

    _onNetCollectConfirm(data) {
        this._lastHostHeartbeat = Date.now();
        if (this._isHost) return; // host already processed

        const { letter, userId, userName, slotIndex } = data;

        // Update slot
        if (slotIndex >= 0 && slotIndex < this._slots.length) {
            this._slots[slotIndex].filled = true;
            this._slots[slotIndex].collectedBy = userName;
        }

        // Add participant
        if (!this._participants[userId]) {
            this._participants[userId] = { userName, letters: [] };
        }
        this._participants[userId].letters.push(letter);

        // Hide the item
        const item = this._items.find(
            (i) => !i.collected && i.letter?.toUpperCase() === letter?.toUpperCase()
        );
        if (item) item.collect();

        this._fireStateUpdated();
    }

    _onNetState(data) {
        this._lastHostHeartbeat = Date.now();

        // If another client became host (migration), step down
        if (this._isHost && data.hostUserId !== this._hostUserId) {
            this._isHost = false;
            this._stopStateBroadcast();
        }
        if (this._isHost) return;
        this._hostUserId = data.hostUserId;
        this._started = data.started;
        this._gameComplete = data.gameComplete;
        this._timeRemaining = data.timeRemaining;
        this._slots = data.slots;
        this._participants = data.participants;

        // Sync item visuals
        for (const item of this._items) {
            const letter = item.letter?.toUpperCase();
            const slotFilled = this._slots.some(
                (s) => s.letter === letter && s.filled
            );
            if (slotFilled && !item.collected) item.collect();
            if (!slotFilled && item.collected) item.reset();
        }

        this._fireStateUpdated();
    }

    _onNetEnd(data) {
        if (this._isHost) return;
        this._gameComplete = true;
        this._resetTimer = this.resetDelay;
        this._slots = data.slots || this._slots;
        this._participants = data.participants || this._participants;
        this._onGameEnd(data);
    }

    _onNetReset() {
        if (this._isHost) return;
        this._doReset();
    }

    _onHostDisconnected() {
        if (!this._started || this._gameComplete) return;

        const deadHostId = this._hostUserId;

        // Deterministic election: lowest userID among remaining players becomes host.
        // Explicitly exclude the dead host in case getPlayers() hasn't been pruned yet.
        const me = ArrivalSpace.getUser?.();
        if (!me?.userID) return;
        const players = ArrivalSpace.net.getPlayers();
        const ids = players
            .map((p) => p.userID)
            .filter((id) => id && id !== deadHostId);
        if (!ids.includes(me.userID)) ids.push(me.userID);
        ids.sort();

        if (ids[0] === me.userID) {
            // This client becomes the new host
            this._isHost = true;
            this._hostUserId = me.userID;
            this._startStateBroadcast();
            // Immediately broadcast so other clients learn the new host
            ArrivalSpace.net.send("vibes:state", this._buildStatePayload());
        }
        // Non-elected clients keep running with their local state;
        // the new host's next broadcast will re-sync everyone.
    }

    // ── Game end (all clients) ──

    _onGameEnd(data) {
        this._showFinishOverlay(data);
        this._saveScore(data);
        this._fireStateUpdated();
    }

    async _saveScore(data) {
        if (!this._isHost || !this.storeKey || !data.filledCount) return;
        const slots = (data.slots || []).map((s) => ({
            letter: s.letter,
            filled: s.filled,
            by: s.collectedBy || null,
        }));
        const names = Object.values(data.participants)
            .map((p) => p.userName)
            .join(", ");
        const value = JSON.stringify({ names, slots });
        await ArrivalSpace.pluginStore.push(this.storeKey, value, {
            numval: data.score,
            mode: "max",
        });
        ArrivalSpace.fire("scavenger:leaderboard:updated");
        this._showFinishRanking();
    }

    // ── Reset ──

    _resetGame() {
        if (this._isHost) {
            ArrivalSpace.net.send("vibes:reset", {});
        }
        this._doReset();
    }

    _doReset() {
        this._gameComplete = false;
        this._started = false;
        this._isHost = false;
        this._hostUserId = null;
        this._participants = {};
        this._resetSlots();
        this._stopStateBroadcast();

        for (const item of this._items) item.reset();

        this._hideFinishOverlay();
        ArrivalSpace.fire("vibes:game-reset");
        ArrivalSpace.fire("scavenger:reset");
        this._fireStateUpdated();
    }

    // ── State broadcast ──

    _startStateBroadcast() {
        this._stopStateBroadcast();
        this._stateInterval = setInterval(() => {
            if (this._isHost && this._started) {
                ArrivalSpace.net.send("vibes:state", this._buildStatePayload());
            }
        }, 2000);
    }

    _stopStateBroadcast() {
        if (this._stateInterval) {
            clearInterval(this._stateInterval);
            this._stateInterval = null;
        }
    }

    _buildStatePayload() {
        return {
            hostUserId: this._hostUserId,
            started: this._started,
            gameComplete: this._gameComplete,
            timeRemaining: this._timeRemaining,
            slots: this._slots,
            participants: this._participants,
        };
    }

    // ── Local event for status panel ──

    _fireStateUpdated() {
        ArrivalSpace.fire("vibes:state-updated", {
            started: this._started,
            gameComplete: this._gameComplete,
            timeRemaining: this._timeRemaining,
            duration: this.duration,
            slots: this._slots,
            participants: this._participants,
            allCollected: this._allSlotsFilled(),
            challengeWord: this.challengeWord,
        });
    }

    // ── UI (finish overlay only) ──

    _buildUI() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
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
                color: #f5c542;
            }
            #sh-finish-stats {
                font-size: 18px; opacity: 0.8;
                margin-bottom: 4px;
            }
            #sh-finish-players {
                font-size: 14px; opacity: 0.6;
                margin-bottom: 8px;
            }
            #sh-finish-slots {
                display: flex; gap: 8px;
                margin-bottom: 16px;
            }
            .sh-finish-slot {
                width: 44px; height: 52px;
                background: rgba(0,0,0,0.5);
                border: 2px solid rgba(255,255,255,0.15);
                border-radius: 6px;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                font-family: sans-serif;
            }
            .sh-finish-slot .letter {
                font-size: 24px; font-weight: bold;
                color: rgba(255,255,255,0.2);
            }
            .sh-finish-slot.filled .letter {
                color: #f5c542;
            }
            .sh-finish-slot .who {
                font-size: 8px; opacity: 0.5;
                max-width: 40px;
                overflow: hidden; text-overflow: ellipsis;
                white-space: nowrap;
            }
            #sh-finish-countdown {
                font-size: 14px; opacity: 0.5;
                margin-top: 12px;
            }
            #sh-finish-btn {
                margin-top: 16px;
                padding: 10px 28px;
                font-size: 16px;
                border: none; border-radius: 6px;
                background: #f5c542; color: #000;
                font-weight: bold; cursor: pointer;
                pointer-events: auto;
            }
            #sh-finish-btn:hover { background: #d4a830; }
            #sh-finish-ranking {
                margin-top: 16px;
                width: 320px;
                max-height: 200px;
                overflow-y: auto;
            }
            .sh-rank-row {
                display: flex; align-items: center;
                padding: 5px 10px; margin-bottom: 3px;
                border-radius: 6px;
                font-size: 14px;
                font-family: sans-serif;
            }
            .sh-rank-row.top3 {
                background: rgba(245,197,66,0.1);
                color: #f5c542;
                font-weight: bold;
            }
            .sh-rank-row.me {
                border: 1px solid rgba(245,197,66,0.4);
            }
            .sh-rank-pos { width: 30px; text-align: center; flex-shrink: 0; }
            .sh-rank-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sh-rank-time { flex-shrink: 0; margin-left: 8px; }
        </style>

        <div id="sh-finish">
            <div id="sh-finish-title"></div>
            <div id="sh-finish-stats"></div>
            <div id="sh-finish-players"></div>
            <div id="sh-finish-slots"></div>
            <div id="sh-finish-ranking"></div>
            <button id="sh-finish-btn" class="js-finish-btn">Play Again</button>
            <div id="sh-finish-countdown" class="js-finish-countdown"></div>
        </div>`;

        const btn = ui.querySelector(".js-finish-btn");
        if (btn) {
            btn.addEventListener("click", () => this._resetGame());
        }
    }

    _showFinishOverlay(data) {
        const overlay = this._uiContainer?.querySelector("#sh-finish");
        if (overlay) overlay.classList.add("visible");

        // Title
        const title = this._uiContainer?.querySelector("#sh-finish-title");
        if (title) {
            title.textContent = data.allCollected
                ? "Challenge Complete!"
                : `Time's Up! (${data.filledCount}/${this._slots.length})`;
        }

        // Stats
        const stats = this._uiContainer?.querySelector("#sh-finish-stats");
        if (stats) {
            const time = data.timeTaken?.toFixed(1) || "0";
            stats.textContent = data.allCollected
                ? `Completed in ${time}s`
                : `${data.filledCount} letters collected`;
        }

        // Players
        const players = this._uiContainer?.querySelector("#sh-finish-players");
        if (players) {
            const names = Object.values(data.participants || {})
                .map((p) => p.userName)
                .join(", ");
            players.textContent = names ? `Players: ${names}` : "";
        }

        // Slots with who collected
        const slotsEl = this._uiContainer?.querySelector("#sh-finish-slots");
        if (slotsEl) {
            slotsEl.innerHTML = "";
            for (const slot of data.slots || this._slots) {
                const div = document.createElement("div");
                div.className = "sh-finish-slot" + (slot.filled ? " filled" : "");
                const l = document.createElement("div");
                l.className = "letter";
                l.textContent = slot.letter;
                div.appendChild(l);
                if (slot.collectedBy) {
                    const w = document.createElement("div");
                    w.className = "who";
                    w.textContent = slot.collectedBy;
                    div.appendChild(w);
                }
                slotsEl.appendChild(div);
            }
        }

        // Show/hide play again button (host only)
        const btn = this._uiContainer?.querySelector("#sh-finish-btn");
        if (btn) btn.style.display = this._isHost ? "" : "none";

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

    async _showFinishRanking() {
        const container = this._uiContainer?.querySelector("#sh-finish-ranking");
        if (!container || !this.storeKey) return;

        const data = await ArrivalSpace.pluginStore.get(this.storeKey, { sort: "desc", limit: 10 });
        if (!data || data.length === 0) {
            container.innerHTML = "";
            return;
        }

        const esc = (s) => String(s).replace(/</g, "&lt;");
        const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
        let html = "";
        for (let i = 0; i < data.length; i++) {
            const e = data[i];
            const rank = i + 1;
            const isTop3 = rank <= 3;
            const cls = "sh-rank-row" + (isTop3 ? " top3" : "");
            const pos = medals[i] || rank;

            const score = e.numval || 0;
            const filledCount = Math.round(score / 10000);
            const timeTaken = (filledCount * 10000 - score).toFixed(1);
            const time = filledCount >= 1 ? `${timeTaken}s` : "-";

            let name = "";
            let slotsHtml = "";
            try {
                const parsed = JSON.parse(e.value);
                name = esc(parsed.names || "Unknown");
                for (const s of parsed.slots || []) {
                    const c = s.filled ? "#f5c542" : "rgba(255,255,255,0.15)";
                    slotsHtml += `<span style="display:inline-block;width:12px;height:14px;line-height:14px;text-align:center;font-size:8px;font-weight:bold;color:${c};border:1px solid ${c};border-radius:2px;margin-right:1px;">${s.letter}</span>`;
                }
            } catch {
                name = esc(e.value || "Unknown");
            }

            html += `<div class="${cls}">
                <span class="sh-rank-pos">${pos}</span>
                <span class="sh-rank-name">${name}</span>
                ${slotsHtml ? `<span style="margin:0 6px;">${slotsHtml}</span>` : ""}
                <span class="sh-rank-time">${time}</span>
            </div>`;
        }
        container.innerHTML = html;
    }

    // ── Property changes ──

    onPropertyChanged(name) {
        if (name === "challengeWord" && !this._started) {
            this._buildSlots();
            this._fireStateUpdated();
        }
    }

    // ── Cleanup ──

    destroy() {
        if (this._onItemReady) ArrivalSpace.off("scavenger:item:ready", this._onItemReady);
        if (this._onItemRemoved) ArrivalSpace.off("scavenger:item:removed", this._onItemRemoved);
        if (this._onLocalStart) ArrivalSpace.off("scavenger:start", this._onLocalStart);
        this._stopStateBroadcast();
        for (const unsub of this._networkUnsubs) {
            if (typeof unsub === "function") unsub();
        }
        this._networkUnsubs = [];
    }
}
