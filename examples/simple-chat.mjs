/**
 * Simple Chat Plugin (New API)
 * 
 * Demonstrates both sync patterns:
 * 1. `sync: true` for simple values (typing indicator)
 * 2. Manual send()/sendTo() for arrays (chat history)
 * 
 * This shows when to use each approach.
 */

export class SimpleChatPlugin extends ArrivalScript {
    static scriptName = 'simpleChatPlugin';
    
    // UI configuration (local, not synced)
    maxMessages = attribute(50, { 
        title: 'Max Messages', 
        min: 10, 
        max: 200 
    });
    
    panelWidth = attribute(320, { 
        title: 'Panel Width', 
        min: 200, 
        max: 500 
    });
    
    // Typing indicator - synced automatically (simple value, perfect for sync: true)
    _isTyping = attribute(false, { 
        sync: true, 
        authority: 'self',  // Each player has their own typing state
        onChange: '_onTypingChanged'
    });
    
    // Chat history - LOCAL, not synced (we sync manually for efficiency)
    _history = [];
    
    // UI elements
    _panel = null;
    _messagesEl = null;
    _inputEl = null;
    _typingEl = null;
    _typingTimeout = null;
    _unsubMessage = null;
    _unsubJoin = null;
    _unsubLeave = null;
    _unsubHistory = null;
    
    initialize() {
        console.log('💬 Simple Chat initializing...');
        
        // Create the chat UI
        this._createUI();
        
        // Listen for real-time chat messages
        this._unsubMessage = ArrivalSpace.net.on('SimpleChat:msg', (data, sender) => {
            this._addToHistory(data.text, sender.userName);
            this._renderMessage(data.text, sender.userName, false);
        });
        
        // Send history to new players (manual late-join sync)
        this._unsubJoin = ArrivalSpace.net.onPlayerJoin((player) => {
            // userInfo is guaranteed to be loaded by the time this fires
            this._addSystemMessage(`${player.userName} joined`);
            
            // Send our history to the new player if we're the "host"
            if (this._shouldSendHistory() && this._history.length > 0) {
                setTimeout(() => {
                    ArrivalSpace.net.sendTo(player.userID, 'SimpleChat:history', {
                        messages: this._history.slice(-20)
                    });
                }, 300);
            }
        });
        
        this._unsubLeave = ArrivalSpace.net.onPlayerLeave((player) => {
            // For leave, the name should already be known
            const name = player.userName || 'Someone';
            this._addSystemMessage(`${name} left`);
        });
        
        // Receive history (as a late joiner)
        this._unsubHistory = ArrivalSpace.net.on('SimpleChat:history', (data) => {
            if (data.messages?.length > 0 && this._history.length === 0) {
                console.log('💬 Received history:', data.messages.length, 'messages');
                for (const msg of data.messages) {
                    this._addToHistory(msg.text, msg.sender);
                    this._renderMessage(msg.text, msg.sender, false);
                }
                this._addSystemMessage('— Earlier messages —');
            }
        });
        
        // Welcome message
        this._addSystemMessage('Welcome to the chat - v0.1');
        
        this.once('destroy', () => this._cleanup());
    }
    
    /**
     * Determine if we should send history to new players.
     * Uses deterministic selection: owner if present, else lowest userID.
     */
    _shouldSendHistory() {
        const myId = ArrivalSpace.getUser()?.userID;
        const room = ArrivalSpace.getRoom();
        
        if (myId === room?.owner) return true;
        
        const players = ArrivalSpace.net.getPlayers();
        if (players.length === 0) return true;
        
        const ownerPresent = players.some(p => p.userID === room?.owner);
        if (ownerPresent) return false;
        
        const allIds = [myId, ...players.map(p => p.userID)].filter(Boolean).sort();
        return allIds[0] === myId;
    }
    
    _addToHistory(text, sender) {
        this._history.push({ text, sender, time: Date.now() });
        while (this._history.length > this.maxMessages) {
            this._history.shift();
        }
    }
    
    /**
     * Called when any player's typing state changes.
     * With authority: 'self', each player has their own _isTyping value.
     */
    _onTypingChanged(isTyping, wasTyping, isRemote) {
        if (isRemote) {
            this._updateTypingIndicator();
        }
    }
    
    /**
     * Update the "X is typing..." indicator
     */
    _updateTypingIndicator() {
        if (!this._typingEl) return;
        
        // Get all players who are typing (from per-player state)
        const typingPlayers = ArrivalSpace.net.getPlayers()
            .filter(p => this._getPlayerTyping(p.userID))
            .map(p => p.userName);
        
        if (typingPlayers.length === 0) {
            this._typingEl.style.display = 'none';
        } else if (typingPlayers.length === 1) {
            this._typingEl.textContent = `${typingPlayers[0]} is typing...`;
            this._typingEl.style.display = 'block';
        } else {
            this._typingEl.textContent = `${typingPlayers.length} people typing...`;
            this._typingEl.style.display = 'block';
        }
    }
    
    /**
     * Get a specific player's typing state (from per-player synced state)
     */
    _getPlayerTyping(userId) {
        // Per-player state is stored in _arrivalPerPlayerState by the sync system
        return this._arrivalPerPlayerState?._isTyping?.[userId] || false;
    }
    
    /**
     * Called when user types in the input
     */
    _onInputChange() {
        // Set typing to true
        this._isTyping = true;
        
        // Clear previous timeout
        if (this._typingTimeout) {
            clearTimeout(this._typingTimeout);
        }
        
        // Stop typing after 2 seconds of inactivity
        this._typingTimeout = setTimeout(() => {
            this._isTyping = false;
        }, 2000);
    }
    
