/**
 * Camera Path Editor Plugin
 *
 * Multi-path camera animation system with per-space storage, auto-play intro,
 * Catmull-Rom spline interpolation, 3D path visualization, and JSON export.
 *
 * - Paths are saved per-space using the room ID
 * - Multiple paths per space, with one marked as primary (intro path)
 * - Primary path auto-plays on load (no editor visible)
 * - Editor UI hidden by default — opened via "Edit Paths" button (owner only)
 */

export class CameraPathEditorPlugin extends ArrivalScript {
    static scriptName = "cameraPathEditorPlugin";

    // ═══════════════════════════════════════════════════════════
    // PROPERTIES
    // ═══════════════════════════════════════════════════════════

    enablePaths = true;
    accentColor = "#f59e0b"; // Amber accent
    pathColor = "#f59e0b";
    frustumColor = "#888888";
    frustumSelectedColor = "#f59e0b";

    static properties = {
        enablePaths: { title: "Enable Camera Paths" },
        accentColor: { title: "Accent Color" },
        pathColor: { title: "Path Color" },
        frustumColor: { title: "Frustum Color" },
        frustumSelectedColor: { title: "Selected Frustum Color" },
    };

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    // Path index & multi-path
    _roomId = null;
    _pathIndex = null; // { version, primaryPath, paths: [] }
    _currentPathSlug = null; // which path is loaded for editing
    _editorOpen = false;
    _introPlaying = false; // true when primary path is auto-playing

    // Editor panel
    _panel = null;

    // Floating buttons
    _floatingBtnContainer = null;

    // Keyframe state (for currently loaded path)
    _keyframes = [];
    _nextId = 1;
    _duration = 10; // seconds
    _fps = 30;
    _totalFrames = 300;
    _currentFrame = 0;
    _isPlaying = false;
    _playbackSpeed = 1;
    _selectedKeyframeId = null;

    // Camera takeover
    _savedCameraPos = null;
    _savedCameraRot = null;
    _cameraScriptsDisabled = [];

    // Drag state
    _isDraggingPlayhead = false;
    _isDraggingKeyframe = false;
    _dragKeyframeId = null;

    // Save state
    _isSaving = false;

    // Bound handlers (for cleanup)
    _boundMouseMove = null;
    _boundMouseUp = null;
    _boundUpdate = null;

    // ═══════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    initialize() {
        this._boundMouseMove = (e) => this._onDocumentMouseMove(e);
        this._boundMouseUp = (e) => this._onDocumentMouseUp(e);
        this._boundUpdate = (dt) => this._onUpdate(dt);

        this.app.on("update", this._boundUpdate);

