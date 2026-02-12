/**
 * Gate Vote Panels Plugin
 * 
 * Creates interactive voting panels next to each static gate, allowing users
 * to vote for spaces in time-boxed competitions.
 * 
 * Features demonstrated:
 * - ArrivalSpace.getStaticGates() - Access all static gates in the space
 * - ArrivalSpace.createTexturePanel() - Create interactive 3D UI panels
 * - Gate-relative positioning - Place content relative to gate transforms
 * - Voting API integration - voteSpace/unvoteSpace/getSpaceVoteStats
 * - Creator profile integration - Open creator profiles on click
 * - Real-time property updates - Update transforms without recreating panels
 * 
 * @example
 * // The plugin automatically creates panels for all static gates
 * // Configure via properties in the UI:
 * // - competitionID: Identifier for the voting competition
 * // - offset: Position offset relative to gate (right, up, forward)
 * // - rotationY: Additional Y-axis rotation for panel orientation
 */
export class GateVotePanels extends ArrivalScript {
    static scriptName = 'gateVotePanels';
    
    // ─────────────────────────────────────────────────────────────────────────
    // CONFIGURABLE PROPERTIES
    // ─────────────────────────────────────────────────────────────────────────
    
    /** Panel dimensions */
    panelWidth = 1;
    panelHeight = 0.8;
    
    /** Competition identifier for grouping votes */
    competitionID = "competition_2026_01";

    /** Position offset relative to gate: { x: right, y: up, z: forward } */
    offset = { x: 2.13, y: 0.88, z: -0.28 };
    
    /** Additional Y-axis rotation in degrees */
    rotationY = -10.9;

    /** Panel colors */
    backgroundColor = "#4a4a4a";
    votedBackgroundColor = "#4a4a4a";
    buttonColor = "#4a9eff";
    votedButtonColor = "#2d8a4e";
    textColor = "#ffffff";
    
    /** Gate indices to exclude from showing vote panels (comma-separated, e.g. "0,3,7") */
    excludeGateIndices = "6";
    