    _createUI() {
        // Create main panel using ArrivalScript helper
        this._panel = this.createUI('div', {
            id: 'simpleChat-panel',
            style: {
                position: 'fixed',
                bottom: '8px',
                left: '56px',
                width: `${this.panelWidth}px`,
                height: '400px',
                background: '#80808066',
                backdropFilter: 'blur(50px)',
                WebkitBackdropFilter: 'blur(50px)',
                borderRadius: '20px',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, system-ui, sans-serif',
                zIndex: '1001',
                boxShadow: '0 0 20px 5px rgba(0, 0, 0, 0.15)',
                overflow: 'hidden'
            }
        });
        
        this._panel.innerHTML = `
            <div style="padding: 0 15px; height: 40px; background: #00000026; display: flex; align-items: center; justify-content: space-between;">
                <span style="color: white; font-weight: 600; font-size: 14px; text-shadow: 0px 0px 25px #00000040; line-height: 1;">Room Chat</span>
                <button id="simpleChat-toggle" style="background: none; border: none; color: white; cursor: pointer; font-size: 18px; opacity: 0.7; padding: 0 4px; line-height: 1;">−</button>
            </div>
            <div id="simpleChat-messages" style="flex: 1; overflow-y: auto; padding: 10px; color: white; font-size: 13px;"></div>
            <div id="simpleChat-typing" style="padding: 4px 15px; color: #aaa; font-size: 11px; font-style: italic; display: none;"></div>
            <div id="simpleChat-inputRow" style="padding: 10px; display: flex; gap: 8px;">
                <input type="text" id="simpleChat-input" placeholder="Type a message..." 
                    style="flex: 1; padding: 10px 12px; border-radius: 16px; border: none; background: #00000026; color: white; font-size: 13px; outline: none;"
                    maxlength="200">
                <button id="simpleChat-send" style="padding: 10px 16px; border-radius: 16px; border: none; background: #38b4b0; color: #fff; cursor: pointer; font-weight: 600;">Send</button>
            </div>
        `;
        
        // Get references
        this._messagesEl = this._panel.querySelector('#simpleChat-messages');
        this._inputEl = this._panel.querySelector('#simpleChat-input');
        this._typingEl = this._panel.querySelector('#simpleChat-typing');
        const sendBtn = this._panel.querySelector('#simpleChat-send');
        const toggleBtn = this._panel.querySelector('#simpleChat-toggle');
        const inputRow = this._panel.querySelector('#simpleChat-inputRow');
        
        // Send button click
        sendBtn.onclick = () => this._sendMessage();
        
        // Enter key to send
        this._inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._sendMessage();
        });
        
        // Typing indicator on input
        this._inputEl.addEventListener('input', () => this._onInputChange());
        
        // Toggle minimize
        let isMinimized = false;
        toggleBtn.onclick = () => {
            isMinimized = !isMinimized;
            this._messagesEl.style.display = isMinimized ? 'none' : 'block';
            inputRow.style.display = isMinimized ? 'none' : 'flex';
            this._panel.style.height = isMinimized ? '40px' : '400px';
            toggleBtn.textContent = isMinimized ? '+' : '−';
        };
    }
    
    _sendMessage() {
        const text = this._inputEl.value.trim();
        if (!text) return;
        
        const user = ArrivalSpace.getUser();
        const userName = user?.userName || 'Anonymous';
        
        // Add to local history
        this._addToHistory(text, userName);
        
        // Render locally
        this._renderMessage(text, userName, true);
        
        // Send to other players (efficient - just the message, not full array)
        ArrivalSpace.net.send('SimpleChat:msg', { text });
        
        // Stop typing indicator
        this._isTyping = false;
        if (this._typingTimeout) {
            clearTimeout(this._typingTimeout);
            this._typingTimeout = null;
        }
        
        this._inputEl.value = '';
    }
    
    /**
     * Render a single message to the UI
     */
    _renderMessage(text, sender, isOwn) {
        if (!this._messagesEl) return;
        
        const msgEl = document.createElement('div');
        msgEl.style.cssText = `
            margin-bottom: 8px;
            padding: 8px 12px;
            border-radius: 10px;
            background: ${isOwn ? '#38b4b0' : '#00000026'};
            word-wrap: break-word;
        `;
        
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgEl.innerHTML = `
            <div style="font-size: 11px; color: ${isOwn ? '#9FE8E5' : '#ddd'}; margin-bottom: 3px;">
                ${this._escapeHtml(sender)} · ${time}
            </div>
            <div>${this._escapeHtml(text)}</div>
        `;
        
        this._messagesEl.appendChild(msgEl);
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }
    
    _addSystemMessage(text) {
        const msgEl = document.createElement('div');
        msgEl.style.cssText = `
            margin-bottom: 8px;
            padding: 6px 12px;
            border-radius: 10px;
            background: #00000033;
            color: #fff;
            font-size: 11px;
            text-align: center;
        `;
        msgEl.textContent = text;
        this._messagesEl.appendChild(msgEl);
        this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }
    
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    _cleanup() {
        console.log('💬 Simple Chat shutting down...');
        
        if (this._unsubMessage) this._unsubMessage();
        if (this._unsubJoin) this._unsubJoin();
        if (this._unsubLeave) this._unsubLeave();
        if (this._unsubHistory) this._unsubHistory();
        if (this._typingTimeout) clearTimeout(this._typingTimeout);
        
        // Use ArrivalScript's removeUI for cleanup
        this.removeUI();
    }
}
