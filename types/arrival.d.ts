/**
 * TypeScript definitions for Arrival.Space Plugin Development
 * 
 * These types provide IDE support (autocomplete, error checking) when developing plugins.
 * 
 * Usage in VS Code:
 * Add this to the top of your .mjs file for type hints:
 * /// <reference path="./types/arrival.d.ts" />
 */

// PlayCanvas types (subset used by plugins)
declare namespace pc {
    class Vec3 {
        x: number;
        y: number;
        z: number;
        constructor(x?: number, y?: number, z?: number);
        set(x: number, y: number, z: number): Vec3;
        copy(src: Vec3): Vec3;
        clone(): Vec3;
        add(rhs: Vec3): Vec3;
        sub(rhs: Vec3): Vec3;
        scale(scalar: number): Vec3;
        normalize(): Vec3;
        length(): number;
        distance(rhs: Vec3): number;
    }

    class Color {
        r: number;
        g: number;
        b: number;
        a: number;
        constructor(r?: number, g?: number, b?: number, a?: number);
        set(r: number, g: number, b: number, a?: number): Color;
    }

    class Entity {
        name: string;
        enabled: boolean;
        parent: Entity | null;
        children: Entity[];
        tags: any;
        
        // Transform
        getPosition(): Vec3;
        setPosition(x: number, y: number, z: number): void;
        getLocalPosition(): Vec3;
        setLocalPosition(x: number, y: number, z: number): void;
        getEulerAngles(): Vec3;
        setEulerAngles(x: number, y: number, z: number): void;
        getLocalEulerAngles(): Vec3;
        setLocalEulerAngles(x: number, y: number, z: number): void;
        getLocalScale(): Vec3;
        setLocalScale(x: number, y: number, z: number): void;
        
        // Rotation helpers
        rotate(x: number, y: number, z: number): void;
        rotateLocal(x: number, y: number, z: number): void;
        lookAt(target: Vec3): void;
        
        // Hierarchy
        addChild(entity: Entity): void;
        removeChild(entity: Entity): void;
        findByName(name: string): Entity | null;
        findByTag(tag: string): Entity[];
        
        // Components
        addComponent(type: string, data?: any): any;
        removeComponent(type: string): void;
        
        // Lifecycle
        destroy(): void;
        
        // Components (when added)
        render?: any;
        collision?: any;
        rigidbody?: any;
        sound?: any;
        script?: any;
    }

    class Application {
        root: Entity;
        assets: any;
        graphicsDevice: any;
        scene: any;
    }

    class Script {
        app: Application;
        entity: Entity;
        enabled: boolean;
        
        initialize?(): void;
        update?(dt: number): void;
        postUpdate?(dt: number): void;
        
        on(event: string, callback: Function): void;
        off(event: string, callback: Function): void;
        once(event: string, callback: Function): void;
        fire(event: string, ...args: any[]): void;
    }

    class StandardMaterial {
        diffuse: Color;
        emissive: Color;
        emissiveIntensity: number;
        opacity: number;
        metalness: number;
        gloss: number;
        diffuseMap: any;
        normalMap: any;
        emissiveMap: any;
        cull: number;
        blendType: number;
        useLighting: boolean;
        update(): void;
    }

    class Texture {
        width: number;
        height: number;
        mipmaps: boolean;
        anisotropy: number;
        addressU: number;
        addressV: number;
    }

    class Asset {
        id: number;
        name: string;
        type: string;
        resource: any;
    }

    class SoundSlot {
        play(): void;
        stop(): void;
        pause(): void;
        resume(): void;
        once(event: string, callback: Function): void;
    }
}

// =============================================================================
// ATTRIBUTE SYSTEM
// =============================================================================

/**
 * Options for defining an attribute
 */
