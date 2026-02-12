# Arrival.Space CLI

Interactive command-line interface for Arrival.Space development. Connects to your local browser instance via WebSocket for live debugging and scripting.

## Installation

```bash
cd arrival-plugins/tools/arrival-cli
npm install
```

## Usage

### Start the CLI

```bash
# Interactive REPL mode
npm start

# Or directly
node index.js
```

Then open Arrival.Space on localhost (e.g., `http://localhost:3072`). The browser will automatically connect to the CLI.

### Commands

**One-shot execution:**
```bash
node index.js -e "ArrivalSpace.getRoom()"
```

**Watch mode (relay only, no REPL):**
```bash
node index.js -w
```

**Different port:**
```bash
node index.js -p 9223
```

## Interactive REPL

Once connected, you can type JavaScript directly:

```
arrival> ArrivalSpace.getRoom()
→ { roomId: "abc123", roomName: "My Space", owner: "johndoe" }

arrival> ArrivalSpace.getStaticGates().length
→ 7

arrival> ArrivalSpace.loadSpace('someuser')
```

### Special Commands

| Command | Description |
|---------|-------------|
| `help` | Show all ArrivalSpace functions |
| `gates` | List all static gates |
| `room` | Show current room info |
| `entities` | List entities in scene |
| `reload` | Reload current space |
| `exit` | Exit CLI |

## How It Works

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│  arrival-cli    │◄──────────────────►│  Browser        │
│  (Node.js)      │   localhost:9222   │  (localhost)    │
│                 │                    │                 │
│  - WS Server    │    ──exec──►       │  - WS Client    │
│  - REPL         │    ◄─result──      │  - ArrivalSpace │
└─────────────────┘                    └─────────────────┘
```

1. CLI starts a WebSocket server on port 9222
2. When you open Arrival.Space on localhost, it auto-connects
3. Commands typed in CLI are sent to browser
4. Browser executes them and sends results back

## API Reference

All `ArrivalSpace.*` functions are available:

**Space Access:**
- `getStaticGates()` - Get all 7 static gates
- `getStaticGate(i)` - Get gate by index
- `getCenterAsset()` - Get center asset

**Scene Utilities:**
- `getRoom()` - Current room info
- `getEntities()` - List entities
- `findEntity(name)` - Find by name
- `findByTag(tag)` - Find by tag
- `inspectEntity(name)` - Detailed info
- `printTree()` - Scene hierarchy

**Manipulation:**
- `moveEntity(name, x, y, z)`
- `rotateEntity(name, x, y, z)`
- `scaleEntity(name, s)`

**Space Loading:**
- `loadSpace(url)` - Load space
- `loadUserSpace(id)` - Load user's space
- `reloadSpace()` - Reload current

**Utilities:**
- `getPlayer()` - Player entity
- `getCamera()` - Camera entity
- `getUser()` - Current user info

## Troubleshooting

**Port already in use:**
```bash
node index.js -p 9223
```

**Browser not connecting:**
- Make sure you're on `localhost` (not 127.0.0.1 or IP)
- Check browser console for connection messages
- Refresh the page after starting CLI

**Commands timing out:**
- Check browser console for errors
- Make sure the space is fully loaded
