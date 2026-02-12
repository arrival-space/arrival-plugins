/**
 * Character Scale Plugin
 * 
 * Shows a draggable float slider UI to scale the character you're controlling.
 * 
 * Usage: Add this plugin to any entity in your space.
 */

export class CharacterScalePlugin extends ArrivalScript {
    
    // ═══════════════════════════════════════════════════════════
    // PROPERTIES (shown in editor UI)
    // ═══════════════════════════════════════════════════════════
    
    accentColor = "#6366f1"; // Indigo accent
    backgroundColor = "#1e1e23";
    
    // Position
    positionTop = "";
    positionBottom = "100px";
    positionLeft = "20px";
    positionRight = "";
    
    // Scale limits
    minScale = 0.1;
    maxScale = 5.0;
    defaultScale = 1.0;
    
    static properties = {
        positionTop: { title: 'Top (e.g. 80px, 10%)' },
        positionBottom: { title: 'Bottom (e.g. 100px, 10%)' },
        positionLeft: { title: 'Left (e.g. 20px, 10%)' },
        positionRight: { title: 'Right (e.g. 20px, 10%)' },
        minScale: { title: 'Min Scale', min: 0.01, max: 1.0, step: 0.01 },
        maxScale: { title: 'Max Scale', min: 1.0, max: 10.0, step: 0.1 },
        defaultScale: { title: 'Default Scale', min: 0.1, max: 5.0, step: 0.1 },
        accentColor: { title: 'Accent Color' },
        backgroundColor: { title: 'Background Color' }
    };
    
    // ═══════════════════════════════════════════════════════════
    // PRIVATE STATE
    // ═══════════════════════════════════════════════════════════
    
    _panel = null;
    _currentScale = 1.0;
    _isDragging = false;
    _isMinimized = false;
    _rgb = null;
    _bgRgb = null;

    // ═══════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════
    
    initialize() {
        this._currentScale = this.defaultScale;
        this._createUI();
    }
    
    destroy() {
        this.unlockInput();
    }
    
    onPropertyChanged(name, value, oldValue) {
        const rebuildProps = ['accentColor', 'backgroundColor', 'positionTop', 'positionBottom', 'positionLeft', 'positionRight', 'minScale', 'maxScale'];
        if (rebuildProps.includes(name)) {
            this._rebuildUI();
        }
        if (name === 'defaultScale') {
            this._currentScale = value;
            this._applyScale();
            this._updateSliderPosition();
        }
    }
    
    _rebuildUI() {
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
        
        if (this._isMinimized) {
            this._createUI();
            this._minimizePanel();
        } else {
            this._createUI();
        }
    }
    
    // ═══════════════════════════════════════════════════════════
    // POSITION HELPERS
    // ═══════════════════════════════════════════════════════════
    
    _getPositionStyle() {
        const pos = {};
        if (this.positionTop) pos.top = this.positionTop;
        if (this.positionBottom) pos.bottom = this.positionBottom;
        if (this.positionLeft) pos.left = this.positionLeft;
        if (this.positionRight) pos.right = this.positionRight;
        
        if (Object.keys(pos).length === 0) {
            return { bottom: '100px', left: '20px' };
        }
        return pos;
    }
    