        // Room ID may not be available yet at init time — retry with delay
        this._tryActivate(0);
    }

    _tryActivate(attempt) {
        this._roomId = this._getRoomId();
        if (!this._roomId) {
            if (attempt < 10) {
                // Retry with increasing delay (100ms, 200ms, ... up to 1s)
                setTimeout(() => this._tryActivate(attempt + 1), Math.min(100 * (attempt + 1), 1000));
            } else {
                console.warn("Camera Path Editor: No room ID found after retries, plugin inactive.");
            }
            return;
        }

        if (this.enablePaths) {
            this._activate().catch((err) => {
                console.error("Camera Path Editor: Activation failed.", err);
            });
        }
    }

    destroy() {
        this._deactivate();

        if (this._boundUpdate) {
            this.app.off("update", this._boundUpdate);
        }

        document.removeEventListener("mousemove", this._boundMouseMove);
        document.removeEventListener("mouseup", this._boundMouseUp);
    }

    onPropertyChanged(name, value) {
        if (name === "enablePaths") {
            if (value) {
                this._activate().catch((err) => {
                    console.error("Camera Path Editor: Activation failed.", err);
                });
            } else {
                this._deactivate();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ACTIVATE / DEACTIVATE
    // ═══════════════════════════════════════════════════════════

    async _activate() {
        this._roomId = this._getRoomId();
        if (!this._roomId) {
            console.warn("Camera Path Editor: _activate called but no room ID");
            return;
        }

        console.log("Camera Path Editor: Activating for room", this._roomId,
            "| isOwner:", ArrivalSpace.isOwner(),
            "| owner.id:", pc.app.customTravelCenter?.owner?.id,
            "| myId:", pc.app.userProfileData?.userID);

        await this._loadPathIndex();
        this._showFloatingButtons();

        if (this._pathIndex?.primaryPath) {
            const loaded = await this._loadPath(this._pathIndex.primaryPath);
            if (loaded && this._keyframes.length >= 2) {
                this._playIntro();
            }
        }
    }

    _deactivate() {
        this._stopPlayback();
        this._restoreCamera();
        this._closeEditor();
        this._removeFloatingButtons();
        this._introPlaying = false;
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    _getRoomId() {
        return ArrivalSpace.getRoom()?.roomId || null;
    }

    _getOwnerId() {
        return ArrivalSpace.getRoom()?.owner?.id || null;
    }

    _slugify(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "path-" + Date.now();
    }

    _storagePath(fileName) {
        return `camera-paths/${this._roomId}/${fileName}`;
    }

    // ═══════════════════════════════════════════════════════════
    // PATH INDEX (paths.json)
    // ═══════════════════════════════════════════════════════════

    async _loadPathIndex() {
        this._pathIndex = { version: 1, primaryPath: null, paths: [] };

        const ownerId = this._getOwnerId();
        if (!ownerId) return;

        try {
            const resp = await ArrivalSpace.loadUserFile(this._storagePath("paths.json"), ownerId);
            if (resp && resp.ok) {
                const data = await resp.json();
                if (data && data.paths) {
                    this._pathIndex = data;
                }
            }
        } catch (err) {
            // No index yet — use empty default
        }
    }

    async _savePathIndex() {
        if (!ArrivalSpace.saveUserFile) return false;
        try {
            const json = JSON.stringify(this._pathIndex, null, 2);
            await ArrivalSpace.saveUserFile(this._storagePath("paths.json"), json);
            return true;
        } catch (err) {
            console.error("Camera Path Editor: Failed to save path index.", err);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PATH CRUD
    // ═══════════════════════════════════════════════════════════

    async _createPath(name) {
        const slug = this._slugify(name);

        // Ensure unique slug
        let finalSlug = slug;
        let counter = 2;
        while (this._pathIndex.paths.some((p) => p.slug === finalSlug)) {
            finalSlug = `${slug}-${counter++}`;
        }

        this._pathIndex.paths.push({
            slug: finalSlug,
            name: name,
            created: Date.now(),
        });
        await this._savePathIndex();

        // Save empty path data
        this._keyframes = [];
        this._nextId = 1;
        this._duration = 10;
        this._fps = 30;
        this._totalFrames = 300;
        this._currentFrame = 0;
        this._selectedKeyframeId = null;
        await this._saveCurrentPath(finalSlug);

        this._currentPathSlug = finalSlug;
        return finalSlug;
    }

    async _renamePath(slug, newName) {
        const entry = this._pathIndex.paths.find((p) => p.slug === slug);
        if (entry) {
            entry.name = newName;
            await this._savePathIndex();
        }
    }

    async _deletePath(slug) {
        // Remove from index
        this._pathIndex.paths = this._pathIndex.paths.filter((p) => p.slug !== slug);

        // Clear primary if deleted
        if (this._pathIndex.primaryPath === slug) {
            this._pathIndex.primaryPath = null;
        }

        await this._savePathIndex();

        // Delete the file
        try {
            await ArrivalSpace.deletePluginFile(this._storagePath(`${slug}.json`));
        } catch (err) {
            // File may not exist
        }

        // If we deleted the current path, switch to another or clear
        if (this._currentPathSlug === slug) {
            this._currentPathSlug = null;
            this._keyframes = [];
            this._selectedKeyframeId = null;

            if (this._pathIndex.paths.length > 0) {
                await this._loadPath(this._pathIndex.paths[0].slug);
            }
        }

        this._updateFloatingButtons();
    }

    async _loadPath(slug) {
        const ownerId = this._getOwnerId();
        if (!ownerId) return false;

        try {
            const resp = await ArrivalSpace.loadUserFile(this._storagePath(`${slug}.json`), ownerId);
            if (!resp || !resp.ok) return false;

            const data = await resp.json();
            if (!data || !data.keyframes) return false;

            this._duration = data.duration || 10;
            this._fps = data.fps || 30;
            this._totalFrames = Math.round(this._duration * this._fps);
            this._currentFrame = 0;
            this._keyframes = [];
            this._nextId = 1;
            this._selectedKeyframeId = null;

            for (const kfData of data.keyframes) {
                const kf = {
                    id: this._nextId++,
                    frame: Math.min(kfData.frame, this._totalFrames),
                    position: new pc.Vec3(kfData.position.x, kfData.position.y, kfData.position.z),
                    eulerAngles: { x: kfData.rotation.x, y: kfData.rotation.y, z: kfData.rotation.z },
                    quaternion: kfData.quaternion
                        ? new pc.Quat(kfData.quaternion.x, kfData.quaternion.y, kfData.quaternion.z, kfData.quaternion.w)
                        : new pc.Quat().setFromEulerAngles(kfData.rotation.x, kfData.rotation.y, kfData.rotation.z),
                };
                this._keyframes.push(kf);
            }

            this._sortKeyframes();
            this._currentPathSlug = slug;
            return true;
        } catch (err) {
            console.warn("Camera Path Editor: Failed to load path", slug, err);
            return false;
        }
    }

    _buildSaveData() {
        return {
            version: 1,
            duration: this._duration,
            fps: this._fps,
            totalFrames: this._totalFrames,
            interpolation: "catmull-rom",
            keyframes: this._keyframes.map((kf) => ({
                frame: kf.frame,
                time: parseFloat(this._frameToTime(kf.frame).toFixed(4)),
                position: {
                    x: parseFloat(kf.position.x.toFixed(4)),
                    y: parseFloat(kf.position.y.toFixed(4)),
                    z: parseFloat(kf.position.z.toFixed(4)),
                },
                rotation: {
                    x: parseFloat(kf.eulerAngles.x.toFixed(4)),
                    y: parseFloat(kf.eulerAngles.y.toFixed(4)),
                    z: parseFloat(kf.eulerAngles.z.toFixed(4)),
                },
                quaternion: {
                    x: parseFloat(kf.quaternion.x.toFixed(6)),
                    y: parseFloat(kf.quaternion.y.toFixed(6)),
                    z: parseFloat(kf.quaternion.z.toFixed(6)),
                    w: parseFloat(kf.quaternion.w.toFixed(6)),
                },
            })),
        };
    }

    async _saveCurrentPath(slug) {
        const targetSlug = slug || this._currentPathSlug;
        if (!targetSlug) return false;
        if (!ArrivalSpace.saveUserFile) return false;

        try {
            const data = this._buildSaveData();
            const json = JSON.stringify(data, null, 2);
            await ArrivalSpace.saveUserFile(this._storagePath(`${targetSlug}.json`), json);
            return true;
        } catch (err) {
            console.error("Camera Path Editor: Failed to save path.", err);
            return false;
        }
    }

    async _setPrimary(slug) {
        this._pathIndex.primaryPath = slug || null;
        await this._savePathIndex();
        this._updateFloatingButtons();
    }

    // ═══════════════════════════════════════════════════════════
    // FLOATING BUTTONS
    // ═══════════════════════════════════════════════════════════

    _showFloatingButtons() {
        this._removeFloatingButtons();

        const isOwner = ArrivalSpace.isOwner();
        const hasPrimary = !!this._pathIndex?.primaryPath;

        // Visitor with no primary → nothing to show
        if (!isOwner && !hasPrimary) return;

        this._floatingBtnContainer = this.createUI("div", {
            id: "cpe-floating-btns",
            style: {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                display: "flex",
                gap: "8px",
                zIndex: "1000",
            },
        });

        this._renderFloatingButtons();
    }

    _renderFloatingButtons() {
        if (!this._floatingBtnContainer) return;

        const isOwner = ArrivalSpace.isOwner();
        const hasPrimary = !!this._pathIndex?.primaryPath;
        const accent = this.accentColor;

        let html = "";

        // Play/Pause button — visible to everyone when primary exists
        if (hasPrimary) {
            const icon = this._introPlaying || this._isPlaying ? "||" : "\u25B6";
            html += `<button id="cpe-float-play" title="Play/Pause intro path" style="
                width: 40px; height: 40px; border: none; border-radius: 10px;
                background: rgba(20, 20, 28, 0.85); backdrop-filter: blur(10px);
                color: ${accent}; font-size: 16px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 2px 10px rgba(0,0,0,0.4); transition: background 0.15s;
            ">${icon}</button>`;
        }

        // Edit button — owner only
        if (isOwner) {
            html += `<button id="cpe-float-edit" title="Edit Paths" style="
                height: 40px; border: none; border-radius: 10px;
                background: rgba(20, 20, 28, 0.85); backdrop-filter: blur(10px);
                color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 600;
                cursor: pointer; padding: 0 14px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.4); transition: background 0.15s;
                display: flex; align-items: center; gap: 6px;
            "><span style="color:${accent};">\u270E</span> Edit Paths</button>`;
        }

        this._floatingBtnContainer.innerHTML = html;

        // Event handlers
        const playBtn = this._floatingBtnContainer.querySelector("#cpe-float-play");
        if (playBtn) {
            playBtn.onmouseenter = () => { playBtn.style.background = "rgba(40, 40, 50, 0.95)"; };
            playBtn.onmouseleave = () => { playBtn.style.background = "rgba(20, 20, 28, 0.85)"; };
            playBtn.onclick = () => this._toggleIntroPlayback();
        }

        const editBtn = this._floatingBtnContainer.querySelector("#cpe-float-edit");
        if (editBtn) {
            editBtn.onmouseenter = () => { editBtn.style.background = "rgba(40, 40, 50, 0.95)"; };
            editBtn.onmouseleave = () => { editBtn.style.background = "rgba(20, 20, 28, 0.85)"; };
            editBtn.onclick = () => this._openEditor();
        }
    }

    _updateFloatingButtons() {
        if (this._floatingBtnContainer) {
            this._renderFloatingButtons();
        } else {
            this._showFloatingButtons();
        }
    }

    _updateFloatingPlayButton() {
        const btn = this._floatingBtnContainer?.querySelector("#cpe-float-play");
        if (btn) {
            btn.textContent = this._introPlaying || this._isPlaying ? "||" : "\u25B6";
        }
    }

    _removeFloatingButtons() {
        if (this._floatingBtnContainer) {
            this._floatingBtnContainer.remove();
            this._floatingBtnContainer = null;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // INTRO PLAYBACK
    // ═══════════════════════════════════════════════════════════

    _playIntro() {
        if (this._keyframes.length < 2) return;

        this._saveCamera();
        this._disableCameraScripts();
        this._introPlaying = true;
        this._isPlaying = true;
        this._currentFrame = 0;
        this._playbackSpeed = 1;
        this._updateFloatingPlayButton();
    }

    _toggleIntroPlayback() {
        if (this._introPlaying || this._isPlaying) {
            // Stop
            this._stopPlayback();
            this._restoreCamera();
            this._introPlaying = false;
            this._updateFloatingPlayButton();
        } else {
            // Start/replay primary path
            if (this._pathIndex?.primaryPath) {
                this._loadPath(this._pathIndex.primaryPath).then((loaded) => {
                    if (loaded && this._keyframes.length >= 2) {
                        this._playIntro();
                    }
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // EDITOR OPEN / CLOSE
    // ═══════════════════════════════════════════════════════════

    async _openEditor() {
        if (this._editorOpen) return;

        // Stop intro if playing
        if (this._introPlaying) {
            this._stopPlayback();
            this._restoreCamera();
            this._introPlaying = false;
            this._updateFloatingPlayButton();
        }

        this._editorOpen = true;

        // If no paths exist, auto-create one
        if (this._pathIndex.paths.length === 0) {
            await this._createPath("Untitled Path");
        }

        // Load first path if none loaded
        if (!this._currentPathSlug && this._pathIndex.paths.length > 0) {
            await this._loadPath(this._pathIndex.paths[0].slug);
        }

        this._totalFrames = Math.round(this._duration * this._fps);

        this._panel = this.createUI("div", {
            id: "camera-path-editor",
            style: {
                position: "fixed",
                bottom: "0",
                left: "0",
                width: "100%",
                background: "rgba(20, 20, 28, 0.95)",
                backdropFilter: "blur(10px)",
                color: "white",
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                fontSize: "13px",
                boxShadow: "0 -4px 20px rgba(0,0,0,0.5)",
                zIndex: "1001",
                userSelect: "none",
                display: "flex",
                flexDirection: "column",
            },
        });

        this._renderFullUI();
    }

    _closeEditor() {
        if (!this._editorOpen) return;

        this._stopPlayback();
        this._restoreCamera();
        this._editorOpen = false;

        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }

        this.unlockInput();
        this.unlockKeyboard();
    }

    // ═══════════════════════════════════════════════════════════
    // EDITOR UI
    // ═══════════════════════════════════════════════════════════

    _renderFullUI() {
        if (!this._panel) return;

        const accent = this.accentColor;
        const selectedKF = this._getSelectedKeyframe();
        const frameDisplay = `${this._currentFrame} / ${this._totalFrames}`;
        const currentEntry = this._pathIndex.paths.find((p) => p.slug === this._currentPathSlug);
        const isPrimary = this._pathIndex.primaryPath === this._currentPathSlug;

        this._panel.innerHTML = `
            <!-- Path Management Bar -->
            <div id="cpe-path-bar" style="
                display: flex; align-items: center; gap: 8px;
                padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.1);
                flex-wrap: wrap;
            ">
                <span style="color: rgba(255,255,255,0.5); font-size: 12px; font-weight: 600;">Path:</span>

                <select id="cpe-path-select" style="
                    background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
                    max-width: 200px;
                ">
                    ${this._pathIndex.paths
                        .map(
                            (p) =>
                                `<option value="${p.slug}" ${p.slug === this._currentPathSlug ? "selected" : ""} style="background:#1e1e28;">${p.name}${this._pathIndex.primaryPath === p.slug ? " \u2605" : ""}</option>`
                        )
                        .join("")}
                </select>

                <button id="cpe-path-new" style="
                    padding: 4px 10px; border: 1px solid ${accent}; border-radius: 6px;
                    background: transparent; color: ${accent}; font-size: 11px; font-weight: 600;
                    cursor: pointer;
                ">+ New</button>

                <button id="cpe-path-rename" style="
                    padding: 4px 10px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;
                    background: transparent; color: rgba(255,255,255,0.6); font-size: 11px;
                    cursor: pointer;
                ">Rename</button>

                <button id="cpe-path-delete" style="
                    padding: 4px 10px; border: 1px solid #ef4444; border-radius: 6px;
                    background: transparent; color: #ef4444; font-size: 11px;
                    cursor: pointer;
                ">Delete</button>

                <button id="cpe-path-primary" style="
                    padding: 4px 10px; border: 1px solid ${isPrimary ? accent : "rgba(255,255,255,0.2)"}; border-radius: 6px;
                    background: ${isPrimary ? accent : "transparent"}; color: ${isPrimary ? "#000" : "rgba(255,255,255,0.6)"}; font-size: 11px; font-weight: 600;
                    cursor: pointer;
                ">${isPrimary ? "\u2605 Primary" : "\u2606 Set Primary"}</button>

                <div style="flex:1;"></div>

                <button id="cpe-close" title="Close Editor" style="
                    width: 28px; height: 28px; border: none; border-radius: 6px;
                    background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); font-size: 16px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                ">\u2715</button>
            </div>

            <!-- Controls Bar -->
            <div id="cpe-controls" style="
                display: flex; align-items: center; gap: 10px;
                padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.1);
                flex-wrap: wrap;
            ">
                <button id="cpe-play" title="Play / Pause" style="
                    width: 32px; height: 32px; border: none; border-radius: 6px;
                    background: ${accent}; color: #000; font-size: 14px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                    font-weight: bold;
                ">${this._isPlaying ? "||" : "\u25B6"}</button>

                <select id="cpe-speed" title="Playback Speed" style="
                    background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer;
                ">
                    ${[0.25, 0.5, 1, 2, 4]
                        .map(
                            (s) =>
                                `<option value="${s}" ${s === this._playbackSpeed ? "selected" : ""} style="background:#1e1e28;">${s}x</option>`
                        )
                        .join("")}
                </select>

                <label style="display:flex; align-items:center; gap:4px; color:rgba(255,255,255,0.7); font-size:12px;">
                    Dur:
                    <input id="cpe-duration" type="number" value="${this._duration}" min="1" max="300" step="0.5" style="
                        width: 56px; background: rgba(255,255,255,0.1); color: white;
                        border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
                        padding: 3px 6px; font-size: 12px; text-align: center;
                    ">s
                </label>

                <label style="display:flex; align-items:center; gap:4px; color:rgba(255,255,255,0.7); font-size:12px;">
                    FPS:
                    <select id="cpe-fps" style="
                        background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);
                        border-radius: 4px; padding: 3px 6px; font-size: 12px; cursor: pointer;
                    ">
                        ${[24, 30, 60]
                            .map(
                                (f) =>
                                    `<option value="${f}" ${f === this._fps ? "selected" : ""} style="background:#1e1e28;">${f}</option>`
                            )
                            .join("")}
                    </select>
                </label>

                <span id="cpe-frame-counter" style="color:rgba(255,255,255,0.5); font-size:12px; min-width:90px;">
                    Frame: ${frameDisplay}
                </span>

                <div style="flex:1;"></div>

                <button id="cpe-add-kf" style="
                    padding: 5px 12px; border: 1px solid ${accent}; border-radius: 6px;
                    background: transparent; color: ${accent}; font-size: 12px; font-weight: 600;
                    cursor: pointer; transition: background 0.15s;
                ">+ Add KF</button>

                <button id="cpe-save" style="
                    padding: 5px 12px; border: 1px solid #22c55e; border-radius: 6px;
                    background: transparent; color: #22c55e; font-size: 12px; font-weight: 600;
                    cursor: pointer;
                ">${this._isSaving ? "Saving..." : "Save"}</button>

                <button id="cpe-export" style="
                    padding: 5px 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
                    background: transparent; color: rgba(255,255,255,0.7); font-size: 12px; font-weight: 600;
                    cursor: pointer;
                ">Export</button>
            </div>

            <!-- Timeline Track -->
            <div id="cpe-timeline" style="
                position: relative; height: 60px; padding: 0 14px;
                border-bottom: 1px solid rgba(255,255,255,0.1); overflow: hidden;
            ">
                <!-- Time markers -->
                <div id="cpe-time-markers" style="
                    position: absolute; top: 4px; left: 14px; right: 14px; height: 16px;
                    display: flex; justify-content: space-between;
                    color: rgba(255,255,255,0.35); font-size: 10px; pointer-events: none;
                ">
                    ${this._renderTimeMarkers()}
                </div>

                <!-- Track area -->
                <div id="cpe-track" style="
                    position: absolute; top: 24px; left: 14px; right: 14px; height: 28px;
                    background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer;
                ">
                    <!-- Track line -->
                    <div style="
                        position: absolute; top: 50%; left: 0; right: 0; height: 2px;
                        background: rgba(255,255,255,0.15); transform: translateY(-50%);
                    "></div>

                    <!-- Keyframe diamonds -->
                    ${this._renderKeyframeDiamonds()}

                    <!-- Playhead -->
                    <div id="cpe-playhead" style="
                        position: absolute; top: -2px; bottom: -2px; width: 2px;
                        background: #ef4444; left: ${this._frameToPercent(this._currentFrame)}%;
                        pointer-events: none; z-index: 2;
                    ">
                        <div style="
                            position: absolute; top: -6px; left: 50%; transform: translateX(-50%);
                            width: 10px; height: 10px; background: #ef4444; border-radius: 50%;
                            pointer-events: auto; cursor: ew-resize;
                        " id="cpe-playhead-handle"></div>
                    </div>
                </div>
            </div>

            <!-- Keyframe Detail Bar -->
            ${this._renderDetailBar(selectedKF)}
        `;

        this._setupEventHandlers();
    }

    _renderTimeMarkers() {
        const count = Math.min(Math.ceil(this._duration) + 1, 21);
        const step = this._duration / (count - 1);
        let html = "";
        for (let i = 0; i < count; i++) {
            const t = i * step;
            html += `<span>${t.toFixed(t % 1 === 0 ? 0 : 1)}s</span>`;
        }
        return html;
    }

    _renderKeyframeDiamonds() {
        let html = "";
        for (const kf of this._keyframes) {
            const pct = this._frameToPercent(kf.frame);
            const isSelected = kf.id === this._selectedKeyframeId;
            const color = isSelected ? this.accentColor : "rgba(255,255,255,0.7)";
            const size = isSelected ? 12 : 10;
            html += `<div class="cpe-diamond" data-kf-id="${kf.id}" style="
                position: absolute; top: 50%; left: ${pct}%;
                width: ${size}px; height: ${size}px;
                background: ${color}; transform: translate(-50%, -50%) rotate(45deg);
                cursor: pointer; z-index: 3; border-radius: 2px;
                border: ${isSelected ? "2px solid white" : "none"};
                transition: background 0.1s;
            " title="KF#${kf.id} @ ${this._frameToTime(kf.frame).toFixed(2)}s"></div>`;
        }
        return html;
    }

    _renderDetailBar(kf) {
        if (!kf) {
            return `<div id="cpe-detail" style="padding: 6px 14px; color: rgba(255,255,255,0.35); font-size: 12px;">
                No keyframe selected \u2014 click a diamond or add a new keyframe
            </div>`;
        }

        const t = this._frameToTime(kf.frame).toFixed(2);
        const accent = this.accentColor;

        const numInput = (id, val, label) => `
            <label style="display:flex; align-items:center; gap:3px; font-size:12px; color:rgba(255,255,255,0.6);">
                ${label}
                <input id="${id}" type="number" value="${val.toFixed(2)}" step="0.1" style="
                    width: 64px; background: rgba(255,255,255,0.08); color: white;
                    border: 1px solid rgba(255,255,255,0.15); border-radius: 3px;
                    padding: 2px 5px; font-size: 12px; text-align: center;
                ">
            </label>`;

        return `<div id="cpe-detail" style="
            display: flex; align-items: center; gap: 12px; padding: 8px 14px;
            flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,0.05);
        ">
            <span style="font-weight:600; color:${accent}; font-size:12px; min-width:85px;">
                KF#${kf.id} @ ${t}s
            </span>

            <span style="color:rgba(255,255,255,0.3); font-size:11px;">Pos:</span>
            ${numInput("cpe-kf-px", kf.position.x, "X")}
            ${numInput("cpe-kf-py", kf.position.y, "Y")}
            ${numInput("cpe-kf-pz", kf.position.z, "Z")}

            <span style="color:rgba(255,255,255,0.3); font-size:11px; margin-left:6px;">Rot:</span>
            ${numInput("cpe-kf-rx", kf.eulerAngles.x, "X")}
            ${numInput("cpe-kf-ry", kf.eulerAngles.y, "Y")}
            ${numInput("cpe-kf-rz", kf.eulerAngles.z, "Z")}

            <div style="flex:1;"></div>

            <button id="cpe-kf-update-cam" style="
                padding: 4px 10px; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px;
                background: transparent; color: rgba(255,255,255,0.7); font-size: 11px;
                cursor: pointer;
            ">View KF</button>

            <button id="cpe-kf-recapture" style="
                padding: 4px 10px; border: 1px solid ${accent}; border-radius: 5px;
                background: transparent; color: ${accent}; font-size: 11px; cursor: pointer;
            ">Recapture</button>

            <button id="cpe-kf-delete" style="
                padding: 4px 10px; border: 1px solid #ef4444; border-radius: 5px;
                background: transparent; color: #ef4444; font-size: 11px; cursor: pointer;
            ">Delete</button>
        </div>`;
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════

    _setupEventHandlers() {
        if (!this._panel) return;

        // --- Path management bar ---

        // Path dropdown
        const pathSelect = this._panel.querySelector("#cpe-path-select");
        if (pathSelect) {
            pathSelect.onchange = async () => {
                const slug = pathSelect.value;
                if (slug === this._currentPathSlug) return;
                // Save current path first
                if (this._currentPathSlug) {
                    await this._saveCurrentPath();
                }
                this._stopPlayback();
                await this._loadPath(slug);
                this._renderFullUI();
            };
        }

        // New path
        const newBtn = this._panel.querySelector("#cpe-path-new");
        if (newBtn) {
            newBtn.onclick = async () => {
                const name = prompt("New path name:", "Untitled Path");
                if (!name) return;
                if (this._currentPathSlug) {
                    await this._saveCurrentPath();
                }
                await this._createPath(name);
                this._renderFullUI();
            };
        }

        // Rename
        const renameBtn = this._panel.querySelector("#cpe-path-rename");
        if (renameBtn) {
            renameBtn.onclick = async () => {
                const entry = this._pathIndex.paths.find((p) => p.slug === this._currentPathSlug);
                if (!entry) return;
                const newName = prompt("Rename path:", entry.name);
                if (!newName || newName === entry.name) return;
                await this._renamePath(this._currentPathSlug, newName);
                this._renderFullUI();
            };
        }

        // Delete
        const deleteBtn = this._panel.querySelector("#cpe-path-delete");
        if (deleteBtn) {
            deleteBtn.onclick = async () => {
                if (!this._currentPathSlug) return;
                const entry = this._pathIndex.paths.find((p) => p.slug === this._currentPathSlug);
                if (!confirm(`Delete path "${entry?.name || this._currentPathSlug}"?`)) return;
                await this._deletePath(this._currentPathSlug);
                if (this._pathIndex.paths.length === 0) {
                    // Create a new empty one so editor isn't empty
                    await this._createPath("Untitled Path");
                }
                this._renderFullUI();
            };
        }

        // Set primary
        const primaryBtn = this._panel.querySelector("#cpe-path-primary");
        if (primaryBtn) {
            primaryBtn.onclick = async () => {
                if (this._pathIndex.primaryPath === this._currentPathSlug) {
                    // Unset primary
                    await this._setPrimary(null);
                } else {
                    await this._setPrimary(this._currentPathSlug);
                }
                this._renderFullUI();
            };
        }

        // Close
        const closeBtn = this._panel.querySelector("#cpe-close");
        if (closeBtn) closeBtn.onclick = () => this._closeEditor();

        // --- Controls bar ---

        // Play/Pause
        const playBtn = this._panel.querySelector("#cpe-play");
        if (playBtn) playBtn.onclick = () => this._togglePlayback();

        // Speed
        const speedSel = this._panel.querySelector("#cpe-speed");
        if (speedSel) speedSel.onchange = () => {
            this._playbackSpeed = parseFloat(speedSel.value);
        };

        // Duration
        const durInput = this._panel.querySelector("#cpe-duration");
        if (durInput) durInput.onchange = () => {
            const v = parseFloat(durInput.value);
            if (v > 0 && v <= 300) {
                this._duration = v;
                this._recalcTotalFrames();
                this._renderFullUI();
            }
        };

        // FPS
        const fpsSel = this._panel.querySelector("#cpe-fps");
        if (fpsSel) fpsSel.onchange = () => {
            this._fps = parseInt(fpsSel.value);
            this._recalcTotalFrames();
            this._renderFullUI();
        };

        // Add Keyframe
        const addBtn = this._panel.querySelector("#cpe-add-kf");
        if (addBtn) {
            addBtn.onmouseenter = () => {
                addBtn.style.background = this.accentColor;
                addBtn.style.color = "#000";
            };
            addBtn.onmouseleave = () => {
                addBtn.style.background = "transparent";
                addBtn.style.color = this.accentColor;
            };
            addBtn.onclick = () => this._addKeyframe();
        }

        // Save
        const saveBtn = this._panel.querySelector("#cpe-save");
        if (saveBtn) saveBtn.onclick = () => this._handleSave();

        // Export
        const exportBtn = this._panel.querySelector("#cpe-export");
        if (exportBtn) exportBtn.onclick = () => this._exportJSON();

        // --- Timeline track ---
        const track = this._panel.querySelector("#cpe-track");
        if (track) {
            track.onmousedown = (e) => {
                if (e.target.classList.contains("cpe-diamond")) return;

                const playheadHandle = this._panel.querySelector("#cpe-playhead-handle");
                if (e.target === playheadHandle || e.target.id === "cpe-playhead-handle") {
                    this._isDraggingPlayhead = true;
                    if (this._isPlaying) this._stopPlayback();
                    document.addEventListener("mousemove", this._boundMouseMove);
                    document.addEventListener("mouseup", this._boundMouseUp);
                    return;
                }

                const rect = track.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                this._currentFrame = Math.round(pct * this._totalFrames);
                this._updatePlayhead();
                this._updateFrameCounter();
            };
        }

        // Keyframe diamond events
        const diamonds = this._panel.querySelectorAll(".cpe-diamond");
        diamonds.forEach((diamond) => {
            const kfId = parseInt(diamond.dataset.kfId);

            diamond.onclick = (e) => {
                e.stopPropagation();
                if (this._isDraggingKeyframe) return;
                this._selectedKeyframeId = kfId;
                const kf = this._getKeyframeById(kfId);
                if (kf) this._currentFrame = kf.frame;
                this._renderFullUI();
            };

            diamond.onmousedown = (e) => {
                e.stopPropagation();
                e.preventDefault();
                this._isDraggingKeyframe = true;
                this._dragKeyframeId = kfId;
                this._selectedKeyframeId = kfId;
                if (this._isPlaying) this._stopPlayback();
                document.addEventListener("mousemove", this._boundMouseMove);
                document.addEventListener("mouseup", this._boundMouseUp);
            };
        });

        // Detail bar events
        this._setupDetailBarEvents();
    }

    _setupDetailBarEvents() {
        if (!this._panel) return;

        const fields = [
            { id: "cpe-kf-px", prop: "position", axis: "x" },
            { id: "cpe-kf-py", prop: "position", axis: "y" },
            { id: "cpe-kf-pz", prop: "position", axis: "z" },
            { id: "cpe-kf-rx", prop: "eulerAngles", axis: "x" },
            { id: "cpe-kf-ry", prop: "eulerAngles", axis: "y" },
            { id: "cpe-kf-rz", prop: "eulerAngles", axis: "z" },
        ];

        for (const f of fields) {
            const el = this._panel.querySelector(`#${f.id}`);
            if (!el) continue;
            el.onchange = () => {
                const kf = this._getSelectedKeyframe();
                if (!kf) return;
                const val = parseFloat(el.value);
                if (isNaN(val)) return;

                if (f.prop === "position") {
                    kf.position[f.axis] = val;
                } else {
                    kf.eulerAngles[f.axis] = val;
                    kf.quaternion = new pc.Quat().setFromEulerAngles(
                        kf.eulerAngles.x,
                        kf.eulerAngles.y,
                        kf.eulerAngles.z
                    );
                }
            };
        }

        const viewBtn = this._panel.querySelector("#cpe-kf-update-cam");
        if (viewBtn) viewBtn.onclick = () => {
            const kf = this._getSelectedKeyframe();
            if (!kf) return;
            this._applyCameraTransform(kf.position, kf.quaternion);
            this._currentFrame = kf.frame;
            this._updatePlayhead();
            this._updateFrameCounter();
        };

        const recaptureBtn = this._panel.querySelector("#cpe-kf-recapture");
        if (recaptureBtn) recaptureBtn.onclick = () => {
            const kf = this._getSelectedKeyframe();
            if (!kf) return;
            const cam = ArrivalSpace.getCamera();
            if (!cam) return;
            kf.position = cam.getPosition().clone();
            const euler = cam.getEulerAngles();
            kf.eulerAngles = { x: euler.x, y: euler.y, z: euler.z };
            kf.quaternion = cam.getRotation().clone();
            this._renderFullUI();
        };

        const kfDeleteBtn = this._panel.querySelector("#cpe-kf-delete");
        if (kfDeleteBtn) kfDeleteBtn.onclick = () => {
            this._deleteKeyframe(this._selectedKeyframeId);
        };
    }

    _onDocumentMouseMove(e) {
        const track = this._panel?.querySelector("#cpe-track");
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const frame = Math.round(pct * this._totalFrames);

        if (this._isDraggingPlayhead) {
            this._currentFrame = frame;
            this._updatePlayhead();
            this._updateFrameCounter();
        }

        if (this._isDraggingKeyframe && this._dragKeyframeId != null) {
            const kf = this._getKeyframeById(this._dragKeyframeId);
            if (kf) {
                kf.frame = frame;
                const diamond = this._panel?.querySelector(`.cpe-diamond[data-kf-id="${kf.id}"]`);
                if (diamond) {
                    diamond.style.left = `${this._frameToPercent(frame)}%`;
                    diamond.title = `KF#${kf.id} @ ${this._frameToTime(frame).toFixed(2)}s`;
                }
            }
        }
    }

    _onDocumentMouseUp() {
        const wasDraggingKF = this._isDraggingKeyframe;
        this._isDraggingPlayhead = false;
        this._isDraggingKeyframe = false;
        this._dragKeyframeId = null;

        document.removeEventListener("mousemove", this._boundMouseMove);
        document.removeEventListener("mouseup", this._boundMouseUp);

        if (wasDraggingKF) {
            this._sortKeyframes();
            this._renderFullUI();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // KEYFRAME MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    _addKeyframe() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) {
            console.warn("Camera Path Editor: No camera found.");
            return;
        }

        const existing = this._keyframes.find((k) => k.frame === this._currentFrame);
        if (existing) {
            existing.position = cam.getPosition().clone();
            const euler = cam.getEulerAngles();
            existing.eulerAngles = { x: euler.x, y: euler.y, z: euler.z };
            existing.quaternion = cam.getRotation().clone();
            this._selectedKeyframeId = existing.id;
            this._renderFullUI();
            return;
        }

        const pos = cam.getPosition().clone();
        const euler = cam.getEulerAngles();
        const quat = cam.getRotation().clone();

        const kf = {
            id: this._nextId++,
            frame: this._currentFrame,
            position: pos,
            eulerAngles: { x: euler.x, y: euler.y, z: euler.z },
            quaternion: quat,
        };

        this._keyframes.push(kf);
        this._sortKeyframes();
        this._selectedKeyframeId = kf.id;
        this._renderFullUI();
    }

    _deleteKeyframe(id) {
        this._keyframes = this._keyframes.filter((k) => k.id !== id);
        if (this._selectedKeyframeId === id) {
            this._selectedKeyframeId = null;
        }
        this._renderFullUI();
    }

    _getKeyframeById(id) {
        return this._keyframes.find((k) => k.id === id) || null;
    }

    _getSelectedKeyframe() {
        if (this._selectedKeyframeId == null) return null;
        return this._getKeyframeById(this._selectedKeyframeId);
    }

    _sortKeyframes() {
        this._keyframes.sort((a, b) => a.frame - b.frame);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERPOLATION — Catmull-Rom (Position) + Slerp (Rotation)
    // ═══════════════════════════════════════════════════════════

    _interpolateAtFrame(frame) {
        const kfs = this._keyframes;
        if (kfs.length < 2) return null;

        if (frame <= kfs[0].frame) {
            return { position: kfs[0].position.clone(), quaternion: kfs[0].quaternion.clone() };
        }
        if (frame >= kfs[kfs.length - 1].frame) {
            const last = kfs[kfs.length - 1];
            return { position: last.position.clone(), quaternion: last.quaternion.clone() };
        }

        let idx = 0;
        for (let i = 0; i < kfs.length - 1; i++) {
            if (frame >= kfs[i].frame && frame <= kfs[i + 1].frame) {
                idx = i;
                break;
            }
        }

        const k0 = kfs[idx];
        const k1 = kfs[idx + 1];
        const segLen = k1.frame - k0.frame;
        const t = segLen > 0 ? (frame - k0.frame) / segLen : 0;

        const p0 = idx > 0 ? kfs[idx - 1].position : k0.position;
        const p1 = k0.position;
        const p2 = k1.position;
        const p3 = idx + 2 < kfs.length ? kfs[idx + 2].position : k1.position;

        const pos = this._catmullRomVec3(p0, p1, p2, p3, t);
        const quat = new pc.Quat().slerp(k0.quaternion, k1.quaternion, t);

        return { position: pos, quaternion: quat };
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

    _samplePathSegment(kfIdxA, kfIdxB, numSamples) {
        const kfs = this._keyframes;
        const k0 = kfs[kfIdxA];
        const k1 = kfs[kfIdxB];

        const p0 = kfIdxA > 0 ? kfs[kfIdxA - 1].position : k0.position;
        const p1 = k0.position;
        const p2 = k1.position;
        const p3 = kfIdxB + 1 < kfs.length ? kfs[kfIdxB + 1].position : k1.position;

        const points = [];
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            points.push(this._catmullRomVec3(p0, p1, p2, p3, t));
        }
        return points;
    }

    // ═══════════════════════════════════════════════════════════
    // PLAYBACK
    // ═══════════════════════════════════════════════════════════

    _togglePlayback() {
        if (this._isPlaying) {
            this._stopPlayback();
        } else {
            this._startPlayback();
        }
        this._updatePlayButton();
    }

    _startPlayback() {
        if (this._keyframes.length < 2) {
            console.warn("Camera Path Editor: Need at least 2 keyframes to play.");
            return;
        }
        if (!this._savedCameraPos) {
            this._saveCamera();
        }
        this._disableCameraScripts();
        this._isPlaying = true;

        if (this._currentFrame >= this._totalFrames) {
            this._currentFrame = 0;
        }
    }

    _stopPlayback() {
        this._isPlaying = false;
        this._updatePlayButton();
    }

    _saveCamera() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return;
        this._savedCameraPos = cam.getPosition().clone();
        this._savedCameraRot = cam.getRotation().clone();
    }

    _restoreCamera() {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return;
        if (this._savedCameraPos) {
            cam.setPosition(this._savedCameraPos);
        }
        if (this._savedCameraRot) {
            cam.setRotation(this._savedCameraRot);
        }
        this._savedCameraPos = null;
        this._savedCameraRot = null;
        this._enableCameraScripts();
    }

    _disableCameraScripts() {
        const cam = ArrivalSpace.getCamera();
        if (!cam || !cam.script) return;

        this._cameraScriptsDisabled = [];
        const scriptNames = ["orbitCamera", "freeCam", "cameraMovement", "cameraScript"];
        for (const name of scriptNames) {
            const s = cam.script[name];
            if (s && s.enabled) {
                s.enabled = false;
                this._cameraScriptsDisabled.push(name);
            }
        }
    }

    _enableCameraScripts() {
        const cam = ArrivalSpace.getCamera();
        if (!cam || !cam.script) return;

        for (const name of this._cameraScriptsDisabled) {
            const s = cam.script[name];
            if (s) s.enabled = true;
        }
        this._cameraScriptsDisabled = [];
    }

    _applyCameraTransform(position, quaternion) {
        const cam = ArrivalSpace.getCamera();
        if (!cam) return;
        cam.setPosition(position);
        cam.setRotation(quaternion);
    }

    // ═══════════════════════════════════════════════════════════
    // UPDATE LOOP
    // ═══════════════════════════════════════════════════════════

    _onUpdate(dt) {
        if (this._isPlaying) {
            this._currentFrame += dt * this._fps * this._playbackSpeed;

            if (this._currentFrame >= this._totalFrames) {
                this._currentFrame = this._totalFrames;
                this._stopPlayback();

                // If intro was playing, mark it complete
                if (this._introPlaying) {
                    this._introPlaying = false;
                    this._restoreCamera();
                    this._updateFloatingPlayButton();
                }
            }

            const roundFrame = Math.round(this._currentFrame);
            const result = this._interpolateAtFrame(roundFrame);
            if (result) {
                this._applyCameraTransform(result.position, result.quaternion);
            }

            // Only update editor UI if editor is open
            if (this._editorOpen) {
                this._updatePlayhead();
                this._updateFrameCounter();
            }

            this.app.needsRedraw = true;
        }

        // 3D visualization only when editor is open
        if (this._editorOpen && this._keyframes.length > 0) {
            this._draw3DVisualization();
            this.app.needsRedraw = true;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 3D VISUALIZATION
    // ═══════════════════════════════════════════════════════════

    _draw3DVisualization() {
        const kfs = this._keyframes;
        if (kfs.length === 0) return;

        const pathCol = this._hexToColor(this.pathColor);
        const frustumCol = this._hexToColor(this.frustumColor);
        const frustumSelCol = this._hexToColor(this.frustumSelectedColor);

        if (kfs.length >= 2) {
            for (let i = 0; i < kfs.length - 1; i++) {
                const points = this._samplePathSegment(i, i + 1, 20);
                for (let j = 0; j < points.length - 1; j++) {
                    this.app.drawLine(points[j], points[j + 1], pathCol);
                }
            }
        }

        for (const kf of kfs) {
            const isSelected = kf.id === this._selectedKeyframeId;
            const col = isSelected ? frustumSelCol : frustumCol;
            this._drawFrustumGizmo(kf.position, kf.quaternion, col);
        }
    }

    _drawFrustumGizmo(position, quaternion, color) {
        const mat = new pc.Mat4().setTRS(pc.Vec3.ZERO, quaternion, pc.Vec3.ONE);
        const forward = new pc.Vec3(mat.data[8], mat.data[9], mat.data[10]).mulScalar(-1);
        const up = new pc.Vec3(mat.data[4], mat.data[5], mat.data[6]);
        const right = new pc.Vec3(mat.data[0], mat.data[1], mat.data[2]);

        const near = 0.15;
        const far = 0.5;
        const halfFov = Math.tan((30 * Math.PI) / 180);

        const fwd = forward.clone();

        const farRight = right.clone().mulScalar(far * halfFov);
        const farUp = up.clone().mulScalar(far * halfFov);
        const nearRight = right.clone().mulScalar(near * halfFov);
        const nearUp = up.clone().mulScalar(near * halfFov);

        const fwdFar = fwd.clone().mulScalar(far);
        const fwdNear = fwd.clone().mulScalar(near);

        const ftr = position.clone().add(fwdFar).add(farRight).add(farUp);
        const ftl = position.clone().add(fwdFar).sub(farRight).add(farUp);
        const fbr = position.clone().add(fwdFar).add(farRight).sub(farUp);
        const fbl = position.clone().add(fwdFar).sub(farRight).sub(farUp);

        const ntr = position.clone().add(fwdNear).add(nearRight).add(nearUp);
        const ntl = position.clone().add(fwdNear).sub(nearRight).add(nearUp);
        const nbr = position.clone().add(fwdNear).add(nearRight).sub(nearUp);
        const nbl = position.clone().add(fwdNear).sub(nearRight).sub(nearUp);

        this.app.drawLine(ftr, ftl, color);
        this.app.drawLine(ftr, fbr, color);
        this.app.drawLine(ftl, fbl, color);
        this.app.drawLine(fbr, fbl, color);

        this.app.drawLine(ntr, ntl, color);
        this.app.drawLine(ntr, nbr, color);
        this.app.drawLine(ntl, nbl, color);
        this.app.drawLine(nbr, nbl, color);

        this.app.drawLine(ntr, ftr, color);
        this.app.drawLine(ntl, ftl, color);
        this.app.drawLine(nbr, fbr, color);
        this.app.drawLine(nbl, fbl, color);
    }

    // ═══════════════════════════════════════════════════════════
    // SAVE / EXPORT
    // ═══════════════════════════════════════════════════════════

    async _handleSave() {
        if (this._isSaving || !this._currentPathSlug) return;

        this._isSaving = true;
        this._updateSaveButton();

        try {
            const success = await this._saveCurrentPath();
            this._flashSaveButton(success);
            if (success) {
                console.log("Camera Path Editor: Saved path", this._currentPathSlug);
            }
        } catch (err) {
            console.error("Camera Path Editor: Save error.", err);
            this._flashSaveButton(false);
        } finally {
            this._isSaving = false;
            this._updateSaveButton();
        }
    }

    _updateSaveButton() {
        const btn = this._panel?.querySelector("#cpe-save");
        if (btn) {
            btn.textContent = this._isSaving ? "Saving..." : "Save";
            btn.style.opacity = this._isSaving ? "0.5" : "1";
        }
    }

    _flashSaveButton(success) {
        const btn = this._panel?.querySelector("#cpe-save");
        if (!btn) return;
        const color = success ? "#22c55e" : "#ef4444";
        btn.textContent = success ? "Saved!" : "Failed";
        btn.style.color = color;
        btn.style.borderColor = color;
        setTimeout(() => {
            if (!btn.isConnected) return;
            btn.textContent = "Save";
            btn.style.color = "#22c55e";
            btn.style.borderColor = "#22c55e";
        }, 1500);
    }

    _exportJSON() {
        const data = this._buildSaveData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `camera-path-${this._currentPathSlug || "export"}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log("Camera Path Editor: Exported", this._keyframes.length, "keyframes.");
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    _recalcTotalFrames() {
        this._totalFrames = Math.round(this._duration * this._fps);

        for (const kf of this._keyframes) {
            if (kf.frame > this._totalFrames) {
                kf.frame = this._totalFrames;
            }
        }

        if (this._currentFrame > this._totalFrames) {
            this._currentFrame = this._totalFrames;
        }
    }

    _frameToPercent(frame) {
        if (this._totalFrames === 0) return 0;
        return (frame / this._totalFrames) * 100;
    }

    _frameToTime(frame) {
        if (this._fps === 0) return 0;
        return frame / this._fps;
    }

    _updatePlayhead() {
        const playhead = this._panel?.querySelector("#cpe-playhead");
        if (playhead) {
            playhead.style.left = `${this._frameToPercent(Math.round(this._currentFrame))}%`;
        }
    }

    _updateFrameCounter() {
        const counter = this._panel?.querySelector("#cpe-frame-counter");
        if (counter) {
            counter.textContent = `Frame: ${Math.round(this._currentFrame)} / ${this._totalFrames}`;
        }
    }

    _updatePlayButton() {
        const btn = this._panel?.querySelector("#cpe-play");
        if (btn) {
            btn.textContent = this._isPlaying ? "||" : "\u25B6";
        }
    }

    _hexToColor(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return new pc.Color(1, 1, 1);
        return new pc.Color(
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        );
    }
}
