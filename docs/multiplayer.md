# Multiplayer API

Build real-time multiplayer experiences with synchronized state and messaging.

## Quick Start

```javascript
export class MultiplayerGame extends ArrivalScript {
    static scriptName = 'multiplayerGame';
    
    // Synced properties - automatically shared with all players
    score = attribute(0, { sync: true });
    isGameActive = attribute(false, { sync: true, authority: 'owner' });
    
    initialize() {
        // React to other players
        ArrivalSpace.net.onPlayerJoin((player) => {
            console.log(`${player.userName} joined!`);
        });
        
        // Listen for custom messages
        ArrivalSpace.net.on('Game:action', (data, sender) => {
            console.log(`${sender.userName} performed action:`, data);
        });
    }
    
    doAction() {
        // Send event to other players
        ArrivalSpace.net.send('Game:action', { type: 'jump' });
    }
}
```

---

## Synced Properties with `attribute()`

The `attribute()` function lets you define properties that automatically synchronize across all players.

### Basic Synced Property

```javascript
// This value syncs to all players automatically
score = attribute(0, { sync: true });

// Change it anywhere - all players see the update
this.score = 100;
```

### With UI Options

```javascript
speed = attribute(5, { 
    title: 'Movement Speed',
    min: 1, 
    max: 20,
    sync: true 
});
```

### Authority Control

Control who can modify a synced property:

```javascript
// Anyone can change (default) - last write wins
lightOn = attribute(false, { sync: true, authority: 'any' });

// Only room owner can change
gameSettings = attribute({ mode: 'casual' }, { 
    sync: true, 
    authority: 'owner' 
});

// Each player has their own copy that syncs
isReady = attribute(false, { 
    sync: true, 
    authority: 'self' 
});
```

| Authority | Who Can Modify | Use Case |
|-----------|---------------|----------|
| `'any'` | Any player (last write wins) | Toggles, casual interactions |
| `'owner'` | Room owner only | Game settings, admin controls |
| `'self'` | Each player owns their copy | Ready status, player-specific state |

### Change Callbacks

React to value changes (local or remote):

```javascript
health = attribute(100, {
    sync: true,
    onChange: 'onHealthChanged'
});

onHealthChanged(newValue, oldValue, isRemote) {
    console.log(`Health: ${oldValue} → ${newValue}`);
    if (isRemote) {
        console.log('Changed by another player');
    }
    
    if (newValue <= 0) {
        this.onDeath();
    }
}
```

### Hidden Synced State

Use underscore prefix for synced state hidden from the editor UI:

```javascript
// Synced but not shown in editor
_gamePhase = attribute('lobby', { sync: true });
```

---

## Messaging with `ArrivalSpace.net`

For events, chat, and custom data that doesn't fit the property sync model.

### Sending Messages

```javascript
// Send to all other players (you won't receive your own message)
ArrivalSpace.net.send('Chat:message', { 
    text: 'Hello everyone!' 
});

// Direct message to one player
ArrivalSpace.net.sendTo(targetUserId, 'Chat:whisper', {
    text: 'psst'
});

// Game events
ArrivalSpace.net.send('Game:playerHit', { 
    targetId: 'player123',
    damage: 10 
});
```

### Receiving Messages

```javascript
initialize() {
    // Subscribe to messages
    this._unsub = ArrivalSpace.net.on('Chat:message', (data, sender) => {
        console.log(`${sender.userName}: ${data.text}`);
    });
}

destroy() {
    // Clean up subscription
    if (this._unsub) {
        this._unsub();
    }
}
```

### One-Time Messages

```javascript
// Listen for one message then auto-unsubscribe
ArrivalSpace.net.once('Game:start', (data, sender) => {
    console.log('Game started!');
});
```

### Sender Information

Every message callback receives sender info:

```javascript
ArrivalSpace.net.on('MyEvent', (data, sender) => {
    sender.userID;    // User's ID
    sender.userName;  // Display name
    sender.avatar;    // Avatar URL
    sender.isOwner;   // Is room owner?
    sender.entity;    // Their avatar entity (if visible)
});
```

---

## Player Awareness

Track who's in the room:

### Get Current Players

```javascript
const players = ArrivalSpace.net.getPlayers();
console.log(`${players.length} other players in room`);

for (const player of players) {
    console.log(`- ${player.userName}`);
}
```

### Player Join/Leave Events

```javascript
initialize() {
    ArrivalSpace.net.onPlayerJoin((player) => {
        console.log(`${player.userName} joined`);
        this.showWelcomeMessage(player.userName);
    });
    
    ArrivalSpace.net.onPlayerLeave((player) => {
        console.log(`${player.userName} left`);
    });
}
```

### Connection Status

```javascript
// Check if connected
if (ArrivalSpace.net.isConnected) {
    // Safe to send messages
}

// React to connection changes
ArrivalSpace.net.onConnect(() => {
    console.log('Connected to multiplayer');
});

ArrivalSpace.net.onDisconnect(() => {
    console.log('Disconnected');
});
```

---

## Complete Examples

### Chat Plugin

```javascript
export class ChatPlugin extends ArrivalScript {
    static scriptName = 'chatPlugin';
    
    _messages = [];
    _unsubscribe = null;
    
    initialize() {
        // Subscribe to chat messages
        this._unsubscribe = ArrivalSpace.net.on('Chat:msg', (data, sender) => {
            this._addMessage(data.text, sender.userName, false);
        });
    }
    
    destroy() {
        if (this._unsubscribe) this._unsubscribe();
    }
    
    sendMessage(text) {
        const user = ArrivalSpace.getUser();
        
        // Show locally (send doesn't echo back)
        this._addMessage(text, user.userName, true);
        
        // Send to others
        ArrivalSpace.net.send('Chat:msg', { text });
    }
    
    _addMessage(text, sender, isOwn) {
        this._messages.push({ text, sender, isOwn });
        // Update UI...
    }
}
```