interface AttributeOptions {
    /** Display name in editor (defaults to property name) */
    title?: string;
    /** Minimum value (for numbers/vec3) */
    min?: number;
    /** Maximum value (for numbers/vec3) */
    max?: number;
    /** Step increment (for numbers/vec3) */
    step?: number;
    /** Show in editor UI (default: true, auto-false if property starts with _) */
    ui?: boolean;
    /** UI grouping/section name */
    group?: string;
    /** Enable network synchronization with automatic late-joiner sync (default: false) */
    sync?: boolean;
    /** Who can modify synced values: 'any' | 'owner' | 'self' (default: 'any') */
    authority?: 'any' | 'owner' | 'self';
    /** Min ms between network updates (default: 100) */
    throttle?: number;
    /** Method name called when value changes */
    onChange?: string;
}

/**
 * Define a plugin attribute with optional UI and sync settings.
 * 
 * @param defaultValue - The default value for this attribute
 * @param options - Attribute options
 * @returns Attribute wrapper (processed during plugin initialization)
 * 
 * @example
 * // Local UI property
 * volume = attribute(0.5, { title: 'Volume', min: 0, max: 1 });
 * 
 * @example
 * // Synced property (late joiners automatically get current value)
 * score = attribute(0, { title: 'Score', sync: true });
 * 
 * @example
 * // Owner-only synced property
 * gameActive = attribute(false, { sync: true, authority: 'owner' });
 * 
 * @example
 * // Per-player synced state (each player has their own copy)
 * isReady = attribute(false, { sync: true, authority: 'self' });
 */
declare function attribute<T>(defaultValue: T, options?: AttributeOptions): T;

// =============================================================================
// ARRIVAL SCRIPT BASE CLASS
// =============================================================================

/**
 * Base class for Arrival.Space plugins.
 * Extend this class to create your plugin.
 */
declare class ArrivalScript extends pc.Script {
    /** Current space/room */
    readonly space: any;
    
    /** World position (get/set) */
    position: pc.Vec3;
    
    /** Local position (get/set) */
    localPosition: pc.Vec3;
    
    /** Euler rotation in degrees (get/set) */
    rotation: pc.Vec3;
    
    /** Find entity by name in scene */
    find(name: string): pc.Entity | null;
    
    /** Find all entities with tag */
    findByTag(tag: string): pc.Entity[];
    
    /** Find child entity by name */
    findChild(name: string): pc.Entity | null;
}

/**
 * Global utilities for Arrival.Space plugins.
 */
declare namespace ArrivalSpace {
    /** Version string */
    const VERSION: string;

    interface LoadGLBOptions {
        /** Parent entity to attach to */
        parent?: pc.Entity;
        /** Entity name */
        name?: string;
        /** Uniform scale */
        scale?: number;
        /** Position offset */
        position?: { x: number; y: number; z: number };
        /** Euler rotation in degrees */
        rotation?: { x: number; y: number; z: number };
        /** Cast shadows */
        castShadows?: boolean;
        /** Receive shadows */
        receiveShadows?: boolean;
        /** Load callback */
        onLoad?: (entity: pc.Entity, asset: pc.Asset) => void;
        /** Error callback */
        onError?: (error: Error) => void;
        /** Progress callback (0-1) */
        onProgress?: (progress: number) => void;
    }

    interface LoadTextureOptions {
        name?: string;
        mipmaps?: boolean;
        anisotropy?: number;
        addressU?: 'repeat' | 'clamp' | 'mirror';
        addressV?: 'repeat' | 'clamp' | 'mirror';
    }

    interface PlaySoundOptions {
        /** Entity to attach sound to */
        entity?: pc.Entity;
        /** World position (if no entity) */
        position?: { x: number; y: number; z: number };
        /** Volume 0-1 */
        volume?: number;
        /** Loop playback */
        loop?: boolean;
        /** Playback pitch */
        pitch?: number;
        /** 3D falloff start distance */
        refDistance?: number;
        /** 3D falloff max distance */
        maxDistance?: number;
        /** Distance rolloff factor */
        rollOffFactor?: number;
        /** Use 3D positional audio */
        positional?: boolean;
    }

