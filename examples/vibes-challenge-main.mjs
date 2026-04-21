/**
 * Vibes Challenge — Multiplayer co-op controller.
 *
 * Hardened for multiplayer stability:
 * - runId added so network messages are idempotent per run
 * - local state events are emitted only on meaningful changes (not every frame)
 * - scavenger items are deduped by stable entity identity, not script object reference
 */
export class ScavengerHunt extends ArrivalScript {
    static scriptName = "Scavenger Hunt";

    autoReset = true;
    resetDelay = 5;
    challengeWord = "VIBES";
    duration = 1800;
    storeKey = "vibes-best-time";
    forceEnd = false;

    static properties = {
        autoReset: { title: "Auto Reset" },
        resetDelay: { title: "Reset Delay (s)", min: 1, max: 30, step: 1 },
        challengeWord: { title: "Challenge Word" },
        duration: { title: "Duration (s)", min: 10, max: 3600, step: 5 },
        storeKey: { title: "Leaderboard Key" },
        forceEnd: { title: "Force End (no score)" },
    };

    _items = [];
    _started = false;
    _gameComplete = false;
    _resetTimer = 0;
    _timeRemaining = 0;
    _slots = [];
    _participants = {};
    _isHost = false;
    _hostUserId = null;
    _stateInterval = null;
    _networkUnsubs = [];
    _finishTime = 0;
    _lastHostHeartbeat = 0;
    _runId = null;
    _lastStateEventKey = "";

    initialize() {
        this._items = [];
        this._started = false;
        this._gameComplete = false;
        this._isHost = false;
        this._hostUserId = null;
        this._participants = {};
        this._runId = null;
        this._lastStateEventKey = "";

        this.log("ScavengerHunt initialized");

        this._onItemReady = (item) => this._registerItem(item);
        this._onItemRemoved = (item) => this._unregisterItem(item);
        ArrivalSpace.on("scavenger:item:ready", this._onItemReady);
        ArrivalSpace.on("scavenger:item:removed", this._onItemRemoved);
        this._discoverExistingItems();

        this._onLocalStart = () => this._hostStartGame();
        ArrivalSpace.on("scavenger:start", this._onLocalStart);

        this._sub("vibes:start", (data) => this._onNetStart(data));
        this._sub("vibes:collect-request", (data, sender) => this._onNetCollectRequest(data, sender));
        this._sub("vibes:collect-confirm", (data) => this._onNetCollectConfirm(data));
        this._sub("vibes:state", (data) => this._onNetState(data));
        this._sub("vibes:end", (data) => this._onNetEnd(data));
        this._sub("vibes:reset", (data) => this._onNetReset(data));

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

        this._buildUI();
        this._emitStateUpdated(true);
    }

    _sub(type, callback) {
        const unsub = ArrivalSpace.net.on(type, callback);
        this._networkUnsubs.push(unsub);
    }