    _getTransformOrigin() {
        const pos = this._getPositionStyle();
        const vertical = pos.top ? 'top' : 'bottom';
        const horizontal = pos.left ? 'left' : 'right';
        return `${vertical} ${horizontal}`;
    }
    
    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '99, 102, 241';
    }

    // ═══════════════════════════════════════════════════════════
    // UI CREATION
    // ═══════════════════════════════════════════════════════════
    
    _createUI() {
        const pos = this._getPositionStyle();
        this._rgb = this._hexToRgb(this.accentColor);
        this._bgRgb = this._hexToRgb(this.backgroundColor);
        
        this._panel = this.createUI('div', {
            id: 'character-scale-panel',
            style: {
                position: 'fixed',
                ...pos,
                padding: '16px 20px',
                background: `linear-gradient(145deg, rgba(${this._bgRgb}, 0.98) 0%, rgba(${this._bgRgb}, 0.95) 100%)`,
                borderRadius: '14px',
                color: 'white',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(${this._rgb}, 0.5)`,
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                cursor: 'default',
                minWidth: '200px',
                zIndex: '1001',
                border: `1px solid rgba(${this._rgb}, 0.3)`,
                userSelect: 'none'
            }
        });
        
        this._updatePanelContent();
        
        // Hover effects
        this._panel.onmouseenter = () => {
            this.lockInput();
            this._panel.style.boxShadow = `0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(${this._rgb}, 0.8)`;
        };
        this._panel.onmouseleave = () => {
            if (!this._isDragging) {
                this.unlockInput();
            }
            this._panel.style.boxShadow = `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(${this._rgb}, 0.5)`;
        };
    }
    
    _updatePanelContent() {
        if (!this._panel) return;
        
        const percent = ((this._currentScale - this.minScale) / (this.maxScale - this.minScale)) * 100;
        
        this._panel.innerHTML = `
            <!-- Collapse Button -->
            <button id="collapse-btn" style="
                position: absolute;
                top: 8px;
                right: 8px;
                width: 24px;
                height: 24px;
                border: none;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.6);
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
            " title="Collapse">−</button>
            
            <!-- Header -->
            <div style="
                font-size: 12px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.7);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 12px;
            ">Character Scale</div>
            
            <!-- Scale Value Display -->
            <div style="
                text-align: center;
                margin-bottom: 14px;
            ">
                <span id="scale-value" style="
                    font-size: 36px;
                    font-weight: 700;
                    background: linear-gradient(135deg, rgb(${this._rgb}) 0%, rgba(${this._rgb}, 0.7) 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                ">${this._currentScale.toFixed(2)}</span>
                <span style="
                    font-size: 14px;
                    color: rgba(255, 255, 255, 0.5);
                    margin-left: 4px;
                ">x</span>
            </div>
            
            <!-- Slider Track -->
            <div id="slider-track" style="
                position: relative;
                height: 8px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                cursor: pointer;
                margin-bottom: 10px;
            ">
                <!-- Filled portion -->
                <div id="slider-fill" style="
                    position: absolute;
                    left: 0;
                    top: 0;
                    height: 100%;
                    width: ${percent}%;
                    background: linear-gradient(90deg, rgb(${this._rgb}) 0%, rgba(${this._rgb}, 0.7) 100%);
                    border-radius: 4px;
                    transition: width 0.1s ease;
                "></div>
                
                <!-- Thumb -->
                <div id="slider-thumb" style="
                    position: absolute;
                    top: 50%;
                    left: ${percent}%;
                    transform: translate(-50%, -50%);
                    width: 20px;
                    height: 20px;
                    background: white;
                    border-radius: 50%;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(${this._rgb}, 0.5);
                    cursor: grab;
                    transition: box-shadow 0.2s ease;
                "></div>
            </div>
            
            <!-- Min/Max Labels -->
            <div style="
                display: flex;
                justify-content: space-between;
                font-size: 10px;
                color: rgba(255, 255, 255, 0.4);
            ">
                <span>${this.minScale.toFixed(1)}x</span>
                <span>${this.maxScale.toFixed(1)}x</span>
            </div>
            
            <!-- Reset Button -->
            <button id="reset-btn" style="
                width: 100%;
                margin-top: 12px;
                padding: 8px 16px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                color: rgba(255, 255, 255, 0.7);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: inherit;
            ">Reset to ${this.defaultScale.toFixed(1)}x</button>
        `;
        
        this._setupSliderEvents();
        this._setupButtonEvents();
    }
    
    _setupSliderEvents() {
        const track = this._panel.querySelector('#slider-track');
        const thumb = this._panel.querySelector('#slider-thumb');
        
        if (!track || !thumb) return;
        
        const updateFromPosition = (clientX) => {
            const rect = track.getBoundingClientRect();
            let percent = (clientX - rect.left) / rect.width;
            percent = Math.max(0, Math.min(1, percent));
            
            this._currentScale = this.minScale + percent * (this.maxScale - this.minScale);
            this._currentScale = Math.round(this._currentScale * 100) / 100; // Round to 2 decimals
            
            this._updateSliderPosition();
            this._applyScale();
        };
        
        // Mouse events
        const onMouseMove = (e) => {
            if (this._isDragging) {
                updateFromPosition(e.clientX);
            }
        };
        
        const onMouseUp = () => {
            if (this._isDragging) {
                this._isDragging = false;
                thumb.style.cursor = 'grab';
                thumb.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(${this._rgb}, 0.5)`;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                // Unlock input if not hovering panel
                if (!this._panel.matches(':hover')) {
                    this.unlockInput();
                }
            }
        };
        
        thumb.onmousedown = (e) => {
            e.preventDefault();
            this._isDragging = true;
            thumb.style.cursor = 'grabbing';
            thumb.style.boxShadow = `0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(${this._rgb}, 0.8)`;
            this.lockInput();
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
        
        // Click on track
        track.onclick = (e) => {
            if (e.target === thumb) return;
            updateFromPosition(e.clientX);
        };
        
        // Hover effect on thumb
        thumb.onmouseenter = () => {
            if (!this._isDragging) {
                thumb.style.boxShadow = `0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(${this._rgb}, 0.7)`;
            }
        };
        thumb.onmouseleave = () => {
            if (!this._isDragging) {
                thumb.style.boxShadow = `0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(${this._rgb}, 0.5)`;
            }
        };
    }
    
    _setupButtonEvents() {
        // Collapse button
        const collapseBtn = this._panel.querySelector('#collapse-btn');
        if (collapseBtn) {
            collapseBtn.onmouseenter = () => {
                collapseBtn.style.background = 'rgba(255, 255, 255, 0.2)';
                collapseBtn.style.color = 'rgba(255, 255, 255, 0.9)';
            };
            collapseBtn.onmouseleave = () => {
                collapseBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                collapseBtn.style.color = 'rgba(255, 255, 255, 0.6)';
            };
            collapseBtn.onclick = (e) => {
                e.stopPropagation();
                this._minimizePanel();
            };
        }
        
        // Reset button
        const resetBtn = this._panel.querySelector('#reset-btn');
        if (resetBtn) {
            resetBtn.onmouseenter = () => {
                resetBtn.style.background = 'rgba(255, 255, 255, 0.2)';
                resetBtn.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                resetBtn.style.color = 'white';
            };
            resetBtn.onmouseleave = () => {
                resetBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                resetBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                resetBtn.style.color = 'rgba(255, 255, 255, 0.7)';
            };
            resetBtn.onclick = () => {
                this._currentScale = this.defaultScale;
                this._updateSliderPosition();
                this._applyScale();
            };
        }
    }
    
    _updateSliderPosition() {
        if (!this._panel) return;
        
        const percent = ((this._currentScale - this.minScale) / (this.maxScale - this.minScale)) * 100;
        
        const fill = this._panel.querySelector('#slider-fill');
        const thumb = this._panel.querySelector('#slider-thumb');
        const valueDisplay = this._panel.querySelector('#scale-value');
        
        if (fill) fill.style.width = `${percent}%`;
        if (thumb) thumb.style.left = `${percent}%`;
        if (valueDisplay) valueDisplay.textContent = this._currentScale.toFixed(2);
    }
    
    // ═══════════════════════════════════════════════════════════
    // MINIMIZE / EXPAND
    // ═══════════════════════════════════════════════════════════
    
    _minimizePanel() {
        if (!this._panel) return;
        
        this._isMinimized = true;
        
        const pos = this._getPositionStyle();
        const transformOrigin = this._getTransformOrigin();
        
        this._panel.style.cssText = `
            position: fixed;
            ${Object.entries(pos).map(([k, v]) => `${k}: ${v}`).join('; ')};
            padding: 0;
            width: 56px;
            height: 56px;
            background: transparent;
            cursor: pointer;
            transition: all 0.3s ease;
            z-index: 1001;
            pointer-events: auto;
            transform-origin: ${transformOrigin};
        `;
        
        this._panel.innerHTML = `
            <div style="
                width: 56px;
                height: 56px;
                border-radius: 50%;
                overflow: hidden;
                background: linear-gradient(145deg, rgba(${this._bgRgb}, 0.98) 0%, rgba(${this._bgRgb}, 0.95) 100%);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(${this._rgb}, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
            ">📏</div>
            <span style="
                position: absolute;
                bottom: -2px;
                right: -2px;
                background: linear-gradient(135deg, rgb(${this._rgb}) 0%, rgba(${this._rgb}, 0.8) 100%);
                color: white;
                font-size: 9px;
                font-weight: 800;
                padding: 3px 7px;
                border-radius: 10px;
                min-width: 18px;
                text-align: center;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            ">${this._currentScale.toFixed(1)}x</span>
        `;
        
        this._panel.onclick = () => this._expandPanel();
        
        this._panel.onmouseenter = () => { 
            this.lockInput();
            this._panel.style.transform = 'scale(1.1)'; 
        };
        this._panel.onmouseleave = () => { 
            this.unlockInput();
            this._panel.style.transform = 'scale(1)'; 
        };
    }
    
    _expandPanel() {
        if (!this._panel) return;
        
        this._isMinimized = false;
        this._panel.remove();
        this._panel = null;
        this._createUI();
    }
    
    // ═══════════════════════════════════════════════════════════
    // CHARACTER SCALING
    // ═══════════════════════════════════════════════════════════
    
    _applyScale() {
        // Get the local player's character entity
        const localPlayer = this._getLocalPlayerEntity();
        
        if (localPlayer) {
            localPlayer.setLocalScale(this._currentScale, this._currentScale, this._currentScale);
            console.log(`📏 Character scale set to: ${this._currentScale}`);
        } else {
            console.warn('📏 No local player entity found to scale');
        }
    }
    
    _getLocalPlayerEntity() {
        // Try to find the local player through common patterns
        
        // Method 1: Through networkManager
        if (this.app.networkManager?.localPlayer) {
            return this.app.networkManager.localPlayer;
        }
        
        // Method 2: Through localPlayerEntity on app
        if (this.app.localPlayerEntity) {
            return this.app.localPlayerEntity;
        }
        
        // Method 3: Search for entity with 'localPlayer' or 'player' tag
        const localPlayerByTag = this.app.root.findByTag('localPlayer')[0] || 
                                  this.app.root.findByTag('player')[0];
        if (localPlayerByTag) {
            return localPlayerByTag;
        }
        
        // Method 4: Find by script name pattern
        const allEntities = this.app.root.find(() => true);
        for (const entity of allEntities) {
            if (entity.script) {
                // Look for common player script names
                if (entity.script.playerController || 
                    entity.script.localPlayer ||
                    entity.script.characterController ||
                    entity.script.firstPersonController) {
                    return entity;
                }
            }
        }
        
        // Method 5: Through app.cameraEntity parent chain (often the player)
        if (this.app.cameraEntity?.parent) {
            let parent = this.app.cameraEntity.parent;
            // Walk up to find a reasonable player root
            while (parent && parent !== this.app.root) {
                if (parent.script || parent.model || parent.render) {
                    return parent;
                }
                parent = parent.parent;
            }
        }
        
        return null;
    }
    
    // ═══════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════
    
    /**
     * Get the current scale value.
     */
    getScale() {
        return this._currentScale;
    }
    
    /**
     * Set the scale programmatically.
     */
    setScale(value) {
        this._currentScale = Math.max(this.minScale, Math.min(this.maxScale, value));
        this._updateSliderPosition();
        this._applyScale();
        
        if (this._isMinimized) {
            this._rebuildUI();
        }
    }
    
    /**
     * Reset to default scale.
     */
    resetScale() {
        this.setScale(this.defaultScale);
    }
}