    interface CreateMaterialOptions {
        /** Diffuse/base color */
        diffuse?: { r: number; g: number; b: number };
        /** Emissive/glow color */
        emissive?: { r: number; g: number; b: number };
        /** Emissive intensity */
        emissiveIntensity?: number;
        /** Diffuse texture */
        diffuseMap?: pc.Texture;
        /** Normal map texture */
        normalMap?: pc.Texture;
        /** Emissive texture */
        emissiveMap?: pc.Texture;
        /** Opacity 0-1 */
        opacity?: number;
        /** Enable transparency */
        transparent?: boolean;
        /** Blend type: 'normal', 'additive', 'multiply' */
        blendType?: 'normal' | 'additive' | 'multiply';
        /** Use lighting */
        useLighting?: boolean;
        /** Render both sides */
        doubleSided?: boolean;
        /** Metalness 0-1 */
        metalness?: number;
        /** Glossiness 0-1 */
        gloss?: number;
    }

    interface CreateHTMLPanelOptions {
        /** World position */
        position: { x: number; y: number; z: number };
        /** Panel width in world units */
        width?: number;
        /** Panel height in world units */
        height?: number;
        /** HTML content */
        html?: string;
        /** Simple text content */
        text?: string;
        /** Euler rotation in degrees */
        rotation?: { x: number; y: number; z: number };
        /** Background color */
        backgroundColor?: string;
        /** Text color */
        textColor?: string;
        /** Font size */
        fontSize?: string;
        /** Resolution (pixels per unit) */
        pixelsPerUnit?: number;
        /** Always face camera */
        billboard?: boolean;
        /** Enable click interactions */
        interactive?: boolean;
    }

    interface CreateTexturePanelOptions {
        /** World position */
        position: { x: number; y: number; z: number };
        /** HTML content */
        html: string;
        /** Panel width in world units */
        width?: number;
        /** Panel height in world units */
        height?: number;
        /** Pixels per world unit */
        resolution?: number;
        /** Euler rotation in degrees */
        rotation?: { x: number; y: number; z: number };
        /** Always face camera */
        billboard?: boolean;
        /** Enable transparency (default: false) */
        transparent?: boolean;
        /** Background color when not transparent (default: '#222222') */
        backgroundColor?: string;
        /** Link click handler */
        onAnchorClick?: (anchor: HTMLAnchorElement) => void;
    }

    interface DisposeEntityOptions {
        /** Also destroy associated assets */
        destroyAssets?: boolean;
        /** Also dispose children */
        recursive?: boolean;
    }

    /** Static gate information */
    interface StaticGate {
        /** Unique identifier for this gate */
        id: string;
        /** The PlayCanvas entity for this gate */
        entity: pc.Entity;
        /** Gate index (0-6) */
        index: number;
        /** Gate logic script reference (may be null if not loaded) */
        gateLogic: {
            id: string;
            titleText: string;
            category: string;
            link: string;
            description: string;
            copyright: string;
            embeddedEnabled: boolean;
            content360Enabled: boolean;
            desktopEnabled: boolean;
            mobileEnabled: boolean;
            vrEnabled: boolean;
            openAsTab: boolean;
            entity: pc.Entity;
        } | null;
    }

    /** Center asset information */
    interface CenterAssetInfo {
        /** Unique identifier for the center */
        id: string;
        /** The PlayCanvas entity for the center */
        entity: pc.Entity;
        /** Center asset script reference (may be null if not loaded) */
        centerAsset: any | null;
    }

    /** Load a GLB/GLTF 3D model */
    function loadGLB(url: string, options?: LoadGLBOptions): Promise<{ entity: pc.Entity; asset: pc.Asset }>;

    /** Load a texture/image */
    function loadTexture(url: string, options?: LoadTextureOptions): Promise<{ texture: pc.Texture; asset: pc.Asset }>;

    /** Play a 3D positional sound */
    function playSound(url: string, options?: PlaySoundOptions): Promise<{ entity: pc.Entity; slot: pc.SoundSlot }>;

    /** Create a material */
    function createMaterial(options?: CreateMaterialOptions): pc.StandardMaterial;

    /** Create an HTML panel (opaque background) */
    function createHTMLPanel(options: CreateHTMLPanelOptions): pc.Entity;

