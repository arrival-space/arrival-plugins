/**
 * Space Vote Plugin - The Polys Awards Edition
 * 
 * Shows a voting indicator UI for The Polys 6th Annual Immersive Awards.
 * This space is a Semifinalist for "Splat of the Year 2025"!
 * 
 * Features:
 * - Real-time vote count from server
 * - In-space voting (uses arrival.space voting API)
 * - External link to The Polys official voting page
 * 
 * Vote at: https://thepolys.com/sploty/
 * 
 * Usage: Just add this plugin to any entity in your space.
 */

export class SpaceVotePlugin extends ArrivalScript {
    
    // ═══════════════════════════════════════════════════════════
    // PROPERTIES (shown in editor UI)
    // ═══════════════════════════════════════════════════════════
    accentColor = "#ffc400"; // Gold color for The Polys
    backgroundColor = "#1e1e23"; // Panel background color
    
    // Position and scale
    positionTop = "10px";
    positionBottom = "";
    positionLeft = "";
    positionRight = "60px";
    scale = 1.0;
    
    // Property hints for the editor
    static properties = {
        positionTop: { title: 'Top (e.g. 80px, 10%)' },
        positionBottom: { title: 'Bottom (e.g. 100px, 10%)' },
        positionLeft: { title: 'Left (e.g. 20px, 10%)' },
        positionRight: { title: 'Right (e.g. 20px, 10%)' },
        scale: { title: 'Scale', min: 0.5, max: 2.0, step: 0.1 },
        accentColor: { title: 'Accent Color' },
        backgroundColor: { title: 'Background Color' }
    };
    
    // When true, this plugin only appears in the content list for admins
    static adminOnly = true;
    
    // ═══════════════════════════════════════════════════════════
    // FIXED CONFIG (not exposed to space owners - prefixed with _)
    // ═══════════════════════════════════════════════════════════
    
    _voteUrl = "https://thepolys.com/sploty/";
    _competitionID = "competition_2026_01";
    _linkedSpaceID = "38071386_8727"; // Space ID to link to (e.g., "username" or "username_spaceid")
    _iconUrl = "https://dzrmwng2ae8bq.cloudfront.net/38071386/custom_user_photo.jpeg"; // Custom icon URL (PNG), leave empty for default trophy emoji
    _iconZoom = 1.9; // Zoom level for the icon (clipped at rounded edges)
    
    // Private state (not shown in UI)
    _panel = null;
    _voteCount = 0;
    _hasVoted = false;
    _hideTimeout = null;
    _isMinimized = false;
    _isLoading = false;
    _spaceID = null;
    _creatorName = null;
    _creatorID = null;

    // ═══════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════
    
    async initialize() {
        // Get the current space ID
        this._spaceID = this._getCurrentSpaceID();
        
        // Get creator info from the current space
        this._creatorName = this.app.customTravelCenter?.owner?.name || null;
        this._creatorID = this.app.customTravelCenter?.owner?.id || null;
        
        // Fetch initial vote stats
        await this._fetchVoteStats();
        
        // Create UI and start collapsed
        this._createVoteUI();
        this._minimizePanel();
    }
    
    destroy() {
        if (this._hideTimeout) {
            clearTimeout(this._hideTimeout);
        }
        // Make sure to unlock input if panel is destroyed while hovered
        this.unlockInput();
        // removeUI() is called automatically by ArrivalScript
    }
    
    /**
     * Called when a property is changed in the editor UI.
     * Rebuild the UI to reflect the new values.
     */
    onPropertyChanged(name, value, oldValue) {
        // Rebuild UI when any visual property changes
        const rebuildProps = ['accentColor', 'backgroundColor', 'positionTop', 'positionBottom', 'positionLeft', 'positionRight', 'scale'];
        if (rebuildProps.includes(name)) {
            this._rebuildUI();
        }
    }
    
    _rebuildUI() {
        // Remove existing panel
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
        
        // Recreate with new values
        if (this._isMinimized) {
            this._createVoteUI();
            this._minimizePanel();
        } else {
            this._createVoteUI();
        }
    }
    
