/**
 * Simple Camera Path Plugin (timeline-first)
 *
 * - One plugin entity equals one camera path
 * - CRUD happens via content list (duplicate/delete plugin entity)
 * - Primary path and global behavior come from roomData:
 *   - primaryCameraPathId
 *   - cameraPathAutoplay
 *   - cameraPathShowReplayButton
 * - Edit UI is timeline-only and appears automatically when plugin is selected in edit mode
 */
export class SimpleCameraPath extends ArrivalScript {
    static scriptName = "simpleCameraPath";

    // Per-path settings (React plugin params)
    enabledPath = true;
    duration = 8;
    playbackSpeed = 1;
    loop = false;
    previewPath = true;
    pathColor = "#f59e0b";
    selectedColor = "#22c55e";

    // Persisted path payload
    // Format: [{ time: 0..1, position:{x,y,z}, quaternion:{x,y,z,w} }, ...]
    keyframes = [];

    static properties = {
        enabledPath: { title: "Enable Path" },
        duration: { title: "Duration (s)", min: 0.1, max: 120, step: 1 },
        playbackSpeed: { title: "Playback Speed", min: 0.1, max: 4 },
        loop: { title: "Loop" },
        previewPath: { title: "Preview Path" },
        pathColor: { title: "Path Color" },
        selectedColor: { title: "Selected Keyframe Color" },
    };

    _runtimeKeyframes = [];
    _selectedIndex = -1;

    _isPlaying = false;
    _playTime = 0;
    _playbackRestoreOnStop = true;
    _autoPlayed = false;

    _savedCameraPos = null;
    _savedCameraRot = null;
    _savedCameraParent = null;
    _savedCameraLocalPos = null;
    _savedCameraLocalRot = null;
    _savedCameraLocalScale = null;
    _hasSavedCameraState = false;
    _disabledCameraScripts = [];

    _editorOpen = false;
    _timeline = null;
    _timelineProgress = 0;
    _isKeyframeDragging = false;
    _dragKeyframeRef = null;
    _dragKeyframeWrap = null;
    _dragStartX = 0;
    _dragMoved = false;
    _suppressMarkerClick = false;
    _timelineHoverProgress = 0;
    _timelineHoverHideTimer = null;
    _isTimelineHoverVisible = false;
    _isTimelineScrubbing = false;

    _persistTimer = null;

    _boundUpdate = null;
    _boundKeyframeDragMove = null;
    _boundKeyframeDragUp = null;
    _boundTimelineScrubMove = null;
    _boundTimelineScrubUp = null;

    initialize() {
        this._runtimeKeyframes = this._deserializeKeyframes(this.keyframes);
        this._selectInitialKeyframe();

        this._boundUpdate = (dt) => this._onUpdate(dt);
        this.app.on("update", this._boundUpdate);
        this._boundKeyframeDragMove = (e) => this._onKeyframeDragMove(e);
        this._boundKeyframeDragUp = (e) => this._onKeyframeDragUp(e);
        this._boundTimelineScrubMove = (e) => this._onTimelineScrubMove(e);
        this._boundTimelineScrubUp = () => this._onTimelineScrubUp();

        this._tryInitialAutoplay(0);
    }

    destroy() {
        if (this._boundUpdate) {
            this.app.off("update", this._boundUpdate);
        }

        if (this._timelineHoverHideTimer) {
            clearTimeout(this._timelineHoverHideTimer);
            this._timelineHoverHideTimer = null;
        }

        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }

        this._closeTimelineEditor();
        this._stopPlayback(false, true);
    }

    onPropertyChanged(name, value) {
        if (name === "keyframes") {
            this._runtimeKeyframes = this._deserializeKeyframes(value);
            this._selectInitialKeyframe();
            this._setTimelineProgress(this._getSelectedProgress());
            this._renderTimeline();
            return;
        }

        if (name === "duration") {
            this.duration = this._clampNumber(value, 0.1, 120, 8);
            const duration = this._getDuration();
            this._playTime = this._clampNumber(this._playTime, 0, duration, 0);
            this._setTimelineProgress(duration > 0 ? this._playTime / duration : 0);
            this._renderTimeline();
            return;
        }

        if (name === "playbackSpeed") {
            this.playbackSpeed = this._clampNumber(value, 0.1, 4, 1);
            return;
        }

        if (name === "enabledPath" && !value) {
            this._stopPlayback(true, true);
        }
    }

    // New plugin edit-mode interface from UserModelEntity
    onEditModeChanged(isEditing) {
        if (!ArrivalSpace.isOwner()) return;

        if (isEditing) {
            this._openTimelineEditor();
        } else {
            this._closeTimelineEditor();
        }
    }

    _getRoomData() {
        return this.app.customTravelCenter?.roomData || null;
    }

    _getPluginEntityId() {
        const userModelScript = this.entity.parent?.script?.userModelEntity;
        return userModelScript?.id || userModelScript?.data?.id || null;
    }

    _isPrimaryPath() {
        const roomData = this._getRoomData();
        const primaryId = roomData?.primaryCameraPathId;
        const myId = this._getPluginEntityId();
        if (!primaryId || !myId) return false;
        return String(primaryId) === String(myId);
    }

    _shouldAutoplay() {
        if (!this.enabledPath) return false;
        if (!this._isPrimaryPath()) return false;
        if (this._runtimeKeyframes.length < 2) return false;

        const roomData = this._getRoomData();
        return roomData?.cameraPathAutoplay !== false;
    }

    _tryInitialAutoplay(attempt) {
        if (this._autoPlayed) return;

        const roomData = this._getRoomData();
        if (!roomData) {
            if (attempt < 20) {
                setTimeout(() => this._tryInitialAutoplay(attempt + 1), 250);
            }
            return;
        }

        if (this._shouldAutoplay()) {
            this._autoPlayed = true;
            this._startPlayback(true, true);
        }
    }

    _openTimelineEditor() {
        this._editorOpen = true;
        this._ensureTimeline();
        this._setTimelineProgress(this._getSelectedProgress());
        this._timelineHoverProgress = this._timelineProgress;
        this._isTimelineHoverVisible = false;
        this._renderTimeline();
    }

    _closeTimelineEditor() {
        this._editorOpen = false;
        this._cancelKeyframeDrag();
        this._cancelTimelineScrub();
        this._timelineHoverProgress = this._timelineProgress;
        this._isTimelineHoverVisible = false;
        this._cancelTimelineHoverHide();

        if (this._timeline) {
            this._timeline.remove();
            this._timeline = null;
        }
    }

    _ensureTimeline() {
        if (this._timeline) return;

        this._timeline = this.createUI("div", {
            id: "scp-timeline-root",
            style: {
                position: "fixed",
                left: "50%",
                transform: "translateX(-50%)",
                bottom: "16px",
                width: "min(980px, calc(100vw - 32px))",
                zIndex: "1002",
                pointerEvents: "auto",
            },
        });
    }

    _renderTimeline() {
        if (!this._editorOpen || !this._timeline) return;

        const duration = this._getDuration();
        const keyframes = this._runtimeKeyframes;

        const markers = keyframes
            .map((kf, idx) => {
                const selected = idx === this._selectedIndex;
                return `
                    <div data-kf-wrap-index="${idx}" style="
                        position:absolute;
                        left:${(kf.time * 100).toFixed(3)}%;
                        top:50%;
                        transform:translate(-50%, -50%);
                        width:20px;
                        height:30px;
                        display:flex;
                        align-items:center;
                        justify-content:center;
                    ">
                        <button data-kf-index="${idx}" title="Keyframe ${idx + 1}" style="
                        width:10px;
                        height:10px;
                        border-radius:999px;
                        border:1px solid ${selected ? "#22c55e" : "#94a3b8"};
                        background:${selected ? "#22c55e" : "rgba(148,163,184,0.65)"};
                        box-shadow:${selected ? "0 0 10px rgba(34,197,94,0.65)" : "none"};
                        cursor:ew-resize;
                        "></button>
                        <button data-kf-delete="${idx}" title="Delete keyframe" style="
                        position:absolute;
                        top:22px;
                        left:50%;
                        transform:translateX(-50%);
                        width:12px;
                        height:12px;
                        border:none;
                        border-radius:999px;
                        padding:0;
                        background:rgba(239,68,68,0.92);
                        color:#fff;
                        font-size:9px;
                        line-height:12px;
                        text-align:center;
                        cursor:pointer;
                        opacity:${selected ? "1" : "0"};
                        pointer-events:${selected ? "auto" : "none"};
                        transition:opacity 120ms ease;
                    ">×</button>
                    </div>
                `;
            })
            .join("");

        this._timeline.innerHTML = `
            <div style="
                border-radius:12px;
                border:1px solid rgba(148,163,184,0.3);
                background:rgba(10,12,18,0.96);
                padding:10px 12px;
                box-shadow:0 8px 24px rgba(0,0,0,0.3);
                color:#e2e8f0;
                font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
            ">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <button id="scp-play" style="${this._timelineButtonStyle()}">${this._isPlaying ? "Stop" : "▶"}</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:0.9">
                        <span id="scp-time-now">${(duration * this._timelineProgress).toFixed(2)}s</span>
                        <span>/</span>
                        <input id="scp-duration" type="number" min="0.1" max="120" step="1" value="${duration.toFixed(2)}" style="
                            width:84px;
                            border-radius:8px;
                            border:1px solid rgba(148,163,184,0.35);
                            background:rgba(30,41,59,0.6);
                            color:#e2e8f0;
                            padding:4px 6px;
                        " />
                        <span>s</span>
                    </div>
                </div>

                <div id="scp-timeline-track" style="
                    position:relative;
                    width:100%;
                    height:30px;
                    border-radius:8px;
                    background:rgba(30,41,59,0.82);
                    border:1px solid rgba(148,163,184,0.25);
                    cursor:crosshair;
                    user-select:none;
                ">
                    ${markers}
                    <div id="scp-timeline-hover-line" style="
                        position:absolute;
                        top:-1px;
                        bottom:-1px;
                        width:1px;
                        background:rgba(248,250,252,0.28);
                        left:0;
                        pointer-events:none;
                        opacity:0;
                    "></div>
                    <button id="scp-timeline-hover-add" title="Add keyframe here" style="
                        position:absolute;
                        top:-22px;
                        left:0;
                        transform:translateX(-50%);
                        width:18px;
                        height:18px;
                        border:none;
                        border-radius:999px;
                        padding:0;
                        background:rgba(37,99,235,0.92);
                        color:#eff6ff;
                        font-size:12px;
                        line-height:18px;
                        text-align:center;
                        cursor:pointer;
                        opacity:0;
                        pointer-events:none;
                        transition:opacity 120ms ease;
                    ">+</button>
                    <div id="scp-timeline-playhead" style="
                        position:absolute;
                        top:-1px;
                        bottom:-1px;
                        width:12px;
                        left:${(this._timelineProgress * 100).toFixed(3)}%;
                        transform:translateX(-50%);
                        cursor:ew-resize;
                        pointer-events:auto;
                        touch-action:none;
                    ">
                        <div style="
                            position:absolute;
                            top:0;
                            bottom:0;
                            left:50%;
                            width:2px;
                            transform:translateX(-50%);
                            background:#f8fafc;
                            box-shadow:0 0 8px rgba(248,250,252,0.6);
                            pointer-events:none;
                        "></div>
                    </div>
                </div>
            </div>
        `;

        this._timeline.querySelector("#scp-play")?.addEventListener("click", () => {
            if (this._isPlaying) {
                this._stopPlayback(false, false);
            } else {
                this._startPlayback(false, false);
            }
            this._renderTimeline();
        });

        const durationInput = this._timeline.querySelector("#scp-duration");
        durationInput?.addEventListener("change", () => {
            const parsed = parseFloat(durationInput.value);
            this.duration = this._clampNumber(parsed, 0.1, 120, 8);
            this._playTime = this.duration * this._timelineProgress;
            durationInput.value = this.duration.toFixed(2);
            this._schedulePersist();
            this._updateTimelineWidgets();
        });

        const track = this._timeline.querySelector("#scp-timeline-track");
        track?.addEventListener("click", (e) => {
            if (this._suppressMarkerClick) {
                this._suppressMarkerClick = false;
                e.stopPropagation();
            }
        });
        track?.addEventListener("mousemove", (e) => {
            this._cancelTimelineHoverHide();
            this._updateTimelineHoverFromMouse(e, true);
        });
        track?.addEventListener("mouseenter", (e) => {
            this._cancelTimelineHoverHide();
            this._updateTimelineHoverFromMouse(e, true);
        });
        track?.addEventListener("mouseleave", () => {
            this._scheduleTimelineHoverHide();
        });

        this._timeline.querySelector("#scp-timeline-playhead")?.addEventListener("mousedown", (e) => {
            this._beginTimelineScrub(e);
        });

        this._timeline.querySelector("#scp-timeline-hover-add")?.addEventListener("mousedown", (e) => {
            e.stopPropagation();
        });
        this._timeline.querySelector("#scp-timeline-hover-add")?.addEventListener("mouseenter", () => {
            this._cancelTimelineHoverHide();
            this._updateTimelineHover(this._timelineHoverProgress, true);
        });
        this._timeline.querySelector("#scp-timeline-hover-add")?.addEventListener("mouseleave", () => {
            this._scheduleTimelineHoverHide();
        });
        this._timeline.querySelector("#scp-timeline-hover-add")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const p = this._clampNumber(this._timelineHoverProgress, 0, 1, this._timelineProgress);
            this._addKeyframeAtProgress(p);
            this._updateTimelineHover(p, true);
        });

        this._timeline.querySelectorAll("button[data-kf-index]").forEach((el) => {
            el.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                const idx = parseInt(el.getAttribute("data-kf-index"), 10);
                if (!Number.isFinite(idx)) return;
                const wrap = el.closest("div[data-kf-wrap-index]");
                this._beginKeyframeDrag(e, idx, wrap);
            });
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                if (this._suppressMarkerClick) {
                    this._suppressMarkerClick = false;
                    return;
                }
                const idx = parseInt(el.getAttribute("data-kf-index"), 10);
                if (!Number.isFinite(idx)) return;

                this._jumpToKeyframe(idx);
                this._renderTimeline();
            });
        });

        this._timeline.querySelectorAll("button[data-kf-delete]").forEach((el) => {
            el.addEventListener("mousedown", (e) => e.stopPropagation());
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(el.getAttribute("data-kf-delete"), 10);
                if (!Number.isFinite(idx)) return;
                this._deleteKeyframeAtIndex(idx);
            });
        });

        this._updateTimelineWidgets();
    }

    _beginKeyframeDrag(event, index, wrapEl) {
        if (!this._editorOpen || !this._timeline) return;
        if (event?.button != null && event.button !== 0) return;
        if (index < 0 || index >= this._runtimeKeyframes.length) return;
        if (this._isPlaying) {
            this._stopPlayback(false, false);
        }

        this._isKeyframeDragging = true;
        this._dragKeyframeRef = this._runtimeKeyframes[index];
        this._dragKeyframeWrap = wrapEl || null;
        this._dragStartX = event?.clientX ?? 0;
        this._dragMoved = false;
        this._selectedIndex = index;

        this._setTimelineProgress(this._dragKeyframeRef.time);
        this._playTime = this._getDuration() * this._dragKeyframeRef.time;
        this._applyCameraTransform(this._dragKeyframeRef.position, this._dragKeyframeRef.quaternion);
        this.app.needsRedraw = true;

        document.addEventListener("mousemove", this._boundKeyframeDragMove);
        document.addEventListener("mouseup", this._boundKeyframeDragUp);

        if (event?.preventDefault) event.preventDefault();
    }

    _cancelKeyframeDrag() {
        this._isKeyframeDragging = false;
        this._dragKeyframeRef = null;
        this._dragKeyframeWrap = null;
        this._dragStartX = 0;
        this._dragMoved = false;

        document.removeEventListener("mousemove", this._boundKeyframeDragMove);
        document.removeEventListener("mouseup", this._boundKeyframeDragUp);
    }

    _beginTimelineScrub(event) {
        if (!this._editorOpen || !this._timeline) return;
        if (event?.button != null && event.button !== 0) return;

        this._cancelTimelineHoverHide();
        this._setTimelineHoverVisible(false);
        this._isTimelineScrubbing = true;

        document.addEventListener("mousemove", this._boundTimelineScrubMove);
        document.addEventListener("mouseup", this._boundTimelineScrubUp);

        this._scrubTimelineCursorFromMouse(event);

        if (event?.stopPropagation) event.stopPropagation();
        if (event?.preventDefault) event.preventDefault();
    }

    _cancelTimelineScrub() {
        this._isTimelineScrubbing = false;
        document.removeEventListener("mousemove", this._boundTimelineScrubMove);
        document.removeEventListener("mouseup", this._boundTimelineScrubUp);
    }

    _onTimelineScrubMove(event) {
        if (!this._isTimelineScrubbing) return;
        this._scrubTimelineCursorFromMouse(event);
    }

    _onTimelineScrubUp() {
        if (!this._isTimelineScrubbing) return;
        this._cancelTimelineScrub();
    }

    _scrubTimelineCursorFromMouse(event) {
        const progress = this._getTimelineProgressFromMouse(event);
        if (progress == null) return;
        this._scrubToProgress(progress, true);
    }

    _onKeyframeDragMove(event) {
        if (!this._isKeyframeDragging || !this._dragKeyframeRef) return;

        const progress = this._getTimelineProgressFromMouse(event);
        if (progress == null) return;

        const p = this._clampNumber(progress, 0, 1, 0);
        if (Math.abs((event?.clientX ?? 0) - this._dragStartX) > 2) {
            this._dragMoved = true;
        }

        this._dragKeyframeRef.time = p;
        this._setTimelineProgress(p);
        this._playTime = this._getDuration() * p;
        this._updateTimelineHover(p, true);

        if (this._dragKeyframeWrap) {
            this._dragKeyframeWrap.style.left = `${(p * 100).toFixed(3)}%`;
        }

        if (event?.preventDefault) event.preventDefault();
    }

    _onKeyframeDragUp() {
        if (!this._isKeyframeDragging || !this._dragKeyframeRef) {
            this._cancelKeyframeDrag();
            return;
        }

        const draggedRef = this._dragKeyframeRef;
        const moved = this._dragMoved;
        this._cancelKeyframeDrag();

        this._sortKeyframes();
        const nextSelectedIndex = this._runtimeKeyframes.indexOf(draggedRef);
        if (nextSelectedIndex >= 0) {
            this._selectedIndex = nextSelectedIndex;
            this._setTimelineProgress(this._runtimeKeyframes[nextSelectedIndex].time);
            this._playTime = this._getDuration() * this._runtimeKeyframes[nextSelectedIndex].time;
        }

        if (moved) {
            this._suppressMarkerClick = true;
            this._commitPathEdits();
        } else {
            this._renderTimeline();
        }
    }

    _timelineButtonStyle() {
        return [
            "border:none",
            "border-radius:8px",
            "padding:6px 10px",
            "background:rgba(37,99,235,0.35)",
            "color:#eff6ff",
            "font-size:12px",
            "cursor:pointer",
            "min-width:32px",
        ].join(";");
    }

    _getTimelineProgressFromMouse(event) {
        const track = this._timeline?.querySelector("#scp-timeline-track");
        if (!track) return null;

        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return null;

        return (event.clientX - rect.left) / rect.width;
    }

    _updateTimelineHoverFromMouse(event, visible) {
        const progress = this._getTimelineProgressFromMouse(event);
        if (progress == null) return;
        this._timelineHoverProgress = this._clampNumber(progress, 0, 1, this._timelineProgress);

        this._updateTimelineHover(progress, visible);
    }

    _updateTimelineHover(progress, visible) {
        if (!this._timeline) return;

        const p = this._clampNumber(progress, 0, 1, 0);

        const hoverLine = this._timeline.querySelector("#scp-timeline-hover-line");
        const hoverAdd = this._timeline.querySelector("#scp-timeline-hover-add");
        const showHover = visible && !this._isKeyframeDragging && !this._isTimelineScrubbing;
        this._isTimelineHoverVisible = showHover;

        if (hoverLine) {
            hoverLine.style.left = `calc(${(p * 100).toFixed(3)}% - 0.5px)`;
            hoverLine.style.opacity = showHover ? "1" : "0";
        }

        if (hoverAdd) {
            hoverAdd.style.left = `${(p * 100).toFixed(3)}%`;
            hoverAdd.style.opacity = showHover ? "1" : "0";
            hoverAdd.style.pointerEvents = showHover ? "auto" : "none";
        }

        this._updateTimelineWidgets();
    }

    _cancelTimelineHoverHide() {
        if (this._timelineHoverHideTimer) {
            clearTimeout(this._timelineHoverHideTimer);
            this._timelineHoverHideTimer = null;
        }
    }

    _scheduleTimelineHoverHide() {
        this._cancelTimelineHoverHide();
        this._timelineHoverHideTimer = setTimeout(() => {
            this._timelineHoverHideTimer = null;
            this._setTimelineHoverVisible(false);
        }, 220);
    }

    _setTimelineHoverVisible(visible) {
        if (visible) {
            this._cancelTimelineHoverHide();
        }
        if (!visible) {
            this._timelineHoverProgress = this._timelineProgress;
        }
        this._isTimelineHoverVisible = !!visible;
        this._updateTimelineHover(this._timelineProgress, visible);
    }

    _scrubToProgress(progress, applyCamera) {
        if (this._isPlaying) {
            this._stopPlayback(false, false);
        }

        const p = this._clampNumber(progress, 0, 1, 0);
        this._setTimelineProgress(p);
        this._playTime = this._getDuration() * p;

        if (applyCamera && this._runtimeKeyframes.length > 0) {
            this._applyInterpolatedCamera(p);
            this.app.needsRedraw = true;
        }
    }

    _jumpToKeyframe(index) {
        if (index < 0 || index >= this._runtimeKeyframes.length) return;

        if (this._isPlaying) {
            this._stopPlayback(false, false);
        }

        const kf = this._runtimeKeyframes[index];
        this._selectedIndex = index;
        this._setTimelineProgress(kf.time);
        this._playTime = this._getDuration() * kf.time;
        this._applyCameraTransform(kf.position, kf.quaternion);
        this.app.needsRedraw = true;
    }

    _setTimelineProgress(progress) {
        this._timelineProgress = this._clampNumber(progress, 0, 1, 0);
        this._updateTimelineWidgets();
    }

    _updateTimelineWidgets() {
        if (!this._timeline) return;

        const duration = this._getDuration();

        const playhead = this._timeline.querySelector("#scp-timeline-playhead");
        if (playhead) {
            playhead.style.left = `${(this._timelineProgress * 100).toFixed(3)}%`;
        }

        const nowLabel = this._timeline.querySelector("#scp-time-now");
        if (nowLabel) {
            const displayProgress = this._isTimelineHoverVisible ? this._timelineHoverProgress : this._timelineProgress;
            nowLabel.textContent = `${(duration * displayProgress).toFixed(2)}s`;
        }
    }

    _captureCameraState() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return null;

        return {
            position: cam.getPosition().clone(),
            quaternion: cam.getRotation().clone(),
        };
    }

    _addKeyframeAtCurrentFrame() {
        this._addKeyframeAtProgress(this._timelineProgress);
    }

    _addKeyframeAtProgress(progress) {
        const state = this._captureCameraState();
        if (!state) return;

        const t = this._clampNumber(progress, 0, 1, 0);
        this._setTimelineProgress(t);
        this._playTime = this._getDuration() * t;

        const threshold = this._progressThresholdOneFrame();

        let index = this._runtimeKeyframes.findIndex((kf) => Math.abs(kf.time - t) <= threshold);

        if (index >= 0) {
            this._runtimeKeyframes[index].time = t;
            this._runtimeKeyframes[index].position = state.position;
            this._runtimeKeyframes[index].quaternion = state.quaternion;
        } else {
            this._runtimeKeyframes.push({
                time: t,
                position: state.position,
                quaternion: state.quaternion,
            });
        }

        this._sortKeyframes();
        index = this._runtimeKeyframes.findIndex((kf) => Math.abs(kf.time - t) <= threshold);
        this._selectedIndex = index >= 0 ? index : this._runtimeKeyframes.length - 1;

        this._commitPathEdits();
    }

    _deleteSelectedKeyframe() {
        this._deleteKeyframeAtIndex(this._selectedIndex);
    }

    _deleteKeyframeAtIndex(index) {
        if (index < 0 || index >= this._runtimeKeyframes.length) return;

        this._runtimeKeyframes.splice(index, 1);

        if (this._runtimeKeyframes.length === 0) {
            this._selectedIndex = -1;
        } else if (index === this._selectedIndex) {
            this._selectedIndex = Math.min(index, this._runtimeKeyframes.length - 1);
        } else if (index < this._selectedIndex) {
            this._selectedIndex -= 1;
        }

        this._setTimelineProgress(this._getSelectedProgress());
        this._commitPathEdits();
    }

    _progressThresholdOneFrame() {
        const frames = Math.max(1, Math.round(this._getDuration() * 30));
        return 1 / frames;
    }

    _commitPathEdits() {
        this.keyframes = this._serializeRuntimeKeyframes(this._runtimeKeyframes);
        this._schedulePersist();
        this._renderTimeline();
    }

    _schedulePersist() {
        if (!ArrivalSpace.isOwner()) return;

        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
        }

        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            this._persistNow();
        }, 500);
    }

    async _persistNow() {
        const userModelScript = this.entity.parent?.script?.userModelEntity;
        if (!userModelScript?.upload) return;

        try {
            await userModelScript.upload();
        } catch (err) {
            console.error("SimpleCameraPath: failed to persist path edits", err);
        }
    }

    _startPlayback(fromStart, restoreOnStop) {
        if (!this.enabledPath) return;
        if (this._runtimeKeyframes.length < 2) return;

        const duration = this._getDuration();
        this._playbackRestoreOnStop = restoreOnStop !== false;

        this._saveCameraState();
        this._detachCameraForPlayback();

        this._disableCameraScripts();

        if (fromStart) {
            this._playTime = 0;
        } else if (this._playTime >= duration - 1e-4) {
            this._playTime = 0;
        }

        this._setTimelineProgress(duration > 0 ? this._playTime / duration : 0);
        this._isPlaying = true;
    }

    _stopPlayback(restoreCamera, resetPlayTime) {
        this._isPlaying = false;

        if (resetPlayTime !== false) {
            this._playTime = 0;
            this._setTimelineProgress(0);
        }

        if (restoreCamera) {
            this._restoreCameraState();
        } else {
            if (this._hasSavedCameraState) {
                this._restoreCameraParentRelationship(false);
            }
            this._clearSavedCameraState();
            this._enableCameraScripts();
        }
    }

    _saveCameraState() {
        if (this._hasSavedCameraState) return;

        const cam = ArrivalSpace.getCamera();
        if (!cam) return;

        this._hasSavedCameraState = true;
        this._savedCameraPos = cam.getPosition().clone();
        this._savedCameraRot = cam.getRotation().clone();
        this._savedCameraParent = cam.parent || null;
        this._savedCameraLocalPos = cam.getLocalPosition().clone();
        this._savedCameraLocalRot = cam.getLocalRotation().clone();
        this._savedCameraLocalScale = cam.getLocalScale().clone();
    }

    _clearSavedCameraState() {
        this._savedCameraPos = null;
        this._savedCameraRot = null;
        this._savedCameraParent = null;
        this._savedCameraLocalPos = null;
        this._savedCameraLocalRot = null;
        this._savedCameraLocalScale = null;
        this._hasSavedCameraState = false;
    }

    _detachCameraForPlayback() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return;

        const parent = cam.parent;
        if (!parent || parent === this.app.root) return;

        const worldPos = cam.getPosition().clone();
        const worldRot = cam.getRotation().clone();

        this.app.root.addChild(cam);
        cam.setPosition(worldPos);
        cam.setRotation(worldRot);
    }

    _restoreCameraParentRelationship(restoreOriginalLocal) {
        if (!this._hasSavedCameraState) return false;

        const cam = ArrivalSpace.getCamera();
        if (!cam) return false;

        const savedParent = this._savedCameraParent;
        const targetParent = savedParent && typeof savedParent.addChild === "function" ? savedParent : this.app.root;
        const worldPos = cam.getPosition().clone();
        const worldRot = cam.getRotation().clone();

        if (cam.parent !== targetParent) {
            targetParent.addChild(cam);
        }

        const canRestoreLocal =
            restoreOriginalLocal && this._savedCameraLocalPos && this._savedCameraLocalRot && this._savedCameraLocalScale;

        if (canRestoreLocal) {
            cam.setLocalPosition(this._savedCameraLocalPos);
            cam.setLocalRotation(this._savedCameraLocalRot);
            cam.setLocalScale(this._savedCameraLocalScale);
            return true;
        }

        cam.setPosition(worldPos);
        cam.setRotation(worldRot);
        return false;
    }

    _restoreCameraState() {
        if (!this._hasSavedCameraState) {
            this._enableCameraScripts();
            return;
        }

        const cam = ArrivalSpace.getCamera();
        if (!cam) {
            this._clearSavedCameraState();
            this._enableCameraScripts();
            return;
        }

        const restoredLocal = this._restoreCameraParentRelationship(true);

        if (!restoredLocal && this._savedCameraPos) {
            cam.setPosition(this._savedCameraPos);
        }
        if (!restoredLocal && this._savedCameraRot) {
            cam.setRotation(this._savedCameraRot);
        }

        this._clearSavedCameraState();

        this._enableCameraScripts();
    }

    _disableCameraScripts() {
        const cam = ArrivalSpace.getCamera();
        if (!cam?.script) return;

        this._disabledCameraScripts = [];
        const scriptNames = ["orbitCamera", "freeCam", "cameraMovement", "cameraScript"];

        for (const name of scriptNames) {
            const script = cam.script[name];
            if (script && script.enabled) {
                script.enabled = false;
                this._disabledCameraScripts.push(name);
            }
        }
    }

    _enableCameraScripts() {
        const cam = ArrivalSpace.getCamera();
        if (!cam?.script) return;

        for (const name of this._disabledCameraScripts) {
            const script = cam.script[name];
            if (script) {
                script.enabled = true;
            }
        }

        this._disabledCameraScripts = [];
    }

    _applyCameraTransform(position, quaternion) {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return;

        cam.setPosition(position);
        cam.setRotation(quaternion);
    }

    _onUpdate(dt) {
        if (this._isPlaying) {
            const duration = this._getDuration();
            const speed = this._clampNumber(this.playbackSpeed, 0.1, 4, 1);

            this._playTime += dt * speed;
            let progress = this._playTime / duration;

            if (progress >= 1) {
                if (this.loop) {
                    progress = progress % 1;
                    this._playTime = duration * progress;
                } else {
                    this._applyInterpolatedCamera(1);
                    this._setTimelineProgress(1);
                    this._stopPlayback(this._playbackRestoreOnStop, false);
                    this._renderTimeline();
                    return;
                }
            }

            this._applyInterpolatedCamera(progress);
            this._setTimelineProgress(progress);
            this.app.needsRedraw = true;
        }

        if (this._editorOpen && this.previewPath && this._runtimeKeyframes.length > 0) {
            this._drawPathPreview();
            this.app.needsRedraw = true;
        }
    }

    _applyInterpolatedCamera(progress) {
        const sample = this._sampleAtProgress(progress);
        if (!sample) return;

        this._applyCameraTransform(sample.position, sample.quaternion);
    }

    _sampleAtProgress(progress) {
        const keys = this._runtimeKeyframes;
        const count = keys.length;

        if (count === 0) return null;
        if (count === 1) {
            return {
                position: keys[0].position.clone(),
                quaternion: keys[0].quaternion.clone(),
            };
        }

        const t = this._clampNumber(progress, 0, 1, 0);

        if (t <= keys[0].time) {
            return {
                position: keys[0].position.clone(),
                quaternion: keys[0].quaternion.clone(),
            };
        }

        if (t >= keys[count - 1].time) {
            return {
                position: keys[count - 1].position.clone(),
                quaternion: keys[count - 1].quaternion.clone(),
            };
        }

        let idx = 0;
        for (let i = 0; i < count - 1; i++) {
            if (t >= keys[i].time && t <= keys[i + 1].time) {
                idx = i;
                break;
            }
        }

        const k1 = keys[idx];
        const k2 = keys[idx + 1];
        const denom = Math.max(1e-6, k2.time - k1.time);
        const localT = (t - k1.time) / denom;

        const i0 = Math.max(0, idx - 1);
        const i3 = Math.min(count - 1, idx + 2);

        const p0 = keys[i0].position;
        const p1 = k1.position;
        const p2 = k2.position;
        const p3 = keys[i3].position;

        const position = this._catmullRomVec3(p0, p1, p2, p3, localT);
        const quaternion = new pc.Quat().slerp(k1.quaternion, k2.quaternion, localT);

        return { position, quaternion };
    }

    _catmullRomVec3(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;

        const x =
            0.5 *
            (2 * p1.x +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

        const y =
            0.5 *
            (2 * p1.y +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

        const z =
            0.5 *
            (2 * p1.z +
                (-p0.z + p2.z) * t +
                (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
                (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

        return new pc.Vec3(x, y, z);
    }

    _drawPathPreview() {
        const keys = this._runtimeKeyframes;
        if (keys.length === 0) return;

        const pathColor = this._hexToColor(this.pathColor);
        const selectedColor = this._hexToColor(this.selectedColor);
        const normalColor = this._hexToColor("#94a3b8");

        if (keys.length >= 2) {
            for (let i = 0; i < keys.length - 1; i++) {
                const kfA = keys[i];
                const kfB = keys[i + 1];

                const span = Math.max(1e-6, kfB.time - kfA.time);
                const samples = 16;
                for (let s = 0; s < samples; s++) {
                    const tA = kfA.time + (span * s) / samples;
                    const tB = kfA.time + (span * (s + 1)) / samples;
                    const a = this._sampleAtProgress(tA);
                    const b = this._sampleAtProgress(tB);
                    if (a && b) {
                        this.app.drawLine(a.position, b.position, pathColor);
                    }
                }
            }
        }

        for (let i = 0; i < keys.length; i++) {
            const color = i === this._selectedIndex ? selectedColor : normalColor;
            this._drawCross(keys[i].position, i === this._selectedIndex ? 0.1 : 0.07, color);
        }
    }

    _drawCross(center, size, color) {
        const x0 = center.clone().add(new pc.Vec3(-size, 0, 0));
        const x1 = center.clone().add(new pc.Vec3(size, 0, 0));
        const y0 = center.clone().add(new pc.Vec3(0, -size, 0));
        const y1 = center.clone().add(new pc.Vec3(0, size, 0));
        const z0 = center.clone().add(new pc.Vec3(0, 0, -size));
        const z1 = center.clone().add(new pc.Vec3(0, 0, size));

        this.app.drawLine(x0, x1, color);
        this.app.drawLine(y0, y1, color);
        this.app.drawLine(z0, z1, color);
    }

    _deserializeKeyframes(raw) {
        if (!Array.isArray(raw)) return [];

        const parsed = [];
        for (const item of raw) {
            const p = item?.position;
            const q = item?.quaternion;

            if (!this._isVec3Like(p) || !this._isQuatLike(q)) continue;

            const rawTime = Number(item?.time);
            parsed.push({
                time: Number.isFinite(rawTime) ? rawTime : null,
                position: new pc.Vec3(p.x, p.y, p.z),
                quaternion: new pc.Quat(q.x, q.y, q.z, q.w),
            });
        }

        if (parsed.length === 0) return [];

        const hasMissingTimes = parsed.some((kf) => kf.time == null);
        if (hasMissingTimes) {
            const last = Math.max(1, parsed.length - 1);
            for (let i = 0; i < parsed.length; i++) {
                parsed[i].time = i / last;
            }
        }

        for (const kf of parsed) {
            kf.time = this._clampNumber(kf.time, 0, 1, 0);
        }

        parsed.sort((a, b) => a.time - b.time);
        return parsed;
    }

    _serializeRuntimeKeyframes(runtimeKeyframes) {
        return runtimeKeyframes.map((kf) => ({
            time: parseFloat(kf.time.toFixed(6)),
            position: {
                x: parseFloat(kf.position.x.toFixed(5)),
                y: parseFloat(kf.position.y.toFixed(5)),
                z: parseFloat(kf.position.z.toFixed(5)),
            },
            quaternion: {
                x: parseFloat(kf.quaternion.x.toFixed(7)),
                y: parseFloat(kf.quaternion.y.toFixed(7)),
                z: parseFloat(kf.quaternion.z.toFixed(7)),
                w: parseFloat(kf.quaternion.w.toFixed(7)),
            },
        }));
    }

    _sortKeyframes() {
        this._runtimeKeyframes.sort((a, b) => a.time - b.time);
    }

    _selectInitialKeyframe() {
        if (this._runtimeKeyframes.length === 0) {
            this._selectedIndex = -1;
            return;
        }

        if (this._selectedIndex < 0 || this._selectedIndex >= this._runtimeKeyframes.length) {
            this._selectedIndex = 0;
        }
    }

    _getSelectedProgress() {
        if (this._selectedIndex < 0 || this._selectedIndex >= this._runtimeKeyframes.length) {
            return this._timelineProgress;
        }

        return this._runtimeKeyframes[this._selectedIndex].time;
    }

    _getDuration() {
        return this._clampNumber(this.duration, 0.1, 120, 8);
    }

    _isVec3Like(v) {
        return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    }

    _isQuatLike(q) {
        return q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
    }

    _clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    }

    _hexToColor(hex) {
        const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
        if (!match) return new pc.Color(1, 1, 1);

        return new pc.Color(
            parseInt(match[1], 16) / 255,
            parseInt(match[2], 16) / 255,
            parseInt(match[3], 16) / 255,
        );
    }
}
