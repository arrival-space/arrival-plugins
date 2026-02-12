#!/usr/bin/env node

/**
 * Arrival.Space CLI
 * 
 * Interactive CLI for Arrival.Space development.
 * Hosts a WebSocket server that the browser connects to automatically on localhost.
 * 
 * Usage:
 *   npx arrival-cli              # Start interactive REPL
 *   npx arrival-cli -e "code"    # Execute code and exit
 *   npx arrival-cli -w           # Watch mode - just relay, no REPL
 */

const WebSocket = require('ws');
const readline = require('readline');
const { program } = require('commander');

const pkg = require('./package.json');

const fs = require('fs');
const path = require('path');

program
    .name('arrival-cli')
    .description('Interactive CLI for Arrival.Space development')
    .version(pkg.version)
    .option('-p, --port <port>', 'WebSocket server port', '9222')
    .option('-e, --eval <code>', 'Execute code and exit')
    .option('-f, --file <path>', 'Execute code from file and exit')
    .option('-d, --deploy <path>', 'Deploy ESM plugin from file')
    .option('-n, --new', 'Force create new plugin (skip reload check)')
    .option('-w, --watch', 'Watch mode - stay connected without REPL')
    .option('-v, --verbose', 'Verbose output');

program.parse();
const options = program.opts();

// Track if this is a plugin deployment
let isPluginDeploy = false;
let pluginCode = null;
let forceNewPlugin = options.new || false;

// If deploy option provided, read the plugin file
if (options.deploy) {
    const filePath = path.resolve(options.deploy);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    pluginCode = fs.readFileSync(filePath, 'utf-8');
    isPluginDeploy = true;
}

// If file option provided, read the file
if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Detect if it's an ESM plugin (has export class ... extends ArrivalScript)
    if (fileContent.includes('export class') && fileContent.includes('ArrivalScript')) {
        pluginCode = fileContent;
        isPluginDeploy = true;
    } else {
        options.eval = fileContent;
    }
}

const PORT = parseInt(options.port, 10);

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