    /**
     * Get position style object from custom position values.
     */
    _getPositionStyle() {
        const pos = {};
        if (this.positionTop) pos.top = this.positionTop;
        if (this.positionBottom) pos.bottom = this.positionBottom;
        if (this.positionLeft) pos.left = this.positionLeft;
        if (this.positionRight) pos.right = this.positionRight;
        
        // Default fallback if nothing set
        if (Object.keys(pos).length === 0) {
            return { bottom: '100px', right: '20px' };
        }
        
        return pos;
    }
    
    /**
     * Get transform origin based on position for proper scaling.
     */
    _getTransformOrigin() {
        const pos = this._getPositionStyle();
        const vertical = pos.top ? 'top' : 'bottom';
        const horizontal = pos.left ? 'left' : 'right';
        return `${vertical} ${horizontal}`;
    }

    // ═══════════════════════════════════════════════════════════
    // VOTING UI
    // ═══════════════════════════════════════════════════════════
    
    _createVoteUI() {
        // Build position object from custom values or fall back to preset
        const pos = this._getPositionStyle();
        
        // Convert hex color to RGB for rgba() usage
        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '99, 102, 241';
        };
        const rgb = hexToRgb(this.accentColor);
        const bgRgb = hexToRgb(this.backgroundColor);
        
        // Store for later use
        this._bgRgb = bgRgb;
        