    /** Create a texture panel (supports transparency) */
    function createTexturePanel(options: CreateTexturePanelOptions): Promise<pc.Entity | null>;

    /** Safely dispose an entity and its resources */
    function disposeEntity(entity: pc.Entity, options?: DisposeEntityOptions): void;

    /**
     * Get all static gates in the current space.
     * Static gates are the 7 predefined gates (0-6) that persist across sessions.
     * 
     * @returns Array of gate objects with id, entity, index, and gateLogic
     * 
     * @example
     * const gates = ArrivalSpace.getStaticGates();
     * const firstGatePos = gates[0].entity.getPosition();
     */
    function getStaticGates(): StaticGate[];

    /**
     * Get a specific static gate by index (0-6).
     * 
     * @param index - Gate index (0-6)
     * @returns Gate object or null if not found
     * 
     * @example
     * const gate = ArrivalSpace.getStaticGate(2);
     * if (gate) {
     *     myEntity.setPosition(gate.entity.getPosition());
     * }
     */
    function getStaticGate(index: number): StaticGate | null;

    /**
     * Get the center asset entity of the current space.
     * The center asset is the main 3D content in the room's center.
     * 
     * @returns Center asset object or null if not found
     * 
     * @example
     * const center = ArrivalSpace.getCenterAsset();
     * if (center) {
     *     const pos = center.entity.getPosition();
     * }
     */
    function getCenterAsset(): CenterAssetInfo | null;

    // ═══════════════════════════════════════════════════════════════════════════
    // SCENE UTILITIES (available to all plugins)
    // ═══════════════════════════════════════════════════════════════════════════

    /** Room information */
    interface RoomInfo {
        roomId: string | undefined;
        roomName: string | undefined;
        roomData: any;
        owner: string | undefined;
    }

    /** Entity summary for listing */
    interface EntitySummary {
        name: string;
        enabled: boolean;
        pos: string;
        children: number;
    }

    /** Entity inspection result */
    interface InspectResult {
        info: {
            name: string;
            enabled: boolean;
            position: { x: number; y: number; z: number };
            rotation: { x: number; y: number; z: number };
            scale: { x: number; y: number; z: number };
            parent: string | undefined;
            children: string[];
            scripts: string[];
        };
        entity: pc.Entity;
    }

    /** User profile data */
    interface UserInfo {
        userID: string | undefined;
        userName: string | undefined;
        uniqueName: string | undefined;
        avatar: string | undefined;
    }

    /**
     * Get current room info
     * @example
     * const room = ArrivalSpace.getRoom();
     * console.log('Current room:', room.roomId);
     */
    function getRoom(): RoomInfo;

    /**
     * List all entities in the scene
     * @param logTable - Whether to log as console table
     * @example
     * const entities = ArrivalSpace.getEntities();
     * ArrivalSpace.getEntities(true); // logs to console
     */
    function getEntities(logTable?: boolean): EntitySummary[];

    /**
     * Find entity by name
     * @example
     * const gate = ArrivalSpace.findEntity('Gate_0');
     */
    function findEntity(name: string): pc.Entity | null;

    /**
     * Find entities by tag
     * @example
     * const interactables = ArrivalSpace.findByTag('interactable');
     */
    function findByTag(tag: string): pc.Entity[];

    /**
     * Inspect an entity in detail
     * @example
     * const result = ArrivalSpace.inspectEntity('Camera');
     * console.log(result.info.position);
     */
    function inspectEntity(nameOrEntity: string | pc.Entity): InspectResult | null;

    /**
     * Print scene tree to console
     * @param name - Root entity name (null for entire scene)
     * @example
     * ArrivalSpace.printTree(); // whole scene
     * ArrivalSpace.printTree('CharacterController'); // subtree
     */
    function printTree(name?: string | null): pc.Entity | null;

    /**
     * Move entity to position
     * @example
     * ArrivalSpace.moveEntity('MyObject', 0, 2, -5);
     */
    function moveEntity(nameOrEntity: string | pc.Entity, x: number, y: number, z: number): boolean;