const log = {
    info: (msg) => console.log(`${c.blue}ℹ${c.reset} ${msg}`),
    success: (msg) => console.log(`${c.green}✓${c.reset} ${msg}`),
    error: (msg) => console.log(`${c.red}✗${c.reset} ${msg}`),
    warn: (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`),
    result: (msg) => console.log(`${c.cyan}→${c.reset}`, msg),
    dim: (msg) => console.log(`${c.dim}${msg}${c.reset}`),
};

// Connected browser client
let browserClient = null;
let pendingCallbacks = new Map();
let callbackId = 0;
let replStarted = false;
let rl = null;

/**
 * Start WebSocket server
 */
function startServer() {
    const wss = new WebSocket.Server({ port: PORT });
    
    console.log(`
${c.bright}${c.magenta}╔════════════════════════════════════════╗
║       Arrival.Space CLI v${pkg.version}        ║
╚════════════════════════════════════════╝${c.reset}
`);
    
    log.info(`WebSocket server listening on ${c.cyan}ws://localhost:${PORT}${c.reset}`);
    log.dim('Waiting for browser to connect...');
    log.dim('(Open Arrival.Space on localhost to auto-connect)\n');

    wss.on('connection', (ws, req) => {
        const clientIP = req.socket.remoteAddress;
        browserClient = ws;
        
        log.success(`Browser connected from ${clientIP}`);
        
        // If we have a plugin to deploy, use createPlugin or reloadPlugin
        if (isPluginDeploy && pluginCode) {
            deployPlugin(pluginCode, forceNewPlugin).then(result => {
                if (result?.success) {
                    const count = result.count || 1;
                    const action = result.action === 'reloaded' 
                        ? (count > 1 ? `${count} plugins hot-reloaded` : 'Plugin hot-reloaded')
                        : 'Plugin deployed';
                    log.success(`${action} successfully!`);
                    console.log(`  ${c.dim}ID: ${result.id}${c.reset}`);
                    if (result.url) {
                        console.log(`  ${c.dim}URL: ${result.url}${c.reset}`);
                    }
                } else {
                    log.error(`Deployment failed: ${result?.error || 'Unknown error'}`);
                }
                process.exit(result?.success ? 0 : 1);
            }).catch(err => {
                log.error(err.message);
                process.exit(1);
            });
        }
        // If we have a one-shot eval, execute it
        else if (options.eval) {
            executeCommand(options.eval).then(result => {
                if (result !== undefined) {
                    console.log(formatResult(result));
                }
                process.exit(0);
            }).catch(err => {
                log.error(err.message);
                process.exit(1);
            });
        } else if (!options.watch) {
            // Start REPL only once
            if (!replStarted) {
                replStarted = true;
                startREPL();
            } else if (rl) {
                // Re-prompt on reconnection
                rl.prompt();
            }
        } else {
            log.info('Watch mode - relaying console output');
        }
        
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleMessage(msg);
            } catch (err) {
                if (options.verbose) {
                    log.error(`Invalid message: ${err.message}`);
                }
            }
        });
        
        ws.on('close', () => {
            log.warn('Browser disconnected');
            browserClient = null;
            
            if (options.eval) {
                process.exit(1);
            }
        });
        
        ws.on('error', (err) => {
            log.error(`WebSocket error: ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            log.error(`Port ${PORT} is already in use`);
            log.info('Try a different port with: arrival-cli -p 9223');
        } else {
            log.error(`Server error: ${err.message}`);
        }
        process.exit(1);
    });

    return wss;
}

/**
 * Handle incoming message from browser
 */
function handleMessage(msg) {
    switch (msg.type) {
        case 'result':
            const cb = pendingCallbacks.get(msg.id);
            if (cb) {
                pendingCallbacks.delete(msg.id);
                if (msg.error) {
                    cb.reject(new Error(msg.error));
                } else {
                    cb.resolve(msg.result);
                }
            }
            break;
            
        case 'console':
            // Forward console output from browser
            const prefix = msg.level === 'error' ? c.red : 
                          msg.level === 'warn' ? c.yellow : c.dim;
            console.log(`${prefix}[browser]${c.reset}`, ...msg.args);
            break;
            
        case 'event':
            // Custom events from browser
            if (options.verbose) {
                log.info(`Event: ${msg.event}`);
            }
            break;
            
        case 'info':
            // Browser info on connect
            log.info(`Space: ${c.cyan}${msg.room || 'none'}${c.reset}`);
            log.info(`User: ${c.cyan}${msg.user || 'anonymous'}${c.reset}`);
            console.log();
            // Now show prompt after info is displayed
            if (rl) rl.prompt();
            break;
    }
}

/**
 * Execute command in browser
 */
function executeCommand(code) {
    return new Promise((resolve, reject) => {
        if (!browserClient || browserClient.readyState !== WebSocket.OPEN) {
            reject(new Error('Browser not connected'));
            return;
        }
        
        const id = ++callbackId;
        pendingCallbacks.set(id, { resolve, reject });
        
        // Timeout after 30 seconds
        setTimeout(() => {
            if (pendingCallbacks.has(id)) {
                pendingCallbacks.delete(id);
                reject(new Error('Command timeout'));
            }
        }, 30000);
        
        browserClient.send(JSON.stringify({
            type: 'exec',
            id: id,
            code: code
        }));
    });
}

/**
 * Extract scriptName from plugin code
 * Looks for: static scriptName = 'name' or static scriptName = "name"
 */
function extractScriptName(code) {
    const match = code.match(/static\s+scriptName\s*=\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
}

/**
 * Deploy an ESM plugin - finds existing instances by scriptName and hot-reloads them
 * @param {string} code - The plugin code (ESM format)
 * @param {boolean} forceNew - Force creating a new plugin even if one exists
 * @returns {Promise<{success: boolean, id?: string, url?: string, action?: string, error?: string}>}
 */
async function deployPlugin(code, forceNew = false) {
    // Extract scriptName to identify the plugin
    const scriptName = extractScriptName(code);
    
    if (!scriptName) {
        log.warn('No scriptName found in plugin - creating new instance');
        log.dim('Tip: Add "static scriptName = \'myPlugin\'" to enable hot-reload');
        forceNew = true;
    }
    
    // Escape the code for embedding in JavaScript string
    const escapedCode = code
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');
    
    // If we have a scriptName and not forcing new, find existing plugins by name
    if (scriptName && !forceNew) {
        // Find all plugins with matching scriptName (uses pluginScriptName stored on UserModelEntity)
        const findCommand = `ArrivalSpace.getPlugins().filter(p => p.name === '${scriptName}').map(p => p.id)`;
        
        try {
            const existingIds = await executeCommand(findCommand);
            
            if (Array.isArray(existingIds) && existingIds.length > 0) {
                log.info(`Found ${existingIds.length} instance(s) of '${scriptName}' - hot-reloading...`);
                
                // Reload all instances
                let successCount = 0;
                let lastResult = null;
                
                for (const pluginId of existingIds) {
                    const reloadCommand = `ArrivalSpace.reloadPlugin('${pluginId}', \`${escapedCode}\`)`;
                    const result = await executeCommand(reloadCommand);
                    if (result?.success) {
                        successCount++;
                        lastResult = result;
                        log.dim(`  ✓ Reloaded ${pluginId}`);
                    } else {
                        log.warn(`  ✗ Failed to reload ${pluginId}: ${result?.error || 'unknown'}`);
                    }
                }
                
                if (successCount > 0) {
                    return {
                        success: true,
                        action: 'reloaded',
                        id: existingIds[0],
                        url: lastResult?.url,
                        count: successCount
                    };
                } else {
                    return { success: false, error: 'All reload attempts failed' };
                }
            }
        } catch (e) {
            // Failed to check, fall through to create new
            if (options.verbose) {
                log.dim(`Could not check for existing plugin: ${e.message}`);
            }
        }
    }
    
    // Create new plugin
    log.info(scriptName ? `Creating new plugin '${scriptName}'...` : 'Creating new plugin...');
    const createCommand = `ArrivalSpace.createPlugin(\`${escapedCode}\`)`;
    const result = await executeCommand(createCommand);
    if (result?.success) {
        result.action = 'created';
    }
    return result;
}