    /** Property definitions for the UI editor */
    static properties = {
        panelWidth: { title: 'Panel Width', min: 0.3, max: 2 },
        panelHeight: { title: 'Panel Height', min: 0.2, max: 1.5 },
        competitionID: { title: 'Competition ID' },
        offset: { title: 'Offset (right, up, front)', type: 'vec3', step: 0.01 },
        rotationY: { title: 'Y Rotation', min: -180, max: 180, step: 1 },
        excludeGateIndices: { title: 'Exclude Gate Indices (e.g. 0,3,6)' },
        backgroundColor: { title: 'Background Color' },
        votedBackgroundColor: { title: 'Voted Background Color' },
        buttonColor: { title: 'Button Color' },
        votedButtonColor: { title: 'Voted Button Color' },
        textColor: { title: 'Text Color' }
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE STATE
    // ─────────────────────────────────────────────────────────────────────────
    
    /** @type {Array} Created panel instances */
    _panels = [];
    
    /** @type {Object} Vote data cache: { spaceID: VoteStats } */
    _voteData = {};
    
    /** @type {Array} Cached gate references */
    _gates = [];
    
    // ─────────────────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────
    
    initialize() {
        console.log('🗳️ Gate Vote Panels initializing...');
        this._createPanels();
        
        this.once('destroy', () => this._destroyPanels());
    }
    
    /**
     * Handle property changes from the UI editor.
     * Optimizes updates by only recreating panels when necessary.
     */
    async onPropertyChanged(name, value, oldValue) {
        switch (name) {
            // Transform changes - update position/rotation without recreating
            case 'offset':
            case 'rotationY':
                this._updateAllPanelTransforms();
                break;
                
            // Size changes require panel recreation
            case 'panelWidth':
            case 'panelHeight':
                await this._createPanels();
                break;
                
            // Competition change requires refetching vote data
            case 'competitionID':
                await this._createPanels();
                break;
                
            // Color/style changes - just update content
            default:
                this._updateAllPanelContent();
                break;
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // PANEL MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Create vote panels for all static gates.
     */
    async _createPanels() {
        this._destroyPanels();
        
        this._gates = ArrivalSpace.getStaticGates();
        
        if (!this._gates?.length) {
            console.warn('🗳️ No static gates found');
            return;
        }
        
        console.log(`🗳️ Creating vote panels for ${this._gates.length} gates`);
        
        // Fetch vote stats for all gates in parallel
        await this._fetchAllVoteStats();
        
        // Create panels for each gate
        for (const gate of this._gates) {
            const panel = await this._createPanelForGate(gate);
            if (panel) {
                this._panels.push(panel);
            }
        }
    }
    
    /**
     * Create a single vote panel for a gate.
     */
    async _createPanelForGate(gate) {
        // Check if this gate index is excluded
        if (this._isGateExcluded(gate.index)) {
            return null;
        }
        
        const spaceID = this._getSpaceIDForGate(gate);
        
        /// Disable default Like button on gate
        gate.entity.findByName('LikeButton').enabled = false;
        gate.entity.findByName('LikeCount').enabled = false;
        
        // Skip gates without a linked space
        if (!spaceID) {
            return null;
        }
        
        const voteStats = this._voteData[spaceID] || null;
        const hasVoted = voteStats?.hasVotedForThis || false;
        
        const { position, rotation } = this._calculatePanelTransform(gate);

        const panel = await ArrivalSpace.createTexturePanel({
            position,
            rotation,
            width: this.panelWidth,
            height: this.panelHeight,
            html: this._generatePanelHTML(gate.index, voteStats, spaceID),
            transparent: true,
            textColor: this.textColor,
            billboard: false,
            interactive: true,
            onClick: (href) => this._handlePanelClick(href, gate, spaceID)
        });
        
        if (panel) {
            // Store metadata for later updates
            panel._gateIndex = gate.index;
            panel._spaceID = spaceID;
            panel._gate = gate;
        }
        
        return panel;
    }
    
    /**
     * Destroy all panels and clear state.
     */
    _destroyPanels() {
        for (const panel of this._panels) {
            if (panel && !panel._destroyed) {
                panel.destroy();
            }
        }
        this._panels = [];
        this._voteData = {};
        this._gates = [];
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // TRANSFORM CALCULATIONS
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Calculate panel position and rotation based on gate transform and offsets.
     * @returns {{ position: {x,y,z}, rotation: {x,y,z} }}
     */
    _calculatePanelTransform(gate) {
        const gateEntity = gate.entity.findByName('root');
        const gatePos = gateEntity.getPosition();
        const gateRotation = gateEntity.getEulerAngles();
        
        // Calculate position using gate's local axes
        const right = gateEntity.right;
        const up = gateEntity.up;
        const forward = gateEntity.forward;
        
        const position = {
            x: gatePos.x + right.x * this.offset.x + up.x * this.offset.y + forward.x * this.offset.z,
            y: gatePos.y + right.y * this.offset.x + up.y * this.offset.y + forward.y * this.offset.z,
            z: gatePos.z + right.z * this.offset.x + up.z * this.offset.y + forward.z * this.offset.z
        };

        // Detect flipped gates (X rotation ≈ ±180°) and adjust Y rotation accordingly
        const isFlipped = Math.abs(Math.abs(gateRotation.x) - 180) < 1;
        const adjustedRotationY = isFlipped ? -this.rotationY : this.rotationY;
        
        const rotation = {
            x: gateRotation.x,
            y: gateRotation.y + adjustedRotationY,
            z: gateRotation.z
        };
        
        return { position, rotation };
    }
    
    /**
     * Update transforms for all panels without recreating them.
     * Note: createTexturePanel adds 90° to X rotation internally, so we must do the same here.
     */
    _updateAllPanelTransforms() {
        for (const panel of this._panels) {
            if (!panel?._gate || panel._destroyed) continue;
            
            const { position, rotation } = this._calculatePanelTransform(panel._gate);
            
            // Update panel entity transform directly
            // Note: Must add 90 to X rotation to match createTexturePanel's internal offset
            panel.setPosition(position.x, position.y, position.z);
            panel.setEulerAngles(90 + rotation.x, rotation.y, rotation.z);
        }
    }
    
    /**
     * Update content for all panels (for color/style changes).
     */
    _updateAllPanelContent() {
        for (const panel of this._panels) {
            if (!panel?.updateContent || panel._destroyed) continue;
            
            const spaceID = panel._spaceID;
            const voteStats = spaceID ? this._voteData[spaceID] : null;
            const html = this._generatePanelHTML(panel._gateIndex, voteStats, spaceID);
            
            panel.updateContent(html);
        }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // VOTING LOGIC
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Fetch vote statistics for all gates.
     */
    async _fetchAllVoteStats() {
        const fetchPromises = this._gates.map(async (gate) => {
            const spaceID = this._getSpaceIDForGate(gate);
            if (!spaceID) return;
            
            try {
                const stats = await pc.app.userProfileData.getSpaceVoteStats(spaceID, this.competitionID);
                if (stats) {
                    this._voteData[spaceID] = stats;
                }
            } catch (e) {
                console.warn(`🗳️ Failed to fetch vote stats for gate ${gate.index}:`, e);
            }
        });
        
        await Promise.all(fetchPromises);
    }
    
    /**
     * Toggle vote state for a space.
     */
    async _toggleVote(gate, spaceID) {
        if (!this._isUserRegistered()) {
            console.log('🗳️ User not registered with email, opening login screen');
            this._openLoginScreen();
            return;
        }
        
        const currentStats = this._voteData[spaceID];
        const hasVoted = currentStats?.hasVotedForThis || false;
        
        try {
            if (hasVoted) {
                const result = await pc.app.userProfileData.unvoteSpace(spaceID, this.competitionID);
                if (result) {
                    console.log(`🗳️ Unvoted for gate ${gate.index}`);
                }
            } else {
                const result = await pc.app.userProfileData.voteSpace(spaceID, this.competitionID);
                if (!result.success) {
                    console.warn(`🗳️ Vote failed: ${result.msg}`);
                    return;
                }
                console.log(`🗳️ Voted for gate ${gate.index}`);
            }
            
            // Refresh stats and update panel
            const newStats = await pc.app.userProfileData.getSpaceVoteStats(spaceID, this.competitionID);
            if (newStats) {
                this._voteData[spaceID] = newStats;
                await this._updatePanelForGate(gate, spaceID, newStats);
            }
        } catch (e) {
            console.error(`🗳️ Vote toggle failed:`, e);
        }
    }
    
    /**
     * Update a single panel after voting.
     */
    async _updatePanelForGate(gate, spaceID, voteStats) {
        const panel = this._panels.find(p => p._gateIndex === gate.index);
        if (!panel?.updateContent) {
            console.warn(`🗳️ Panel not found for gate ${gate.index}`);
            return;
        }
        
        const html = this._generatePanelHTML(gate.index, voteStats, spaceID);
        
        await panel.updateContent(html);
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // EVENT HANDLERS
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Handle panel click events.
     */
    async _handlePanelClick(href, gate, spaceID) {
        if (!href) return;
        
        if (href.startsWith('vote-')) {
            if (!spaceID) {
                console.warn('🗳️ No spaceID associated with this gate');
                return;
            }
            await this._toggleVote(gate, spaceID);
        } else if (href.startsWith('creator-')) {
            const creatorID = href.replace('creator-', '');
            this._openCreatorProfile(creatorID);
        }
    }
    
    /**
     * Open creator profile overlay.
     */
    _openCreatorProfile(creatorID) {
        if (!creatorID) {
            console.warn('🗳️ No creatorID to open profile');
            return;
        }
        pc.app.fire(ReactUI.EVENT.CREATOR_PROFILE_CLICK, null, creatorID, "info");
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Check if a gate index is in the exclude list.
     */
    _isGateExcluded(index) {
        if (!this.excludeGateIndices || this.excludeGateIndices.trim() === '') {
            return false;
        }
        const excludedIndices = this.excludeGateIndices
            .split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n));
        return excludedIndices.includes(index);
    }
    
    /**
     * Get the space ID from a gate's link property.
     */
    _getSpaceIDForGate(gate) {
        const link = gate.gateLogic?.link;
        if (!link) return null;
        
        return link.startsWith('custom.travel.center.') 
            ? link 
            : `custom.travel.center.${link}`;
    }
    
    /**
     * Check if user is logged in.
     */
    _isUserLoggedIn() {
        return !!pc.app.userProfileData?.userID;
    }
    
    /**
     * Check if user is registered with email (not anonymous).
     */
    _isUserRegistered() {
        return pc.app.userProfileData?.isRegistered?.() || false;
    }
    
    /**
     * Open the Register/Login screen.
     */
    _openLoginScreen() {
        ReactUI.pushReactNavigationState({
            claimYourSpaceScreen: {
                isOpen: true,
                screen: "initial",
            },
        });
    }
    
    /**
     * Format vote count for display (e.g., 1500 -> "1.5K").
     */
    _formatVoteCount(count) {
        if (count >= 1_000_000) {
            return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (count >= 1_000) {
            return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return count.toLocaleString();
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // HTML GENERATION
    // ─────────────────────────────────────────────────────────────────────────
    
    /**
     * Generate the main panel HTML.
     */
    _generatePanelHTML(gateIndex, voteStats, spaceID) {
        if (!spaceID) {
            return this._generateUnlinkedHTML();
        }
        
        const voteCount = voteStats?.voteCount ?? 0;
        const hasVoted = voteStats?.hasVotedForThis || false;
        const creatorName = voteStats?.creatorName || 'Unknown Creator';
        const creatorID = voteStats?.creatorID || '';
        const creatorImageUrl = voteStats?.creatorImageUrl || '';
        const creatorImageIsAvatar = voteStats?.creatorImageIsAvatar || false;
        const creatorIsPro = voteStats?.creatorIsPro || false;
        
        const buttonState = this._getButtonState(hasVoted);
        const profileImageHTML = this._generateProfileImageHTML(creatorImageUrl, creatorImageIsAvatar);
        const proBadgeHTML = creatorIsPro ? this._generateProBadgeHTML() : '';
        
        const bgColor = hasVoted ? this.votedBackgroundColor : this.backgroundColor;
        
        return `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
                height: 100%;
                padding: 24px;
                box-sizing: border-box;
                font-family: Arial, sans-serif;
                color: ${this.textColor};
                background-color: ${bgColor};
                border-radius: 32px;
            ">
                <a href="creator-${creatorID}" style="width: 100%; text-decoration: none; color: ${this.textColor}; display: flex; align-items: center;">
                    ${profileImageHTML}
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-bottom: 3px;">
                            CREATOR
                        </div>
                        <div style="display: flex; align-items: center;">
                            <span style="font-size: 19px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: underline;">
                                ${creatorName}
                            </span>
                            ${proBadgeHTML}
                        </div>
                    </div>
                </a>
                
                <div style="width: 100%; flex: 1; display: flex; flex-direction: column; justify-content: center;">
                    <div style="font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; opacity: 0.7; margin-bottom: 6px;">
                        PUBLIC VOTES
                    </div>
                    <div style="font-size: 38px; font-weight: bold;">
                        ${this._formatVoteCount(voteCount)}
                    </div>
                </div>
                
                <a href="vote-${gateIndex}" style="
                    width: 100%;
                    padding: 20px 0 15px 0;
                    background-color: ${buttonState.color};
                    border-radius: 32px;
                    text-align: center;
                    font-size: 19px;
                    font-weight: bold;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    cursor: pointer;
                    text-decoration: none;
                    color: ${this.textColor};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    ${buttonState.text}
                </a>
            </div>
        `;
    }
    
    /**
     * Get button text and color based on vote state.
     */
    _getButtonState(hasVoted) {
        if (!this._isUserRegistered()) {
            return { text: 'REGISTER TO VOTE', color: '#888888' };
        }
        if (hasVoted) {
            return { text: '✅ VOTED', color: this.votedButtonColor };
        }
        return { text: 'VOTE', color: this.buttonColor };
    }
    
    /**
     * Generate HTML for unlinked gate state.
     */
    _generateUnlinkedHTML() {
        return `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 100%;
                padding: 16px;
                box-sizing: border-box;
                font-family: Arial, sans-serif;
                color: ${this.textColor};
                text-align: center;
                background-color: ${this.backgroundColor};
                border-radius: 16px;
            ">
                <div style="
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background-color: rgba(255,255,255,0.1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 12px;
                ">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <div style="font-size: 13px; font-weight: bold; margin-bottom: 6px; opacity: 0.8;">
                    No Space Linked
                </div>
                <div style="font-size: 11px; opacity: 0.5; line-height: 1.4;">
                    This gate doesn't have<br/>a destination set
                </div>
            </div>
        `;
    }
    
    /**
     * Generate profile image HTML with proper head cropping for RPM avatars.
     */
    _generateProfileImageHTML(imageUrl, isAvatar) {
        if (!imageUrl) {
            // Placeholder for missing image
            return `
                <div style="
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background-color: #444;
                    margin-right: 12px;
                    flex-shrink: 0;
                "></div>
            `;
        }
        
        if (isAvatar) {
            // RPM avatar - needs head cropping via transform
            return `
                <div style="
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    overflow: hidden;
                    margin-right: 12px;
                    flex-shrink: 0;
                    background: #fff;
                ">
                    <img src="${imageUrl}" style="
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        transform: scale(2.5);
                        transform-origin: 48% 10%;
                    " />
                </div>
            `;
        }
        
        // Custom profile image - display as-is
        return `
            <img src="${imageUrl}" style="
                width: 44px;
                height: 44px;
                border-radius: 50%;
                object-fit: cover;
                margin-right: 12px;
                flex-shrink: 0;
            " />
        `;
    }
    
    /**
     * Generate PRO badge SVG HTML.
     */
    _generateProBadgeHTML() {
        return `
            <span style="
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                margin-left: 4px;
                flex-shrink: 0;
            ">
                <span style="
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 40%;
                    height: 40%;
                    background-color: #fff;
                    border-radius: 50%;
                    z-index: 0;
                "></span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0.5 24 24" style="position: relative; z-index: 1;">
                    <defs>
                        <linearGradient id="proGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="25%" stop-color="#06D0F9" />
                            <stop offset="85%" stop-color="#DF0DF2" />
                        </linearGradient>
                    </defs>
                    <path fill="url(#proGradient)" fill-rule="evenodd" d="M9.559 3.697a3 3 0 0 1 4.882 0l.19.267a1 1 0 0 0 .925.413l.849-.095a3 3 0 0 1 3.313 3.313l-.095.85a1 1 0 0 0 .413.923l.267.19a3 3 0 0 1 0 4.883l-.267.19a1 1 0 0 0-.413.925l.095.849a3 3 0 0 1-3.313 3.313l-.85-.095a1 1 0 0 0-.923.413l-.19.267a3 3 0 0 1-4.883 0l-.19-.267a1 1 0 0 0-.925-.413l-.849.095a3 3 0 0 1-3.313-3.313l.095-.85a1 1 0 0 0-.413-.923l-.267-.19a3 3 0 0 1 0-4.883l.267-.19a1 1 0 0 0 .413-.925l-.095-.849a3 3 0 0 1 3.313-3.313l.85.095a1 1 0 0 0 .923-.413zm6.148 5.596a1 1 0 0 1 0 1.414l-3.819 3.819c-.49.49-1.286.49-1.776 0l-1.82-1.819a1 1 0 1 1 1.415-1.414L11 12.586l3.293-3.293a1 1 0 0 1 1.414 0" clip-rule="evenodd"></path>
                </svg>
            </span>
        `;
    }
}