    /**
     * Rotate entity (Euler angles in degrees)
     * @example
     * ArrivalSpace.rotateEntity('MyObject', 0, 90, 0);
     */
    function rotateEntity(nameOrEntity: string | pc.Entity, x: number, y: number, z: number): boolean;

    /**
     * Scale entity uniformly
     * @example
     * ArrivalSpace.scaleEntity('MyObject', 2);
     */
    function scaleEntity(nameOrEntity: string | pc.Entity, s: number): boolean;

    /**
     * Get player entity (CharacterController)
     * @example
     * const player = ArrivalSpace.getPlayer();
     * const pos = player?.getPosition();
     */
    function getPlayer(): pc.Entity | null;

    /**
     * Get camera entity
     * @example
     * const camera = ArrivalSpace.getCamera();
     */
    function getCamera(): pc.Entity | null;

    /**
     * Get current user profile data
     * @example
     * const user = ArrivalSpace.getUser();
     * console.log('Logged in as:', user.userName);
     */
    function getUser(): UserInfo;

    // ═══════════════════════════════════════════════════════════════════════════
    // CAPTURE / SCREENSHOT
    // ═══════════════════════════════════════════════════════════════════════════

    /** Result from captureView */
    interface CaptureViewResult {
        /** Whether the capture succeeded */
        success: boolean;
        /** URL of the uploaded screenshot (if successful) */
        url?: string;
        /** Error message (if failed) */
        error?: string;
    }

    /**
     * Capture the current user view (what the camera sees) and upload it.
     * Returns the URL of the uploaded screenshot.
     * 
     * @param width - Width of the captured image (default: 1024)
     * @param height - Height of the captured image (default: 768)
     * @example
     * const result = await ArrivalSpace.captureView();
     * if (result.success) {
     *     console.log('Screenshot URL:', result.url);
     * }
     * 
     * @example
     * // Capture with custom dimensions
     * const result = await ArrivalSpace.captureView(1920, 1080);
     */
    function captureView(width?: number, height?: number): Promise<CaptureViewResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // SPACE LOADING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Load a space by URL or username
     * @example
     * await ArrivalSpace.loadSpace('johndoe');
     * await ArrivalSpace.loadSpace('https://live.arrival.space/johndoe/gallery');
     */
    function loadSpace(urlOrId: string): Promise<any>;

    /**
     * Load a user's home space by user ID
     * @example
     * await ArrivalSpace.loadUserSpace('abc123');
     */
    function loadUserSpace(userId: string): Promise<any>;

    /**
     * Reload current space
     * @example
     * await ArrivalSpace.reloadSpace();
     */
    function reloadSpace(): Promise<any>;

    // ═══════════════════════════════════════════════════════════════════════════
    // SPACE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /** Options for createSpace */
    interface CreateSpaceOptions {
        /** Space title (default: 'Untitled') */
        title?: string;
        /** Space description */
        description?: string;
        /** Privacy: 'Open', 'Closed', or 'Link Only' (default: 'Closed') */
        privacy?: 'Open' | 'Closed' | 'Link Only';
        /** Environment: 'hub' for full architecture, 'gallery' for minimal (default: 'hub') */
        environment?: 'hub' | 'gallery';
        /** Load the space after creation (default: true) */
        loadAfterCreate?: boolean;
    }

    /** Result from createSpace */
    interface CreateSpaceResult {
        /** Whether the operation succeeded */
        success: boolean;
        /** The room ID (if successful) */
        roomId?: string;
        /** The full room name (if successful) */
        roomName?: string;
        /** The space title (if successful) */
        title?: string;
        /** Error message (if failed) */
        error?: string;
    }

    /** Space info returned by listSpaces */
    interface SpaceInfo {
        /** Space/room ID */
        id: string;
        /** Space title */
        title: string;
        /** Privacy setting */
        privacy: string;
    }