/**
 * Format result for display
 */
function formatResult(result) {
    if (result === undefined) return `${c.dim}undefined${c.reset}`;
    if (result === null) return `${c.dim}null${c.reset}`;
    
    try {
        if (typeof result === 'object') {
            return JSON.stringify(result, null, 2);
        }
        return String(result);
    } catch {
        return String(result);
    }
}

/**
 * Start interactive REPL
 */
function startREPL() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${c.green}arrival>${c.reset} `,
        historySize: 100
    });

    console.log(`${c.dim}Type JavaScript to execute in the browser. Special commands:${c.reset}`);
    console.log(`${c.dim}  help          - Show available ArrivalSpace functions${c.reset}`);
    console.log(`${c.dim}  gates         - List all static gates${c.reset}`);
    console.log(`${c.dim}  room          - Show current room info${c.reset}`);
    console.log(`${c.dim}  entities      - List all entities${c.reset}`);
    console.log(`${c.dim}  plugins       - List loaded plugins${c.reset}`);
    console.log(`${c.dim}  spaces        - List your spaces${c.reset}`);
    console.log(`${c.dim}  screenshot    - Capture current view${c.reset}`);
    console.log(`${c.dim}  deploy <file> - Deploy ESM plugin from file${c.reset}`);
    console.log(`${c.dim}  newspace [t]  - Create and load new space${c.reset}`);
    console.log(`${c.dim}  load <url>    - Load a space${c.reset}`);
    console.log(`${c.dim}  reload        - Reload current space${c.reset}`);
    console.log(`${c.dim}  exit          - Exit CLI${c.reset}`);
    console.log();

    // Don't prompt here - wait for 'info' message from browser

    rl.on('line', async (line) => {
        const input = line.trim();
        
        if (!input) {
            rl.prompt();
            return;
        }

        // Handle special commands (with or without dot prefix)
        const isSpecial = await handleSpecialCommand(input);
        if (isSpecial) {
            rl.prompt();
            return;
        }

        // Execute as JavaScript
        try {
            const result = await executeCommand(input);
            if (result !== undefined) {
                log.result(formatResult(result));
            }
        } catch (err) {
            log.error(err.message);
        }
        
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\nGoodbye!');
        process.exit(0);
    });
}

/**
 * Handle special REPL commands
 * Returns true if it was a special command, false otherwise
 */
async function handleSpecialCommand(input) {
    // Normalize: remove leading dot if present
    const cmd = input.startsWith('.') ? input.slice(1) : input;
    const cmdName = cmd.split(' ')[0].toLowerCase();
    const args = cmd.slice(cmdName.length).trim();
    
    const commands = {
        'help': async () => {
            console.log(`