    update(dt) {
        if (!this._started) {
            this._updateHUD();
            return;
        }

        if (this._gameComplete) {
            if (this.autoReset) {
                this._resetTimer -= dt;
                this._updateFinishCountdown();
                if (this._resetTimer <= 0) {
                    this._resetGame();
                }
            }
            this._updateHUD();
            return;
        }

        if (this._isHost) {
            this._timeRemaining -= dt;
            if (this._timeRemaining <= 0) {
                this._timeRemaining = 0;
                this._onTimeout();
                return;
            }
        } else {
            this._timeRemaining -= dt;
            if (this._timeRemaining < 0) this._timeRemaining = 0;
        }

        if (!this._isHost && this._lastHostHeartbeat > 0) {
            const silence = Date.now() - this._lastHostHeartbeat;
            if (silence > 6000) {
                this._lastHostHeartbeat = 0;
                this._onHostDisconnected();
                if (this._isHost) return;
            }
        }

        this._checkProximity();
        this._emitStateUpdated(false);
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

    _getItemKey(item) {
        const entity = item?.entity;
        if (entity) {
            if (typeof entity.getGuid === "function") return entity.getGuid();
            if (entity._guid) return entity._guid;
            if (entity.name) return entity.name;
        }
        const pos = item?.position;
        return `${item?.letter || "?"}:${pos?.x ?? 0}:${pos?.y ?? 0}:${pos?.z ?? 0}`;
    }

    _cleanupItems() {
        const latestByKey = new Map();
        for (const item of this._items) {
            if (!item) continue;
            const key = this._getItemKey(item);
            latestByKey.set(key, item);
        }
        this._items = [...latestByKey.values()];
        return this._items;
    }

    _getItems() {
        return this._cleanupItems();
    }

    _registerItem(item) {
        const key = this._getItemKey(item);
        const existingIndex = this._items.findIndex((entry) => this._getItemKey(entry) === key);
        if (existingIndex >= 0) {
            if (this._items[existingIndex] === item) return;
            this._items[existingIndex] = item;
            this.log(`Replaced scavenger item registration: ${key}`);
        } else {
            this._items.push(item);
            this.log(`Registered scavenger item: ${item.letter || item.label || "?"}`);
        }
        this._cleanupItems();
    }

    _unregisterItem(item) {
        const key = this._getItemKey(item);
        this._items = this._items.filter((entry) => entry !== item && this._getItemKey(entry) !== key);
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

    _buildFilledLetterCounts() {
        const counts = {};
        for (const slot of this._slots) {
            if (!slot?.filled || !slot.letter) continue;
            const letter = String(slot.letter).toUpperCase();
            counts[letter] = (counts[letter] || 0) + 1;
        }
        return counts;
    }

    _syncItemVisualState(item, shouldBeCollected, reason = "state") {
        if (!item) return false;

        if (typeof item.syncCollectedState === "function") {
            return !!item.syncCollectedState(shouldBeCollected, reason);
        }

        if (!shouldBeCollected && item.collected && typeof item.reset === "function") {
            item.reset();
            return true;
        }

        return false;
    }

    _syncItemsToFilledSlots(reason = "state") {
        const activeGame = this._started && !this._gameComplete;
        if (!activeGame) return 0;

        const filledCounts = this._buildFilledLetterCounts();
        const groups = new Map();

        for (const item of this._getItems()) {
            const letter = item?.letter?.toUpperCase() || "";
            if (!groups.has(letter)) groups.set(letter, []);
            groups.get(letter).push(item);
        }

        let changes = 0;
        for (const [letter, items] of groups.entries()) {
            const filledCount = filledCounts[letter] || 0;
            for (let i = 0; i < items.length; i++) {
                const shouldBeCollected = i < filledCount;
                if (this._syncItemVisualState(items[i], shouldBeCollected, reason)) {
                    changes += 1;
                }
            }
        }

        return changes;
    }

    // ── Run identity helpers ──

    _makeRunId() {
        return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }

    _resetStateEventCache() {
        this._lastStateEventKey = "";
    }

    _getIncomingRunId(data) {
        return data?.runId || null;
    }

    _isRunMessageCompatible(data) {
        const incomingRunId = this._getIncomingRunId(data);
        if (!incomingRunId || !this._runId) return true;
        return incomingRunId === this._runId;
    }

    // ── Proximity check ──

    _checkProximity() {
        const player = ArrivalSpace.getPlayer();
        if (!player) return;
        const playerPos = player.getPosition();

        for (const item of this._getItems()) {
            if (item.collected) continue;
            const dist = playerPos.distance(item.position);
            if (dist < item.collectDistance) {
                const letter = item.letter?.toUpperCase();
                if (!letter) continue;

                const slotAvailable = this._slots.some((s) => s.letter === letter && !s.filled);
                if (!slotAvailable) continue;

                if (this._isHost) {
                    this._hostProcessCollect(letter, item, player);
                } else {
                    ArrivalSpace.net.send("vibes:collect-request", { runId: this._runId, letter });
                    item.collect(player, { reason: "local-optimistic" });
                }
            }
        }
    }

    // ── Host game logic ──

    _hostStartGame() {
        if (this._started) {
            this.log("Ignored duplicate local start while run already active");
            return;
        }

        const user = ArrivalSpace.getUser?.();
        this._isHost = true;
        this._hostUserId = user?.userID;
        this._lastHostHeartbeat = 0;
        this._started = true;
        this._gameComplete = false;
        this._timeRemaining = this.duration;
        this._participants = {};
        this._runId = this._makeRunId();
        this._resetStateEventCache();
        this._buildSlots();

        this.log(`Game started by host ${this._hostUserId || "unknown"}; runId=${this._runId}`);

        for (const item of this._getItems()) item.reset();

        ArrivalSpace.net.send("vibes:start", {
            runId: this._runId,
            hostUserId: this._hostUserId,
            challengeWord: this.challengeWord,
            duration: this.duration,
        });

        this._startStateBroadcast();
        this._emitStateUpdated(true);
    }

    _hostProcessCollect(letter, item, collectorEntity) {
        const user = ArrivalSpace.getUser?.();
        const userId = user?.userID;
        const userName = user?.userName || "Unknown";
        this._processCollect(letter, userId, userName, item, collectorEntity);
    }

    _processCollect(letter, userId, userName, item, collectorEntity) {
        const slotIndex = this._tryFillSlot(letter, userName);
        if (slotIndex < 0) return;

        if (!this._participants[userId]) {
            this._participants[userId] = { userName, letters: [] };
        }
        this._participants[userId].letters.push(letter);

        if (item) item.collect(collectorEntity, { reason: "host-confirmed" });

        this.log(`Letter collected: ${letter} by ${userName}; runId=${this._runId}`);

        ArrivalSpace.net.send("vibes:collect-confirm", {
            runId: this._runId,
            letter,
            userId,
            userName,
            slotIndex,
        });

        this._emitStateUpdated(true);

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
            runId: this._runId,
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
            runId: this._runId,
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
        const incomingRunId = data?.runId || `${data?.hostUserId || "host"}:${data?.challengeWord || this.challengeWord}:${data?.duration || this.duration}`;

        if (this._started && incomingRunId === this._runId) {
            this.log(`Ignored duplicate net start for runId=${incomingRunId}`);
            return;
        }

        if (this._started && !this._gameComplete) {
            this.warn(`Ignored net start while another run is active; current=${this._runId}, incoming=${incomingRunId}`);
            return;
        }

        this._lastHostHeartbeat = Date.now();
        this._isHost = false;
        this._hostUserId = data.hostUserId;
        this._started = true;
        this._gameComplete = false;
        this._timeRemaining = data.duration;
        this._participants = {};
        this._runId = incomingRunId;
        this._resetStateEventCache();

        this._slots = [...data.challengeWord.toUpperCase()].map((letter) => ({
            letter,
            filled: false,
            collectedBy: null,
        }));

        this.log(`Accepted net start; runId=${this._runId}`);

        ArrivalSpace.fire("scavenger:start");
        for (const item of this._getItems()) item.reset();

        this._emitStateUpdated(true);
    }

    _onNetCollectRequest(data, sender) {
        if (!this._isHost || this._gameComplete) return;
        if (!this._isRunMessageCompatible(data)) {
            this.warn(`Ignored collect-request for stale runId=${data?.runId || "none"}`);
            return;
        }

        const letter = data.letter?.toUpperCase();
        if (!letter) return;

        const players = ArrivalSpace.net.getPlayers();
        const remote = (data.senderNetworkId
            ? players.find((p) => p.socketId === data.senderNetworkId)
            : null) || players.find((p) => p.userID == sender.userID);
        const collectorEntity = remote?.entity || null;

        const item = this._getItems().find(
            (i) => !i.collected && i.letter?.toUpperCase() === letter
        );
        if (item) item.collect(collectorEntity, { reason: "host-remote-request" });

        this._processCollect(letter, sender.userID, sender.userName, null, collectorEntity);
    }

    _onNetCollectConfirm(data) {
        this._lastHostHeartbeat = Date.now();
        if (this._isHost) return;
        if (!this._isRunMessageCompatible(data)) {
            this.warn(`Ignored collect-confirm for stale runId=${data?.runId || "none"}`);
            return;
        }

        const { letter, userId, userName, slotIndex } = data;

        if (slotIndex >= 0 && slotIndex < this._slots.length) {
            this._slots[slotIndex].filled = true;
            this._slots[slotIndex].collectedBy = userName;
        }

        if (!this._participants[userId]) {
            this._participants[userId] = { userName, letters: [] };
        }
        this._participants[userId].letters.push(letter);

        const players = ArrivalSpace.net.getPlayers();
        const remote = (data.senderNetworkId
            ? players.find((p) => p.socketId === data.senderNetworkId)
            : null) || players.find((p) => p.userID == userId);
        const collectorEntity = remote?.entity || ArrivalSpace.getPlayer();

        const item = this._getItems().find(
            (i) => !i.collected && i.letter?.toUpperCase() === letter?.toUpperCase()
        );
        if (item) item.collect(collectorEntity, { reason: "net-confirm" });

        this._emitStateUpdated(true);
    }

    _onNetState(data) {
        this._lastHostHeartbeat = Date.now();
        if (!this._isRunMessageCompatible(data)) {
            this.warn(`Ignored state packet for stale runId=${data?.runId || "none"}`);
            return;
        }

        if (this._isHost && data.hostUserId !== this._hostUserId) {
            this._isHost = false;
            this._stopStateBroadcast();
        }
        if (this._isHost) return;

        if (!this._runId && data.runId) {
            this._runId = data.runId;
            this._resetStateEventCache();
        }

        this._hostUserId = data.hostUserId;
        this._started = data.started;
        this._gameComplete = data.gameComplete;
        this._timeRemaining = data.timeRemaining;
        this._slots = data.slots;
        this._participants = data.participants;

        const synced = this._syncItemsToFilledSlots("net-state");
        if (synced > 0) {
            this.log(`Silently reconciled ${synced} collectible visual(s) from net state`);
        }

        this._emitStateUpdated(true);
    }

    _onNetEnd(data) {
        if (this._isHost) return;
        if (!this._isRunMessageCompatible(data)) {
            this.warn(`Ignored end packet for stale runId=${data?.runId || "none"}`);
            return;
        }

        this._gameComplete = true;
        this._resetTimer = this.resetDelay;
        this._slots = data.slots || this._slots;
        this._participants = data.participants || this._participants;
        this._onGameEnd(data);
    }

    _onNetReset(data) {
        if (this._isHost) return;
        if (data && !this._isRunMessageCompatible(data)) {
            this.warn(`Ignored reset packet for stale runId=${data?.runId || "none"}`);
            return;
        }
        this._doReset();
    }

    _onHostDisconnected() {
        if (!this._started || this._gameComplete) return;

        const deadHostId = this._hostUserId;
        const me = ArrivalSpace.getUser?.();
        if (!me?.userID) return;
        const players = ArrivalSpace.net.getPlayers();
        const ids = players
            .map((p) => p.userID)
            .filter((id) => id && id !== deadHostId);
        if (!ids.includes(me.userID)) ids.push(me.userID);
        ids.sort();

        if (ids[0] === me.userID) {
            this._isHost = true;
            this._hostUserId = me.userID;
            this._startStateBroadcast();
            ArrivalSpace.net.send("vibes:state", this._buildStatePayload());
            this.log(`Host migrated to ${me.userID}; runId=${this._runId}`);
        }
    }

    // ── Game end ──

    _onGameEnd(data) {
        this._showFinishOverlay(data);
        this._saveScore(data);
        this._emitStateUpdated(true);
    }

    async _saveScore(data) {
        if (!this._isHost || !this.storeKey || !data.filledCount) return;
        const slots = (data.slots || []).map((s) => ({
            letter: s.letter,
            filled: s.filled,
            by: s.collectedBy || null,
        }));
        const participantIds = Object.keys(data.participants).sort().join("+");
        const teamKey = `${this.storeKey}:${participantIds}`;
        const hostId = this._hostUserId;
        const entries = Object.entries(data.participants);
        entries.sort((a, b) => (a[0] === hostId ? -1 : b[0] === hostId ? 1 : 0));
        const names = entries.map(([, p]) => p.userName).join(", ");
        const value = JSON.stringify({ names, slots });
        await ArrivalSpace.pluginStore.push(teamKey, value, {
            numval: data.score,
            mode: "max",
        });
        // Also write to this week's bucket (Monday-anchored UTC), so the
        // leaderboard's weekly view reflects this week's best — not all-time
        // PBs that happened to be set this week.
        const wd = new Date();
        const day = wd.getUTCDay(); // 0 = Sun .. 6 = Sat
        wd.setUTCDate(wd.getUTCDate() + (day === 0 ? -6 : 1 - day));
        const weekKey = `${this.storeKey}-weekly-${wd.toISOString().slice(0, 10)}:${participantIds}`;
        await ArrivalSpace.pluginStore.push(weekKey, value, {
            numval: data.score,
            mode: "max",
        });
        ArrivalSpace.fire("scavenger:leaderboard:updated");
        this._showFinishRanking();
    }

    // ── Reset ──

    _resetGame() {
        if (this._isHost) {
            ArrivalSpace.net.send("vibes:reset", { runId: this._runId });
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
        this._runId = null;
        this._resetStateEventCache();

        for (const item of this._getItems()) item.reset();

        this._hideFinishOverlay();
        ArrivalSpace.fire("vibes:game-reset");
        ArrivalSpace.fire("scavenger:reset");
        this._emitStateUpdated(true);
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
            runId: this._runId,
            hostUserId: this._hostUserId,
            started: this._started,
            gameComplete: this._gameComplete,
            timeRemaining: this._timeRemaining,
            slots: this._slots,
            participants: this._participants,
        };
    }

    // ── Local event for status panel ──

    _buildStateEventPayload() {
        return {
            runId: this._runId,
            started: this._started,
            gameComplete: this._gameComplete,
            timeRemaining: this._timeRemaining,
            duration: this.duration,
            slots: this._slots,
            participants: this._participants,
            allCollected: this._allSlotsFilled(),
            challengeWord: this.challengeWord,
        };
    }

    _buildStateEventKey(payload) {
        const timeBucket = payload.started && !payload.gameComplete
            ? Math.ceil(payload.timeRemaining)
            : payload.timeRemaining;
        const slotKey = (payload.slots || [])
            .map((s) => `${s.letter}:${s.filled ? 1 : 0}:${s.collectedBy || ""}`)
            .join("|");
        const participantKey = Object.entries(payload.participants || {})
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([id, p]) => `${id}:${p.userName}:${(p.letters || []).join("")}`)
            .join("|");
        return [
            payload.runId || "",
            payload.started ? 1 : 0,
            payload.gameComplete ? 1 : 0,
            timeBucket,
            payload.challengeWord || "",
            slotKey,
            participantKey,
        ].join("~");
    }

    _emitStateUpdated(force = false) {
        const payload = this._buildStateEventPayload();
        const key = this._buildStateEventKey(payload);
        if (force || key !== this._lastStateEventKey) {
            this._lastStateEventKey = key;
            ArrivalSpace.fire("vibes:state-updated", payload);
        }
        this._updateHUD();
    }

    // ── 2D HUD ──

    _updateHUD() {
        const hud = this._uiContainer?.querySelector("#sh-hud");
        if (!hud) return;

        if (!this._started || this._gameComplete || this._slots.length === 0 || !ArrivalSpace.getLocalAttachedEntity()) {
            hud.classList.remove("visible");
            return;
        }

        hud.classList.add("visible");

        const slotsEl = hud.querySelector("#sh-hud-slots");
        if (!slotsEl) return;

        let justRebuilt = false;
        const letterEls = slotsEl.querySelectorAll(".sh-hud-letter");
        if (letterEls.length !== this._slots.length) {
            let html = "";
            for (const slot of this._slots) {
                html += `<div class="sh-hud-letter${slot.filled ? " filled" : ""}">${slot.letter}</div>`;
            }
            html += `<span id="sh-hud-timer"></span>`;
            slotsEl.innerHTML = html;
            justRebuilt = true;
        }

        const letters = slotsEl.querySelectorAll(".sh-hud-letter");
        for (let i = 0; i < this._slots.length; i++) {
            if (i < letters.length) {
                const wasFilled = letters[i].classList.contains("filled");
                const isFilled = this._slots[i].filled;
                letters[i].classList.toggle("filled", isFilled);
                if (isFilled && !wasFilled && !justRebuilt) {
                    const el = letters[i];
                    el.style.cssText += ";animation: stampIn 1.4s cubic-bezier(0.12,0.9,0.2,1) both;";
                    el.addEventListener("animationend", () => { el.style.animation = ""; }, { once: true });
                }
            }
        }

        const timerEl = slotsEl.querySelector("#sh-hud-timer");
        if (timerEl) {
            const t = Math.max(0, this._timeRemaining);
            const mins = Math.floor(t / 60);
            const secs = Math.floor(t % 60);
            timerEl.textContent = mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
            timerEl.classList.toggle("urgent", t < 10);
        }
    }

    // ── UI ──

    _buildUI() {
        const ui = this.getUIContainer();
        ui.innerHTML = `
        <style>
            #sh-hud {
                display: none;
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 100;
                pointer-events: none;
                user-select: none;
                font-family: sans-serif;
            }
            #sh-hud.visible { display: flex; }
            #sh-hud, #sh-hud-slots { overflow: visible !important; }
            #sh-hud-slots {
                display: flex;
                gap: 6px;
                background: rgba(0,0,0,0.15);
                padding: 8px 14px;
                border-radius: 10px;
                align-items: center;
            }
            .sh-hud-letter {
                width: 32px; height: 38px;
                display: flex; align-items: center; justify-content: center;
                border-radius: 5px;
                border: 2px solid rgba(255,255,255,0.15);
                background: rgba(0,0,0,0.3);
                font-size: 18px; font-weight: bold;
                color: rgba(255,255,255,0.2);
                transition: all 0.3s;
            }
            .sh-hud-letter.filled {
                color: #f5c542;
                border-color: #f5c542;
                background: rgba(245,197,66,0.1);
                text-shadow: 0 0 8px rgba(245,197,66,0.4);
            }
            @keyframes stampIn {
                0%   { transform: translateY(-1200px) scale(25); opacity: 0; text-shadow: 0 0 80px rgba(245,197,66,1); }
                10%  { opacity: 0.3; }
                25%  { transform: translateY(-400px) scale(20); opacity: 0.6; text-shadow: 0 0 60px rgba(245,197,66,0.8); }
                40%  { transform: translateY(-60px) scale(12); opacity: 0.9; }
                50%  { transform: translateY(5px) scale(1.3); opacity: 1; text-shadow: 0 0 30px rgba(245,197,66,0.6); }
                58%  { transform: translateY(-8px) scale(0.85); }
                66%  { transform: translateY(4px) scale(1.15); }
                74%  { transform: translateY(-3px) scale(0.95); }
                82%  { transform: translateY(1px) scale(1.04); }
                100% { transform: translateY(0) scale(1); text-shadow: 0 0 8px rgba(245,197,66,0.4); }
            }
            #sh-hud-timer {
                font-size: 14px;
                color: rgba(255,255,255,0.6);
                margin-left: 10px;
                font-variant-numeric: tabular-nums;
            }
            #sh-hud-timer.urgent { color: #ff4444; }
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

        <div id="sh-hud">
            <div id="sh-hud-slots"></div>
        </div>

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

        const title = this._uiContainer?.querySelector("#sh-finish-title");
        if (title) {
            title.textContent = data.allCollected
                ? "Challenge Complete!"
                : `Time's Up! (${data.filledCount}/${this._slots.length})`;
        }

        const stats = this._uiContainer?.querySelector("#sh-finish-stats");
        if (stats) {
            const time = data.timeTaken?.toFixed(1) || "0";
            stats.textContent = data.allCollected
                ? `Completed in ${time}s`
                : `${data.filledCount} letters collected`;
        }

        const players = this._uiContainer?.querySelector("#sh-finish-players");
        if (players) {
            const names = Object.values(data.participants || {})
                .map((p) => p.userName)
                .join(", ");
            players.textContent = names ? `Players: ${names}` : "";
        }

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

        const btn = this._uiContainer?.querySelector("#sh-finish-btn");
        if (btn) btn.style.display = this._isHost ? "" : "none";

        this._updateFinishCountdown();
    }

    _hideFinishOverlay() {
        const overlay = this._uiContainer?.querySelector("#sh-finish");
        if (overlay) overlay.classList.remove("visible");
        const hud = this._uiContainer?.querySelector("#sh-hud");
        if (hud) hud.classList.remove("visible");
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

    onPropertyChanged(name) {
        if (name === "challengeWord" && !this._started) {
            this._buildSlots();
            this._emitStateUpdated(true);
        }

        if (name === "forceEnd" && this.forceEnd) {
            this._resetGame();
            setTimeout(() => { this.forceEnd = false; }, 100);
        }
    }

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