### Synchronized Game State

```javascript
export class TicTacToe extends ArrivalScript {
    static scriptName = 'ticTacToe';
    
    // Game state - only owner can modify
    board = attribute(['','','','','','','','',''], { 
        sync: true, 
        authority: 'owner' 
    });
    
    currentPlayer = attribute('X', { 
        sync: true, 
        authority: 'owner' 
    });
    
    winner = attribute(null, { 
        sync: true, 
        authority: 'owner',
        onChange: 'onWinnerChanged'
    });
    
    initialize() {
        // Listen for move attempts from any player
        ArrivalSpace.net.on('TicTacToe:move', (data, sender) => {
            if (this._isOwner()) {
                this._handleMove(data.index, sender);
            }
        });
    }
    
    // Called by UI when local player clicks a cell
    makeMove(index) {
        // Send move request to owner
        ArrivalSpace.net.send('TicTacToe:move', { index });
        
        // If we're the owner, also handle locally
        if (this._isOwner()) {
            this._handleMove(index, { userName: ArrivalSpace.getUser().userName });
        }
    }
    
    _handleMove(index, player) {
        if (this.board[index] !== '' || this.winner) return;
        
        const newBoard = [...this.board];
        newBoard[index] = this.currentPlayer;
        this.board = newBoard;
        
        // Check for winner...
        this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    }
    
    onWinnerChanged(winner) {
        if (winner) {
            console.log(`${winner} wins!`);
        }
    }
    
    _isOwner() {
        const user = ArrivalSpace.getUser();
        const room = ArrivalSpace.getRoom();
        return user.userID === room.owner;
    }
}
```

### Player Presence Indicators

```javascript
export class PresencePlugin extends ArrivalScript {
    static scriptName = 'presencePlugin';
    
    // Each player's ready status (authority: self)
    isReady = attribute(false, { 
        title: 'Ready',
        sync: true, 
        authority: 'self' 
    });
    
    _playerMarkers = new Map();
    
    initialize() {
        // Create markers for existing players
        for (const player of ArrivalSpace.net.getPlayers()) {
            this._createMarker(player);
        }
        
        // Handle new players
        ArrivalSpace.net.onPlayerJoin((player) => {
            this._createMarker(player);
        });
        
        // Clean up when players leave
        ArrivalSpace.net.onPlayerLeave((player) => {
            const marker = this._playerMarkers.get(player.userID);
            if (marker) {
                marker.destroy();
                this._playerMarkers.delete(player.userID);
            }
        });
    }
    
    _createMarker(player) {
        // Create a 3D indicator above the player
        const panel = ArrivalSpace.createHTMLPanel({
            position: { x: 0, y: 2.5, z: 0 },
            html: `<div style="color: white;">${player.userName}</div>`,
            billboard: true
        });
        
        // Attach to player entity
        if (player.entity) {
            player.entity.addChild(panel);
        }
        
        this._playerMarkers.set(player.userID, panel);
    }
}
```

---

## Best Practices

### 1. Use Properties for State, Messages for Events

```javascript
// ✅ Good: Persistent state as synced property
score = attribute(0, { sync: true });

// ✅ Good: One-time events as messages
ArrivalSpace.net.send('Game:explosion', { x: 10, y: 5 });
```

### 2. Clean Up Subscriptions

```javascript
initialize() {
    this._unsub = ArrivalSpace.net.on('MyEvent', handler);
}

destroy() {
    this._unsub?.();
}
```

### 3. Use Authority Appropriately

```javascript
// Room settings → owner authority
roomTheme = attribute('default', { sync: true, authority: 'owner' });

// Casual toggles → any authority
lightsOn = attribute(true, { sync: true, authority: 'any' });

// Per-player state → self authority
myColor = attribute('#ff0000', { sync: true, authority: 'self' });
```

### 4. Handle Offline Gracefully

```javascript
doNetworkAction() {
    if (!ArrivalSpace.net.isConnected) {
        console.log('Not connected to multiplayer');
        return;
    }
    ArrivalSpace.net.send('MyAction', data);
}
```

---

## API Reference

### `attribute(defaultValue, options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | `string` | Property name | UI display name |
| `min` | `number` | - | Minimum value |
| `max` | `number` | - | Maximum value |
| `step` | `number` | - | Value increment |
| `ui` | `boolean` | `true` | Show in editor |
| `sync` | `boolean` | `false` | Enable network sync |
| `authority` | `string` | `'any'` | `'any'`, `'owner'`, or `'self'` |
| `throttle` | `number` | `100` | Min ms between updates |
| `onChange` | `string` | - | Callback method name |

### `ArrivalSpace.net`

| Method | Description |
|--------|-------------|
| `send(type, data)` | Send message to other players |
| `sendTo(targetUserId, type, data)` | Send message to one specific player |
| `on(type, callback)` | Subscribe to messages (returns unsub fn) |
| `once(type, callback)` | One-time subscription |
| `off(type, callback?)` | Unsubscribe |
| `getPlayers()` | Get all players in room |
| `onPlayerJoin(callback)` | Subscribe to joins |
| `onPlayerLeave(callback)` | Subscribe to leaves |
| `onConnect(callback)` | Subscribe to connection |
| `onDisconnect(callback)` | Subscribe to disconnection |
| `isConnected` | Connection status (boolean) |