${c.bright}ArrivalSpace API:${c.reset}

${c.cyan}Space Access:${c.reset}
  ArrivalSpace.getStaticGates()     - Get all 7 static gates
  ArrivalSpace.getStaticGate(i)     - Get gate by index (0-6)
  ArrivalSpace.getCenterAsset()     - Get center asset

${c.cyan}Scene Utilities:${c.reset}
  ArrivalSpace.getRoom()            - Current room info
  ArrivalSpace.getEntities()        - List all entities
  ArrivalSpace.findEntity(name)     - Find entity by name
  ArrivalSpace.findByTag(tag)       - Find by tag
  ArrivalSpace.inspectEntity(name)  - Detailed entity info
  ArrivalSpace.printTree()          - Print scene hierarchy

${c.cyan}Manipulation:${c.reset}
  ArrivalSpace.moveEntity(name, x, y, z)
  ArrivalSpace.rotateEntity(name, x, y, z)
  ArrivalSpace.scaleEntity(name, s)

${c.cyan}Space Management:${c.reset}
  ArrivalSpace.loadSpace(url)       - Load space by URL/username
  ArrivalSpace.loadUserSpace(id)    - Load user's home space
  ArrivalSpace.reloadSpace()        - Reload current space
  ArrivalSpace.createSpace(opts)    - Create a new space
  ArrivalSpace.listSpaces()         - List user's spaces

${c.cyan}Plugin Management:${c.reset}
  ArrivalSpace.getPlugins()         - List loaded plugins
  ArrivalSpace.createPlugin(code)   - Deploy new plugin
  ArrivalSpace.removePlugin(id)     - Remove a plugin
  ArrivalSpace.reloadPlugin(id, code) - Hot-reload plugin

${c.cyan}Utilities:${c.reset}
  ArrivalSpace.getPlayer()          - Get player entity
  ArrivalSpace.getCamera()          - Get camera entity
  ArrivalSpace.getUser()            - Get current user info
  ArrivalSpace.captureView(w, h)    - Capture screenshot of current view

${c.cyan}CLI Commands:${c.reset}
  gates                             - List static gates
  room                              - Show room info
  entities                          - List entities  
  plugins                           - List plugins
  spaces                            - List user's spaces
  screenshot [w h]                  - Capture current view (default: 1024x768)
  deploy <file>                     - Deploy ESM plugin from file
  newspace [title]                  - Create and load new space
  load <url|username>               - Load a space
  reload                            - Reload current space
  refresh                           - Full page refresh (F5)
  exit                              - Exit CLI