        this._panel = this.createUI('div', {
            id: 'voteable-panel',
            style: {
                position: 'fixed',
                ...pos,
                padding: '20px 24px',
                background: `linear-gradient(145deg, rgba(${bgRgb}, 0.98) 0%, rgba(${bgRgb}, 0.95) 100%)`,
                borderRadius: '16px',
                color: 'white',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(${rgb}, 0.6), 0 0 20px rgba(${rgb}, 0.2)`,
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                cursor: 'default',
                minWidth: '260px',
                zIndex: '1001',
                border: `1px solid rgba(${rgb}, 0.3)`,
                transform: `scale(${this.scale})`,
                transformOrigin: this._getTransformOrigin()
            }
        });
        
        // Store rgb for hover effects
        this._rgb = rgb;
        
        this._updatePanelContent();
        
        // Hover effects + input locking (uses base class lockInput/unlockInput)
        this._panel.onmouseenter = () => {
            this.lockInput();
            this._panel.style.transform = 'scale(1.02)';
            this._panel.style.boxShadow = `0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(${this._rgb}, 0.8), 0 0 30px rgba(${this._rgb}, 0.3)`;
        };
        this._panel.onmouseleave = () => {
            this.unlockInput();
            this._panel.style.transform = 'scale(1)';
            this._panel.style.boxShadow = `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 2px rgba(${this._rgb}, 0.6), 0 0 20px rgba(${this._rgb}, 0.2)`;
        };
    }
    
    _updatePanelContent() {
        if (!this._panel) return;
        
        const trophyIcon = '🏆';
        const isLoggedIn = this._isUserLoggedIn();
        const isRegistered = this._isUserRegistered();
        
        // Determine button state
        let buttonText, buttonBg, buttonHoverBg, buttonTextColor;
        if (this._isLoading) {
            buttonText = '...';
            buttonBg = 'rgba(100, 100, 100, 0.5)';
            buttonHoverBg = buttonBg;
            buttonTextColor = 'white';
        } else if (!isLoggedIn) {
            buttonText = 'Sign in to Vote';
            buttonBg = 'rgba(100, 100, 100, 0.5)';
            buttonHoverBg = 'rgba(100, 100, 100, 0.7)';
            buttonTextColor = 'white';
        } else if (!isRegistered) {
            buttonText = 'Register to Vote';
            buttonBg = 'rgba(100, 100, 100, 0.5)';
            buttonHoverBg = 'rgba(100, 100, 100, 0.7)';
            buttonTextColor = 'white';
        } else if (this._hasVoted) {
            buttonText = '✓ Voted';
            buttonBg = 'rgba(34, 197, 94, 0.9)';
            buttonHoverBg = 'rgba(220, 80, 80, 0.9)';
            buttonTextColor = 'white';
        } else {
            buttonText = 'Upvote this splat';
            buttonBg = `linear-gradient(135deg, rgb(${this._rgb}) 0%, rgba(${this._rgb}, 0.8) 100%)`;
            buttonHoverBg = `linear-gradient(135deg, rgba(${this._rgb}, 1) 0%, rgba(${this._rgb}, 0.9) 100%)`;
            buttonTextColor = '#1a1a1a';
        }
        
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
            
            <!-- Icon & Header -->
            <div style="text-align: center; margin-bottom: 14px;">
                ${this._iconUrl ? `
                <div style="
                    width: 48px;
                    height: 48px;
                    margin: 0 auto 10px auto;
                    border-radius: 50%;
                    overflow: hidden;
                    box-shadow: 0 2px 12px rgba(${this._rgb}, 0.4), 0 0 0 2px rgba(${this._rgb}, 0.3);
                ">
                    <img src="${this._iconUrl}" style="width: ${48 * this._iconZoom}px; height: ${48 * this._iconZoom}px; object-fit: cover; margin: ${(48 - 48 * this._iconZoom) / 2}px;" alt="Award">
                </div>
                ` : ``}
                <div style="
                    font-size: 15px;
                    font-weight: 700;
                    color: white;
                    
                ">Splat of the Year 2025</div>
                <div style="
                    font-size: 11px;
                    color: rgba(255, 255, 255, 0.6);
                    line-height: 1.5;
                    margin-bottom: 6px;
                ">
                    ${this._creatorName ? `Entry by <a href="#" id="creator-link" style="color: rgba(${this._rgb}, 1); text-decoration: none;">${this._creatorName}</a>.<br><br>` : ``}Upvote to help it advance to the <strong style="color: rgba(${this._rgb}, 1);">Grand Jury Finals</strong>.
                </div>
            </div>
            
            <!-- Vote Count Display -->
            <div style="
                text-align: center;
                margin-bottom: 14px;
                padding: 10px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
            ">
                <div style="
                    font-size: 32px;
                    font-weight: 700;
                    background: linear-gradient(135deg, rgb(${this._rgb}) 0%, #F4D03F 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                ">${this._formatVoteCount(this._voteCount)}</div>
                <div style="
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 1.5px;
                    color: rgba(255, 255, 255, 0.5);
                    margin-top: 2px;
                ">Votes</div>
            </div>
            
            <!-- In-Space Vote Button -->
            <button id="vote-btn" style="
                width: 100%;
                padding: 12px 20px;
                background: ${buttonBg};
                border: none;
                border-radius: 10px;
                color: ${buttonTextColor};
                font-size: 14px;
                font-weight: 700;
                cursor: ${this._isLoading ? 'wait' : 'pointer'};
                transition: all 0.2s ease;
                font-family: inherit;
                text-transform: uppercase;
                letter-spacing: 1px;
                box-shadow: 0 4px 15px rgba(${this._rgb}, 0.3);
                margin-bottom: 10px;
            ">${buttonText}</button>
            
            <!-- Visit Main Space Link -->
            ${this._linkedSpaceID ? `
            <a href="#" id="visit-space-link" style="
                display: block;
                text-align: center;
                font-size: 11px;
                color: rgba(${this._rgb}, 0.9);
                text-decoration: none;
                padding: 8px;
                border: 1px solid rgba(${this._rgb}, 0.3);
                border-radius: 8px;
                transition: all 0.2s ease;
            ">
                Browse all nominees →
            </a>
            ` : ''}
        `;
        
        // Vote button click handler
        const voteBtn = this._panel.querySelector('#vote-btn');
        if (voteBtn) {
            if (!this._isLoading) {
                if (!isLoggedIn) {
                    // Not logged in - clicking does nothing for now (could open login)
                    voteBtn.style.cursor = 'not-allowed';
                } else if (!isRegistered) {
                    // Logged in but not registered - open Welcome/Register screen
                    voteBtn.style.cursor = 'pointer';
                    voteBtn.onmouseenter = () => {
                        voteBtn.style.background = buttonHoverBg;
                    };
                    voteBtn.onmouseleave = () => {
                        voteBtn.style.background = buttonBg;
                    };
                    voteBtn.onclick = () => this._openLoginScreen();
                } else {
                    // Logged in and registered - can vote
                    voteBtn.onmouseenter = () => {
                        if (this._hasVoted) {
                            voteBtn.style.background = buttonHoverBg;
                            voteBtn.textContent = '✗ Unvote';
                        } else {
                            voteBtn.style.background = buttonHoverBg;
                            voteBtn.style.transform = 'translateY(-2px)';
                            voteBtn.style.boxShadow = `0 6px 20px rgba(${this._rgb}, 0.5)`;
                        }
                    };
                    voteBtn.onmouseleave = () => {
                        voteBtn.style.background = buttonBg;
                        voteBtn.style.transform = 'translateY(0)';
                        voteBtn.style.boxShadow = `0 4px 15px rgba(${this._rgb}, 0.3)`;
                        if (this._hasVoted) {
                            voteBtn.textContent = '✓ Voted';
                        }
                    };
                    voteBtn.onclick = () => this._toggleVote();
                }
            }
        }
        
        // Visit space link
        const visitSpaceLink = this._panel.querySelector('#visit-space-link');
        if (visitSpaceLink) {
            visitSpaceLink.onmouseenter = () => {
                visitSpaceLink.style.background = `rgba(${this._rgb}, 0.1)`;
                visitSpaceLink.style.borderColor = `rgba(${this._rgb}, 0.5)`;
            };
            visitSpaceLink.onmouseleave = () => {
                visitSpaceLink.style.background = 'transparent';
                visitSpaceLink.style.borderColor = `rgba(${this._rgb}, 0.3)`;
            };
            visitSpaceLink.onclick = (e) => {
                e.preventDefault();
                this._visitLinkedSpace();
            };
        }
        
        // Creator link
        const creatorLink = this._panel.querySelector('#creator-link');
        if (creatorLink) {
            creatorLink.onmouseenter = () => {
                creatorLink.style.textDecoration = 'underline';
            };
            creatorLink.onmouseleave = () => {
                creatorLink.style.textDecoration = 'none';
            };
            creatorLink.onclick = (e) => {
                e.preventDefault();
                this._openCreatorProfile();
            };
        }
        
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
    }
    
    /**
     * Navigate to the linked space.
     */
    async _visitLinkedSpace() {
        if (!this._linkedSpaceID) return;
        
        await ArrivalSpace.loadSpace(this._linkedSpaceID);
    }
    
    /**
     * Open creator profile overlay.
     */
    _openCreatorProfile() {
        if (!this._creatorID) {
            console.warn('🏆 No creatorID to open profile');
            return;
        }
        pc.app.fire(ReactUI.EVENT.CREATOR_PROFILE_CLICK, null, this._creatorID, "info");
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
    
    // ═══════════════════════════════════════════════════════════
    // VOTING API
    // ═══════════════════════════════════════════════════════════
    
    /**
     * Get the current space ID from the loaded scene.
     */
    _getCurrentSpaceID() {
        const room = this.app.loadSceneParameter?.room;
        if (!room) return null;
        
        return room.startsWith('custom.travel.center.') 
            ? room 
            : `custom.travel.center.${room}`;
    }
    
    /**
     * Check if user is logged in.
     */
    _isUserLoggedIn() {
        return !!pc.app.userProfileData?.userID;
    }
    
    /**
     * Check if user is registered (has a valid email, not "<nomail>").
     */
    _isUserRegistered() {
        const email = pc.app.userProfileData?.userEmail;
        return email && email !== "<nomail>";
    }
    
    /**
     * Fetch vote statistics from the server.
     */
    async _fetchVoteStats() {
        if (!this._spaceID) {
            console.warn('🏆 No space ID available for voting');
            return;
        }
        
        try {
            const stats = await pc.app.userProfileData.getSpaceVoteStats(this._spaceID, this._competitionID);
            if (stats) {
                this._voteCount = stats.voteCount || 0;
                this._hasVoted = stats.hasVotedForThis || false;
                //console.log(`🏆 Vote stats loaded: ${this._voteCount} votes, hasVoted: ${this._hasVoted}`);
            }
        } catch (e) {
            console.warn('🏆 Failed to fetch vote stats:', e);
        }
    }
    
    /**
     * Toggle the user's vote (vote or unvote).
     */
    async _toggleVote() {
        if (!this._isUserLoggedIn()) {
            console.log('🏆 User not logged in, cannot vote');
            return;
        }
        
        if (!this._spaceID) {
            console.warn('🏆 No space ID available for voting');
            return;
        }
        
        if (this._isLoading) return;
        
        this._isLoading = true;
        this._updatePanelContent();
        
        try {
            if (this._hasVoted) {
                // Unvote
                const result = await pc.app.userProfileData.unvoteSpace(this._spaceID, this._competitionID);
                if (result) {
                    //console.log('🏆 Successfully unvoted');
                }
            } else {
                // Vote
                const result = await pc.app.userProfileData.voteSpace(this._spaceID, this._competitionID);
                if (!result?.success) {
                    console.warn('🏆 Vote failed:', result?.msg);
                    this._isLoading = false;
                    this._updatePanelContent();
                    return;
                }
                //console.log('🏆 Successfully voted');
            }
            
            // Refresh stats from server
            await this._fetchVoteStats();
            
            // Celebrate if just voted
            if (this._hasVoted) {
                this._celebrateVote();
            }
        } catch (e) {
            console.error('🏆 Vote toggle failed:', e);
        }
        
        this._isLoading = false;
        this._updatePanelContent();
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
    
    _handleVote() {
        // Legacy method - now uses _toggleVote()
        this._toggleVote();
    }
    
    _celebrateVote() {
        if (!this._panel) return;
        
        this._panel.style.animation = 'voteablePulse 0.5s ease';
        
        // Add keyframes if needed
        if (!document.getElementById('voteable-keyframes')) {
            const style = document.createElement('style');
            style.id = 'voteable-keyframes';
            style.textContent = `
                @keyframes voteablePulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                    100% { transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
        
        setTimeout(() => {
            if (this._panel) this._panel.style.animation = '';
        }, 500);
    }
    
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
            transform: scale(${this.scale});
            transform-origin: ${transformOrigin};
        `;
        
        const iconSize = 28 * this._iconZoom;
        
        // Show "VOTE" CTA if user hasn't voted, otherwise show vote count
        const ctaText = this._hasVoted ? `✓ ${this._formatVoteCount(this._voteCount)}` : 'VOTE';
        const ctaBg = this._hasVoted 
            ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.95) 0%, rgba(34, 197, 94, 0.85) 100%)'
            : `linear-gradient(135deg, rgb(${this._rgb}) 0%, #F4D03F 100%)`;
        
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
            ">
                ${this._iconUrl 
                    ? `<img src="${this._iconUrl}" style="width: ${iconSize}px; height: ${iconSize}px; object-fit: cover;" alt="Vote">` 
                    : `<span style="font-size: ${24 * this._iconZoom}px;">🏆</span>`
                }
            </div>
            <span style="
                position: absolute;
                bottom: -2px;
                right: -2px;
                background: ${ctaBg};
                color: #1a1a1a;
                font-size: 9px;
                font-weight: 800;
                padding: 3px 7px;
                border-radius: 10px;
                min-width: 18px;
                text-align: center;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                letter-spacing: 0.5px;
                text-transform: uppercase;
            ">${ctaText}</span>
        `;
        this._panel.onclick = () => this._expandPanel();
        
        this._panel.onmouseenter = () => { 
            this.lockInput();
            this._panel.style.transform = `scale(${this.scale * 1.1})`; 
        };
        this._panel.onmouseleave = () => { 
            this.unlockInput();
            this._panel.style.transform = `scale(${this.scale})`; 
        };
    }
    
    _expandPanel() {
        if (!this._panel) return;
        
        this._isMinimized = false;
        this._panel.remove();
        this._panel = null;
        this._createVoteUI();
    }

    // ═══════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════
    
    /**
     * Manually set the vote count (useful for testing).
     */
    setVoteCount(count) {
        this._voteCount = count;
        this._updatePanelContent();
    }
    
    /**
     * Manually set the voted state (useful for testing).
     */
    setHasVoted(hasVoted) {
        this._hasVoted = hasVoted;
        this._updatePanelContent();
    }
    
    /**
     * Refresh vote stats from the server.
     */
    async refreshVoteStats() {
        await this._fetchVoteStats();
        this._updatePanelContent();
    }
    
}