    /**
     * Create a new space and optionally load it
     * @example
     * // Create and load a new private space
     * const result = await ArrivalSpace.createSpace({ title: 'My New Space' });
     * if (result.success) {
     *     console.log('Created space:', result.roomId);
     * }
     * 
     * @example
     * // Create a gallery-style space without loading
     * const result = await ArrivalSpace.createSpace({
     *     title: 'My Gallery',
     *     environment: 'gallery',
     *     privacy: 'Open',
     *     loadAfterCreate: false
     * });
     */
    function createSpace(options?: CreateSpaceOptions): Promise<CreateSpaceResult>;

    /**
     * Get list of user's spaces
     * @param userId - User ID (default: current user)
     * @example
     * const spaces = await ArrivalSpace.listSpaces();
     * spaces.forEach(s => console.log(s.title, s.privacy));
     */
    function listSpaces(userId?: string): Promise<SpaceInfo[]>;

    // ═══════════════════════════════════════════════════════════════════════════
    // PLUGIN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /** Plugin info returned by getPlugins */
    interface PluginInfo {
        /** Entity ID */
        id: string;
        /** Plugin URL on server */
        url: string;
        /** The PlayCanvas entity */
        entity: pc.Entity;
        /** Plugin name */
        name: string;
    }

    /** Options for createPlugin */
    interface CreatePluginOptions {
        /** Plugin name (auto-generated if not provided) */
        name?: string;
        /** Position in world space */
        position?: { x: number; y: number; z: number };
        /** Rotation in Euler angles (degrees) */
        rotation?: { x: number; y: number; z: number };
        /** Uniform scale */
        scale?: number;
        /** Save to server (default: true) */
        persist?: boolean;
    }

    /** Result from createPlugin */
    interface CreatePluginResult {
        /** Whether the operation succeeded */
        success: boolean;
        /** The created entity (if successful) */
        entity?: pc.Entity;
        /** The entity ID (if successful) */
        id?: string;
        /** The plugin URL on server (if successful) */
        url?: string;
        /** The plugin name (if successful) */
        name?: string;
        /** Error message (if failed) */
        error?: string;
    }

    /**
     * Get all plugins in the current space
     * @example
     * const plugins = ArrivalSpace.getPlugins();
     * console.log(`${plugins.length} plugins loaded`);
     * plugins.forEach(p => console.log(p.name, p.url));
     */
    function getPlugins(): PluginInfo[];

    /**
     * Create and deploy a plugin from JavaScript code.
     * Uploads the code to the server and loads it in the current space.
     * 
     * @param code - ES module JavaScript code
     * @param options - Plugin options
     * @example
     * const result = await ArrivalSpace.createPlugin(`
     *   const MyPlugin = pc.createScript('myPlugin');
     *   MyPlugin.prototype.initialize = function() {
     *     console.log('Hello from plugin!');
     *   };
     *   export { MyPlugin };
     * `, { name: 'hello-plugin' });
     * 
     * if (result.success) {
     *   console.log('Plugin created:', result.id);
     * }
     */
    function createPlugin(code: string, options?: CreatePluginOptions): Promise<CreatePluginResult>;

    /**
     * Remove a plugin from the current space
     * @param pluginId - The plugin entity ID
     * @param deleteFromServer - Also delete from server (default: true)
     * @example
     * await ArrivalSpace.removePlugin('plugin-abc123');
     */
    function removePlugin(pluginId: string, deleteFromServer?: boolean): Promise<boolean>;

    /**
     * Hot-reload a plugin with new code
     * Preserves the plugin's position, rotation, and scale.
     * 
     * @param pluginId - The plugin entity ID
     * @param newCode - The new plugin code
     * @example
     * const plugins = ArrivalSpace.getPlugins();
     * const myPlugin = plugins.find(p => p.name.includes('hello'));
     * if (myPlugin) {
     *   await ArrivalSpace.reloadPlugin(myPlugin.id, newCode);
     * }
     */
    function reloadPlugin(pluginId: string, newCode: string): Promise<CreatePluginResult>;

    // ═══════════════════════════════════════════════════════════════════════════
    // MULTIPLAYER / NETWORK API
    // ═══════════════════════════════════════════════════════════════════════════