`);
        },
        
        'gates': async () => {
            const result = await executeCommand('ArrivalSpace.getStaticGates().map(g => ({ index: g.index, title: g.gateLogic?.titleText || "(empty)" }))');
            console.log('\nStatic Gates:');
            if (Array.isArray(result)) {
                result.forEach(g => {
                    console.log(`  [${g.index}] ${g.title}`);
                });
            }
            console.log();
        },
        
        'room': async () => {
            const result = await executeCommand('ArrivalSpace.getRoom()');
            console.log('\nCurrent Room:');
            console.log(`  ID: ${result?.roomId || 'none'}`);
            console.log(`  Name: ${result?.roomName || 'none'}`);
            console.log(`  Owner: ${result?.owner || 'none'}`);
            console.log();
        },
        
        'entities': async () => {
            const result = await executeCommand('ArrivalSpace.getEntities().slice(0, 30)');
            console.log('\nEntities (first 30):');
            if (Array.isArray(result)) {
                result.forEach(e => {
                    const status = e.enabled ? c.green + '●' : c.red + '○';
                    console.log(`  ${status}${c.reset} ${e.name} ${c.dim}(${e.pos})${c.reset}`);
                });
            }
            console.log();
        },
        
        'plugins': async () => {
            const result = await executeCommand('ArrivalSpace.getPlugins().map(p => ({ id: p.id, name: p.name, url: p.url }))');
            console.log('\nLoaded Plugins:');
            if (Array.isArray(result) && result.length > 0) {
                result.forEach(p => {
                    console.log(`  ${c.green}●${c.reset} ${p.name}`);
                    console.log(`    ${c.dim}ID: ${p.id}${c.reset}`);
                    if (p.url) console.log(`    ${c.dim}URL: ${p.url}${c.reset}`);
                });
            } else {
                console.log(`  ${c.dim}(no plugins loaded)${c.reset}`);
            }
            console.log();
        },
        
        'spaces': async () => {
            const result = await executeCommand('ArrivalSpace.listSpaces()');
            console.log('\nYour Spaces:');
            if (Array.isArray(result) && result.length > 0) {
                result.forEach((s, i) => {
                    const privacy = s.privacy === 'Open' ? c.green + '🌐' : 
                                   s.privacy === 'Closed' ? c.yellow + '🔒' : c.cyan + '🔗';
                    console.log(`  ${privacy}${c.reset} ${s.title}`);
                    console.log(`    ${c.dim}ID: ${s.id}${c.reset}`);
                });
            } else {
                console.log(`  ${c.dim}(no spaces found)${c.reset}`);
            }
            console.log();
        },
        
        'screenshot': async () => {
            log.info('Capturing current view...');
            
            // Parse optional dimensions from args (e.g., "screenshot 1920 1080")
            const parts = args.split(/\s+/).filter(Boolean);
            const width = parts[0] ? parseInt(parts[0], 10) : 1024;
            const height = parts[1] ? parseInt(parts[1], 10) : 768;
            
            const code = `ArrivalSpace.captureView(${width}, ${height})`;
            const result = await executeCommand(code);
            
            if (result?.success) {
                log.success('Screenshot captured!');
                console.log(`  ${c.cyan}URL:${c.reset} ${result.url}`);
            } else {
                log.error(`Failed to capture: ${result?.error || 'Unknown error'}`);
            }
            console.log();
        },
        
        'deploy': async () => {
            if (!args) {
                log.error('Usage: deploy [--new] <path/to/plugin.mjs>');
                return;
            }
            
            // Check for --new flag
            let forceNew = false;
            let filePart = args;
            if (args.startsWith('--new ')) {
                forceNew = true;
                filePart = args.slice(6).trim();
            }
            
            const filePath = path.resolve(filePart);
            if (!fs.existsSync(filePath)) {
                log.error(`File not found: ${filePath}`);
                return;
            }
            
            const code = fs.readFileSync(filePath, 'utf-8');
            const result = await deployPlugin(code, forceNew);
            
            if (result?.success) {
                const count = result.count || 1;
                const action = result.action === 'reloaded' 
                    ? (count > 1 ? `${count} plugins hot-reloaded` : 'Plugin hot-reloaded')
                    : 'Plugin deployed';
                log.success(`${action} successfully!`);
                console.log(`  ${c.dim}ID: ${result.id}${c.reset}`);
                if (result.url) {
                    console.log(`  ${c.dim}URL: ${result.url}${c.reset}`);
                }
            } else {
                log.error(`Deployment failed: ${result?.error || 'Unknown error'}`);
            }
            console.log();
        },
        
        'newspace': async () => {
            const title = args || 'New Space';
            log.info(`Creating space: "${title}"...`);
            
            const code = `ArrivalSpace.createSpace({ title: ${JSON.stringify(title)}, loadAfterCreate: true })`;
            const result = await executeCommand(code);
            
            if (result?.success) {
                log.success(`Space created: ${result.roomId}`);
                console.log(`  ${c.dim}Title: ${result.title}${c.reset}`);
                console.log(`  ${c.dim}Room: ${result.roomName}${c.reset}`);
            } else {
                log.error(`Failed to create space: ${result?.error || 'Unknown error'}`);
            }
            console.log();
        },
        
        'load': async () => {
            if (!args) {
                log.error('Usage: load <url|username|spaceId>');
                return;
            }
            log.info(`Loading space: ${args}...`);
            await executeCommand(`ArrivalSpace.loadSpace(${JSON.stringify(args)})`);
        },
        
        'reload': async () => {
            log.info('Reloading space...');
            await executeCommand('ArrivalSpace.reloadSpace()');
        },
        
        'refresh': async () => {
            log.info('Refreshing page...');
            await executeCommand('location.reload()');
        },
        
        'exit': () => {
            process.exit(0);
        },
        
        'quit': () => {
            process.exit(0);
        },
        
        'q': () => {
            process.exit(0);
        }
    };

    const handler = commands[cmdName];
    if (handler) {
        try {
            await handler();
        } catch (err) {
            log.error(err.message);
        }
        return true;
    }
    
    return false;
}

// Start the server
startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
});
