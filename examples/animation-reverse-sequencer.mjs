/// <reference path="../types/arrival.d.ts" />

/**
 * Animation Reverse Sequencer — plays a scene animation forward, waits a few
 * seconds, then plays it back in reverse and stops.
 *
 * Pick up to three cutscene/animation entities in the editor. Each has its own
 * Play button and plays completely independently:
 *
 *   Play 1 → Anim 1 forward → wait (delay) → Anim 1 reverse → stop
 *   Play 2 → Anim 2 forward → wait (delay) → Anim 2 reverse → stop
 *   Play 3 → Anim 3 forward → wait (delay) → Anim 3 reverse → stop
 *
 * The three never trigger each other — pressing a Play button only affects its
 * own animation. And only one animation can ever run at a time: the plugin is a
 * single serial state machine guarded by a `_running` lock, so pressing another
 * Play (or the same one again) while one is in progress is ignored. Stop
 * cancels the current run.
 *
 * Both legs go through the cutscene controller (`getCutsceneScript(id)`):
 * forward is `setData({ reverse: false }) → playCutscene({ onComplete })`,
 * reverse is `setData({ reverse: true }) → playCutscene({ onComplete })`. The
 * controller owns the sequencePlayer (it creates one per play and destroys it
 * on completion), so direction is set via its `reverse` data flag rather than
 * by touching the player directly. See docs/sequences.md.
 *
 * Features demonstrated:
 * - Entity pickers (`editor: "entity"`, `filterTypes: ["cutscene"]`)
 * - Reverse playback via `cutscene.setData({ reverse: true })`
 * - `playCutscene({ onComplete })` chaining + a timed delay between passes
 * - A serial lock so two animations never play simultaneously
 * - `editor: "action"` Play / Stop buttons
 */

export class AnimationReverseSequencer extends ArrivalScript {
    static scriptName = "Animation Reverse Sequencer";

    // The three animations, each a cutscene entity id. Each plays on its own.
    animation1 = "";
    animation2 = "";
    animation3 = "";

    // Seconds to wait after an animation finishes before playing it in reverse.
    delaySeconds = 5;

    static properties = {
        animation1: { title: "Animation 1", editor: "entity", filterTypes: ["cutscene"] },
        animation2: { title: "Animation 2", editor: "entity", filterTypes: ["cutscene"] },
        animation3: { title: "Animation 3", editor: "entity", filterTypes: ["cutscene"] },
        delaySeconds: { title: "Reverse Delay (s)", min: 0, max: 60, step: 0.5 },
        play1: { title: "Play 1", editor: "action" },
        play2: { title: "Play 2", editor: "action" },
        play3: { title: "Play 3", editor: "action" },
        stop: { title: "Stop", editor: "action" },
    };

    // ── internal state (underscore-prefixed → hidden from the editor) ──
    _running = false;     // the global "no two at once" lock
    _activeId = "";       // entity id currently playing (for stop)
    _cutscene = null;     // active cutscene controller
    _delayTimer = null;   // setTimeout id for the wait-before-reverse

    // ── editor actions ──

    play1() {
        return this._start(this.animation1);
    }

    play2() {
        return this._start(this.animation2);
    }

    play3() {
        return this._start(this.animation3);
    }

    /** Cancel the current run (if any), freeze playback, and reset to idle. */
    stop() {
        this._cancelDelay();

        if (this._activeId) {
            // The player only exists while playing; freeze it if it's live.
            this._getEntityById(this._activeId)?.script?.sequencePlayer?.pauseSequence?.();
        }
        this._cutscene?.setData?.({ reverse: false }); // leave the cutscene forward-facing
        this._reset();
    }

    // ── state machine ──

    // Begin one animation's forward → wait → reverse → stop cycle.
    _start(entityId) {
        const id = typeof entityId === "string" ? entityId.trim() : "";

        if (this._running) {
            this.warn("Animation Reverse Sequencer: another animation is already playing.");
            return false;
        }
        if (!id) {
            this.warn("Animation Reverse Sequencer: that slot has no animation entity.");
            return false;
        }

        const cutscene = ArrivalSpace.getCutsceneScript?.(id);
        if (!cutscene || typeof cutscene.playCutscene !== "function") {
            this.warn(`Animation Reverse Sequencer: "${id}" is not a playable cutscene/animation.`);
            return false;
        }

        this._running = true;
        this._activeId = id;
        this._cutscene = cutscene;
        this._playForward();
        return true;
    }

    _playForward() {
        this._cutscene.setData?.({ reverse: false });
        this._cutscene.playCutscene({
            onComplete: () => {
                if (!this._running) return; // stop()/destroy() cancelled us
                this._scheduleReverse();
            },
        });
    }

    _scheduleReverse() {
        const ms = Math.max(0, (Number(this.delaySeconds) || 0) * 1000);
        this._cancelDelay();
        this._delayTimer = setTimeout(() => {
            this._delayTimer = null;
            this._playReverse();
        }, ms);
    }

    _playReverse() {
        if (!this._running || !this._cutscene) return;

        const cutscene = this._cutscene;
        cutscene.setData?.({ reverse: true });
        cutscene.playCutscene({
            onComplete: () => {
                if (!this._running) return;
                cutscene.setData?.({ reverse: false }); // restore default direction
                this._reset();
            },
        });
    }

    // Release the lock and return to idle (cancels any pending reverse).
    _reset() {
        this._cancelDelay();
        this._running = false;
        this._activeId = "";
        this._cutscene = null;
    }

    _getEntityById(entityId) {
        const id = typeof entityId === "string" ? entityId.trim() : "";
        if (!id) return null;

        const gateServer = this.app?.root?.findByName?.("GateServer")?.script?.gateServer;
        let entity = gateServer?.getEntity?.(id) ?? null;
        if (!entity) {
            try {
                entity = this.app?.root?.findByGuid?.(id) ?? null;
            } catch (_) {
                /* ignore */
            }
        }
        return entity;
    }

    _cancelDelay() {
        if (this._delayTimer) {
            clearTimeout(this._delayTimer);
            this._delayTimer = null;
        }
    }

    destroy() {
        this._cutscene?.setData?.({ reverse: false });
        this._reset();
    }
}