    /** Player information */
    interface PlayerInfo {
        /** User ID */
        userID: string | null;
        /** Display name */
        userName: string;
        /** Avatar URL */
        avatar: string | null;
        /** Whether this player is the room owner */
        isOwner: boolean;
        /** The player's avatar entity (if in room) */
        entity: pc.Entity | null;
        /** Socket ID (internal) */
        socketId: string | null;
    }

    /** Send options for net.send() */
    interface SendOptions {
        /** Use reliable delivery (default: true) */
        reliable?: boolean;
    }

    /** Message callback type */
    type MessageCallback = (data: any, sender: PlayerInfo) => void;

    /**
     * Multiplayer/Network API for real-time communication
     */
    namespace net {
        /** Whether the network is currently connected */
        const isConnected: boolean;

        /**
         * Send a message to all other players in the room.
         * Note: You will NOT receive your own message back.
         * 
         * @param type - Message type/channel (e.g., 'Chat:message')
         * @param data - Message payload (must be JSON-serializable)
         * @param options - Send options
         * 
         * @example
         * ArrivalSpace.net.send('Chat:message', { text: 'Hello!' });
         */
        function send(type: string, data?: object, options?: SendOptions): void;

        /**
         * Send a message to a specific player (direct/private message).
         * 
         * @param targetUserId - The target player's user ID
         * @param type - Message type/channel
         * @param data - Message payload (must be JSON-serializable)
         * 
         * @example
         * // Send chat history only to a specific player
         * ArrivalSpace.net.sendTo(player.userID, 'Chat:history', { messages });
         * 
         * @example
         * // Private game invite
         * ArrivalSpace.net.sendTo(player.userID, 'Game:invite', { gameId: '123' });
         */
        function sendTo(targetUserId: string, type: string, data?: object): void;

        /**
         * Subscribe to messages of a specific type.
         * 
         * @param type - Message type to listen for
         * @param callback - Called with (data, sender) when message received
         * @returns Unsubscribe function
         * 
         * @example
         * const unsub = ArrivalSpace.net.on('Chat:message', (data, sender) => {
         *     console.log(`${sender.userName}: ${data.text}`);
         * });
         * // Later: unsub();
         */
        function on(type: string, callback: MessageCallback): () => void;

        /**
         * Subscribe to a message type once (auto-unsubscribes after first message)
         * 
         * @param type - Message type to listen for
         * @param callback - Called with (data, sender)
         * @returns Unsubscribe function (to cancel before receiving)
         */
        function once(type: string, callback: MessageCallback): () => void;

        /**
         * Unsubscribe from a message type
         * 
         * @param type - Message type
         * @param callback - Specific callback to remove (if omitted, removes all)
         */
        function off(type: string, callback?: MessageCallback): void;

        /**
         * Get all players currently in the room
         * 
         * @returns Array of player info objects
         * 
         * @example
         * const players = ArrivalSpace.net.getPlayers();
         * console.log(`${players.length} players in room`);
         */
        function getPlayers(): PlayerInfo[];

        /**
         * Subscribe to player join events
         * 
         * @param callback - Called with (playerInfo) when a player joins
         * @returns Unsubscribe function
         */
        function onPlayerJoin(callback: (player: PlayerInfo) => void): () => void;

        /**
         * Subscribe to player leave events
         * 
         * @param callback - Called with (playerInfo) when a player leaves
         * @returns Unsubscribe function
         */
        function onPlayerLeave(callback: (player: PlayerInfo) => void): () => void;

        /**
         * Subscribe to connection events
         * 
         * @param callback - Called when connected to multiplayer
         * @returns Unsubscribe function
         */
        function onConnect(callback: () => void): () => void;

        /**
         * Subscribe to disconnection events
         * 
         * @param callback - Called when disconnected from multiplayer
         * @returns Unsubscribe function
         */
        function onDisconnect(callback: () => void): () => void;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEBUG API (localhost only - for code execution)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Remote debug API - only available on localhost
     * Contains only exec() for security-sensitive code execution
     */
    const debug: {
        /** Execute arbitrary code (security sensitive, localhost only) */
        exec(code: string): any;
        /** Show help */
        help(): void;
    } | undefined;
}