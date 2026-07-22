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

    class Quat {
        x: number;
        y: number;
        z: number;
        w: number;
        constructor(x?: number, y?: number, z?: number, w?: number);
        set(x: number, y: number, z: number, w: number): Quat;
        copy(src: Quat): Quat;
        clone(): Quat;
        setFromEulerAngles(x: number, y: number, z: number): Quat;
        normalize(): Quat;
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
        getRotation(): Quat;
        setRotation(x: number | Quat, y?: number, z?: number, w?: number): void;
        getLocalRotation(): Quat;
        setLocalRotation(x: number | Quat, y?: number, z?: number, w?: number): void;
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
    /** UI editor hint (for example: 'asset' for upload-backed string fields) */
    editor?: string;
    /** Optional file picker accept map for asset-backed string fields */
    acceptedFiles?: Record<string, string[]>;
    /** Optional editor placeholder */
    placeholder?: string;
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
/**
 * Context passed to {@link ArrivalScript.onInstall}.
 */
interface ArrivalScriptInstallContext {
    /** Always `true` for the first-install trigger (reserved for future triggers). */
    isFirstInstall: boolean;
    /** The placed entity's id. */
    entityId: string;
    /** The current space/room id. */
    spaceId: string;
}

/** A 3D vector accepted by many helpers: a `pc.Vec3`, a plain `{x, y, z}`, or an `[x, y, z]` tuple. */
type ArrivalVec3Like = pc.Vec3 | { x: number; y: number; z: number } | [number, number, number];

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

    /** True if the current user owns this space. */
    readonly isOwner: boolean;

    /** Entity the local player is currently standing on, or null. */
    readonly standingObject: pc.Entity | null;

    /** True when running on a touch/mobile device. */
    readonly isMobile: boolean;

    // ── Scoped logging (also prints to the console; buffered for remix-agent diagnostics, rate-limited per vibe) ──

    /** Log a message (also `console.log`). */
    log(...args: any[]): void;
    /** Log a warning (also `console.warn`). */
    warn(...args: any[]): void;
    /** Log an error (also `console.error`). */
    error(...args: any[]): void;

    // ── Standing-object subscriptions ──

    /** Subscribe to standing-object changes. Returns an unsubscribe function. */
    onStandingObjectChanged(callback: (entity: pc.Entity | null) => void): () => void;
    /** Subscribe once to the next standing-object change. Returns an unsubscribe function. */
    onceStandingObjectChanged(callback: (entity: pc.Entity | null) => void): () => void;
    /** Remove a standing-object change listener previously added with onStandingObjectChanged. */
    offStandingObjectChanged(callback: (entity: pc.Entity | null) => void): void;

    // ── Input: keys, locking, mobile sticks ──

    /** Listen for a keydown for a key code or key string. Returns an unsubscribe function; auto-cleaned on destroy. */
    onKeyDown(key: number | string, callback: (event?: any) => void): () => void;
    /** Listen for a keyup for a key code or key string. Returns an unsubscribe function; auto-cleaned on destroy. */
    onKeyUp(key: number | string, callback: (event?: any) => void): () => void;
    /** Lock game pointer/scene input (e.g. while hovering plugin UI). createUI does this automatically. */
    lockInput(): void;
    /** Release a previous lockInput(). */
    unlockInput(): void;
    /** Lock keyboard movement (e.g. while typing in a plugin input). createUI does this automatically for inputs. */
    lockKeyboard(): void;
    /** Release a previous lockKeyboard(). */
    unlockKeyboard(): void;
    /** Mobile left virtual-joystick vector (x = strafe, y = forward), each -1..1. `{x:0,y:0}` on desktop. */
    getLeftStick(): { x: number; y: number };
    /** Mobile right virtual-joystick vector, each -1..1. `{x:0,y:0}` on desktop. */
    getRightStick(): { x: number; y: number };

    // ── 2D UI (HTML overlay above the 3D canvas; auto-removed on destroy) ──

    /** Get (creating on first call) this script's UI container div. Auto-removed on entity destroy. */
    getUIContainer(): HTMLDivElement;
    /** Create an HTML element in this script's UI container, with optional styles and auto input/keyboard locking. */
    createUI(tagName: string, options?: {
        id?: string;
        className?: string;
        innerHTML?: string;
        style?: Partial<CSSStyleDeclaration> | Record<string, string>;
        /** Enable pointer events (default true). */
        interactive?: boolean;
        /** Lock game input on hover (default true for interactive elements). */
        lockInput?: boolean;
        /** Lock keyboard while a contained input/textarea has focus (default true). */
        lockKeyboard?: boolean;
    }): HTMLElement;
    /** Create a styled panel/card in a screen corner or centered. */
    createPanel(options?: {
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
        innerHTML?: string;
        padding?: number;
        background?: string;
        borderRadius?: string;
        style?: Partial<CSSStyleDeclaration> | Record<string, string>;
    }): HTMLDivElement;
    /** Remove this script's UI container and all its contents. Called automatically on destroy. */
    removeUI(): void;
    /** Show or hide this script's UI container. */
    setUIVisible(visible: boolean): void;

    // ── Spawning content owned by this vibe ──

    /**
     * Load a GLB/GLTF into the scene as THIS vibe's model — clicking it in edit mode selects
     * this plugin's entity. Prefer this over `ArrivalSpace.loadGLB` when a plugin spawns its own model.
     * @param url GLB/GLTF URL.
     * @param options Same options as `ArrivalSpace.loadGLB` (parent, name, scale, position, rotation, …).
     */
    createModel(url: string, options?: ArrivalSpace.LoadGLBOptions): Promise<{ entity: pc.Entity; asset: pc.Asset }>;

    /** Create a controllable NPC. Convenience wrapper for `ArrivalSpace.createNPC(options)`; returns the NPC controller. */
    createNPC(options?: Record<string, any>): Promise<any>;

    /** Run a one-shot LLM completion (see `ArrivalSpace.ai.complete`), auto-filling this entity's id. */
    aiComplete(opts?: {
        system?: string;
        prompt?: string;
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
        provider?: 'glm' | 'openai' | 'anthropic';
    }): Promise<{ answer: string; provider: string; model: string; costUsd: number; inputTokens: number; outputTokens: number } | { error: string } | null>;

    // ── Player / physics ──

    /** Set the world physics step rate. @returns true on success. */
    setPhysicsStepRate(stepHz?: number, maxSubSteps?: number): boolean;
    /** Local player's flattened (horizontal) forward direction, or null. */
    getPlayerForward(): pc.Vec3 | null;
    /** Apply a visual-only offset to the local player avatar (no physics effect). Accepts (x, y, z) or a vec3-like. */
    setPlayerAvatarOffset(offsetOrX: ArrivalVec3Like | number, y?: number, z?: number): boolean;

    // ── Camera ──

    /** Set camera mode. */
    setCameraMode(mode: 'free' | 'third' | 'first' | 'orbital'): boolean;
    /** Current camera mode, or null. */
    getCameraMode(): 'free' | 'third' | 'first' | 'orbital' | null;
    /** Set the shared camera target Y offset (first + third person pivots). */
    setCameraTargetHeightOffset(offsetY?: number): boolean;
    /** Get the shared camera target Y offset, or null. */
    getCameraTargetHeightOffset(): number | null;
    /** Set third-person camera distance (clamped to the allowed range). */
    setCameraTargetDistance(distance?: number): boolean;
    /** Position the free camera and optionally aim it at a target (switches to free-cam mode). */
    setFreeCamPose(position: ArrivalVec3Like, lookAt?: ArrivalVec3Like): boolean;
    /** Set the free camera's movement speed and/or raise its max-speed cap. Pass null speed to leave it unchanged. */
    setFreeCamSpeed(speed: number | null, maxSpeed?: number): boolean;
    /** Get the free camera's current movement speed and maximum, or null. */
    getFreeCamSpeed(): { speed: number; maxSpeed: number } | null;

    // ── Lighting / splats ──

    /** Replace the current base room lighting override. Pass null to clear. */
    setLightProbe(config?: any | null): boolean;
    /** Enable the center collision-mesh splat-light material. */
    enableSplatLightMaterial(options?: Record<string, any>): boolean;
    /** Make a light also light splats (moves it to the splat-light layer + enables the splat-light material). */
    addSplatLight(light: pc.Entity | any, options?: Record<string, any>): boolean;
    /** Create a positioned localized light probe. */
    createLocalizedLightProbe(config: any, position: ArrivalVec3Like): any | null;

    /** Override post-effect parameters. Only provided keys are changed; omitted keys keep room defaults. */
    setPostEffects(params: ArrivalSpace.PostEffectsParams): boolean;

    /** Return the current effective post-effect parameters. */
    getPostEffects(): ArrivalSpace.PostEffectsParams | null;

    /**
     * Get the local player's current movement input intent.
     * Works on desktop (W/S/A/D, arrows) and mobile (virtual joystick).
     */
    getMoveInput(): ArrivalSpace.MoveInput;

    /**
     * Persist one of this plugin's editor parameters (the canonical, editor-visible
     * `params` stored on the entity). Use it to pre-set configuration — e.g. from
     * onInstall() — so the value shows in the parameter panel, survives reloads, and is
     * seen by every visitor, exactly as if the user had set it in the editor. Only
     * declared plugin properties are valid names. Updates the live `this[name]` too but
     * does NOT call your own onPropertyChanged().
     * @param name A declared plugin property name.
     * @param value The new value.
     * @param options persist:false sets without uploading (batch, then call save()).
     */
    setParam(name: string, value: any, options?: { persist?: boolean }): Promise<boolean>;

    /** Persist several editor parameters at once (one upload). See setParam(). */
    setParams(values: Record<string, any>, options?: { persist?: boolean }): Promise<boolean>;

    /** Persist the current `params` to the server without changing any values. */
    save(): Promise<boolean>;

    /** Tell the host parameter editor to re-read this plugin's schema. @returns true if a host entity was found. */
    refreshParamSchema(): boolean;

    /** Replace the dropdown options for a parameter at runtime. @returns true if the schema was updated. */
    setParamOptions(paramName: string, options: Array<string | number | object> | object, refresh?: boolean): boolean;

    /** Append (deduped) options to a dropdown parameter at runtime. @returns true if the schema was updated. */
    appendParamOptions(paramName: string, optionsToAdd: Array<string | number>, refresh?: boolean): boolean;

    /** Get the current dropdown options array for a parameter. */
    getParamOptions(paramName: string): any[];

    /**
     * Optional lifecycle hook fired once — right after a user adds this vibe to the
     * space in-app (library install, drag-drop, or upload), in the browser where they
     * added it. Use it to run a one-time setup flow (e.g. open your own configuration
     * panel). It is NOT called on reload, for other visitors, or for CLI/MCP deploys —
     * those should configure the vibe via entity `params` at deploy time instead. May
     * be async. Requires `ArrivalSpace.VERSION` >= `1.12.0`.
     * @param ctx Install context.
     */
    onInstall?(ctx: ArrivalScriptInstallContext): void | Promise<void>;

    /**
     * Optional lifecycle hook fired when this vibe's placed entity is moved or rotated
     * in the editor — on transform-gizmo *finish* (gesture end), not continuously during
     * the drag. Children of `this.entity` follow it automatically and need no handling;
     * use this to re-anchor anything you spawned *separately* from the entity (NPCs,
     * detached sub-entities, physics bodies) so it doesn't sit at its old spot until reload.
     * @param position New world position `{x, y, z}`, or `null` if unchanged.
     * @param rotation New Euler rotation in degrees `{x, y, z}`, or `null` if unchanged.
     */
    onEntityMoved?(
        position: { x: number; y: number; z: number } | null,
        rotation: { x: number; y: number; z: number } | null
    ): void;

    /**
     * Optional lifecycle hook fired when this vibe's in-app editor opens or closes for
     * this entity (the user selects / deselects it in the creator UI). Use it to toggle
     * editor-only helpers (gizmos, guides), pause gameplay while editing, etc. Also fired
     * once right after `initialize()` if the vibe loads while already selected, and with
     * `false` when the entity is unloaded mid-edit.
     *
     * The same transitions are mirrored on the plugin event bus (`this.on(...)`):
     * `plugin:editModeChanged` (payload `{ isEditing, entityId, context }`), plus
     * `plugin:editModeEnter` / `plugin:editModeExit`.
     * @param isEditing True while this vibe's editor is open, false when it closes.
     * @param context Editor context object (creator-badge state), or null.
     */
    onEditModeChanged?(isEditing: boolean, context: any | null): void;
}

/**
 * Global utilities for Arrival.Space plugins.
 */
declare namespace ArrivalSpace {
    /** Version string */
    const VERSION: string;

    // ═══════════════════════════════════════════════════════════════════════════
    // PLUGIN EVENT BUS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Fire an event on the plugin event bus.
     * All plugins listening for the event will be notified.
     * @param event - Event name (use namespaced names, e.g. "myPlugin:eventName")
     * @param args - Arguments passed to listeners
     */
    function fire(event: string, ...args: any[]): void;

    /**
     * Listen for an event on the plugin event bus.
     * @param event - Event name
     * @param callback - Handler function
     */
    function on(event: string, callback: Function): void;

    /**
     * Remove an event listener from the plugin event bus.
     * @param event - Event name
     * @param callback - The same handler function passed to on()
     */
    function off(event: string, callback: Function): void;

    /**
     * Listen for an event once on the plugin event bus.
     * The listener is automatically removed after the first call.
     * @param event - Event name
     * @param callback - Handler function
     */
    function once(event: string, callback: Function): void;

    // ═══════════════════════════════════════════════════════════════════════════

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

    interface LoadSplatOptions {
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
        /** Load callback */
        onLoad?: (entity: pc.Entity, asset: pc.Asset) => void;
        /** Error callback */
        onError?: (error: Error) => void;
    }

    /** Load a Gaussian Splat (.ply, .sog, .spz) */
    function loadSplat(url: string, options?: LoadSplatOptions): Promise<{ entity: pc.Entity; asset: pc.Asset }>;

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
    // POST EFFECTS
    // ═══════════════════════════════════════════════════════════════════════════

    /** Post-effect parameters. Only provided keys override room defaults. */
    interface PostEffectsParams {
        hdrEnabled?: boolean;
        /** Tone mapping algorithm (0–4) */
        toneMapping?: number;
        saturation?: number;
        contrast?: number;
        brightness?: number;
        sharpness?: number;
        bloomEnabled?: boolean;
        bloomIntensity?: number;
        bloomThreshold?: number;
        bloomBlurLevel?: number;
        gamma?: number;
    }

    /** Override post-effect parameters. Only provided keys are changed; omitted keys keep room defaults. */
    function setPostEffects(params: PostEffectsParams): boolean;

    /** Return the current effective post-effect parameters. */
    function getPostEffects(): PostEffectsParams | null;

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

    /** Local player movement input intent (from keyboard, joystick, or gamepad). */
    interface MoveInput {
        /** -1..+1. > 0 = forward (W / up / joystick up), < 0 = back. */
        forward: number;
        /** -1..+1. > 0 = right (D / joystick right), < 0 = left. */
        strafe: number;
        /** True while the jump action is held. */
        jump: boolean;
    }

    /**
     * Get the local player's current movement input intent.
     * Works on desktop (W/S/A/D, arrows) and mobile (virtual joystick).
     * @example
     * const move = ArrivalSpace.getMoveInput();
     * if (move.forward > 0.1) { ... }
     */
    function getMoveInput(): MoveInput;

    /**
     * Get camera entity
     * @example
     * const camera = ArrivalSpace.getCamera();
     */
    function getCamera(): pc.Entity | null;

    /**
     * Set camera mode.
     * @example
     * ArrivalSpace.setCameraMode("free");
     * ArrivalSpace.setCameraMode("third");
     */
    function setCameraMode(mode: "free" | "third" | "first" | "orbital"): boolean;

    /**
     * Get the current camera mode.
     * @example
     * const mode = ArrivalSpace.getCameraMode(); // "third"
     */
    function getCameraMode(): "free" | "third" | "first" | "orbital" | null;

    /**
     * Position the free camera and optionally aim it at a target.
     * Switches to free cam mode first if it is not already active.
     * The horizon is kept level (roll = 0).
     * @example
     * // Jump the free cam to a viewpoint framing an entity
     * const target = entity.getPosition();
     * ArrivalSpace.setFreeCamPose({ x: target.x + 4, y: target.y + 2, z: target.z + 4 }, target);
     */
    function setFreeCamPose(
        position: pc.Vec3 | { x: number; y: number; z: number },
        lookAt?: pc.Vec3 | { x: number; y: number; z: number }
    ): boolean;

    /**
     * Get the cutscene script attached to a cutscene entity.
     * @example
     * const cutscene = ArrivalSpace.getCutsceneScript(cutsceneEntityId);
     * cutscene?.playCutscene();
     */
    function getCutsceneScript(entityId: string): CutsceneScript | null;

    /**
     * Set the free camera's movement speed and/or raise its max speed cap.
     * The scroll-wheel speed adjustment clamps to the max (default 50 m/s) —
     * raise it for large streamed worlds. Requires free cam mode to be active.
     * @param speed - New current speed in m/s, or null to leave unchanged
     * @param maxSpeed - New maximum for the scroll-wheel speed clamp
     * @example
     * ArrivalSpace.setCameraMode("free");
     * ArrivalSpace.setFreeCamSpeed(200, 2000); // 200 m/s now, scroll up to 2 km/s
     */
    function setFreeCamSpeed(speed: number | null, maxSpeed?: number): boolean;

    /**
     * Get the free camera's current movement speed and maximum.
     * Lets plugins that drive the speed (e.g. altitude-proportional flying)
     * detect the user's scroll-wheel adjustments instead of stomping them.
     * Returns null if the free cam is not available (not in free cam mode yet).
     */
    function getFreeCamSpeed(): { speed: number; maxSpeed: number } | null;

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
    // PLUGIN KEY-VALUE STORE
    // ═══════════════════════════════════════════════════════════════════════════

    interface PluginStoreEntry {
        userId: string;
        value: string;
        numval: number | null;
        updatedAt: string;
    }

    interface PluginStorePushOptions {
        /** Numeric value for sorting and min/max modes */
        numval?: number;
        /** Write mode: "unique" (default), "min", "max", or "append" */
        mode?: "unique" | "min" | "max" | "append";
        /** Override space ID (defaults to current space) */
        spaceId?: string;
    }

    interface PluginStoreGetOptions {
        /** Sort order by numval: "asc" (default) or "desc" */
        sort?: "asc" | "desc";
        /** Max entries to return (default 10, max 100) */
        limit?: number;
        /** Override space ID (defaults to current space) */
        spaceId?: string;
    }

    interface PluginStoreDeleteOptions {
        /** Override space ID (defaults to current space) */
        spaceId?: string;
    }

    /** Shape of {@link pluginStore}. */
    interface PluginStore {
        /**
         * Push a value to the store.
         *
         * @example
         * // Save best time (keep lowest)
         * await ArrivalSpace.pluginStore.push("best-time", playerName, { numval: 12.3, mode: "min" });
         *
         * // Save a setting (overwrite)
         * await ArrivalSpace.pluginStore.push("my-setting", "dark-mode");
         */
        push(key: string, value: string, options?: PluginStorePushOptions): Promise<object | false>;

        /**
         * Get entries for a key in the current space.
         *
         * @example
         * // Leaderboard: top 10 fastest times
         * const board = await ArrivalSpace.pluginStore.get("best-time", { sort: "asc", limit: 10 });
         */
        get(key: string, options?: PluginStoreGetOptions): Promise<PluginStoreEntry[] | false>;

        /**
         * Delete own entry for a key.
         */
        delete(key: string, options?: PluginStoreDeleteOptions): Promise<boolean>;
    }

    /**
     * Simple key-value store for plugins, scoped per space + user.
     */
    const pluginStore: PluginStore;

    /** Shape of {@link userData}. */
    interface UserData {
        /**
         * Store a value for the current user. Objects/arrays are auto-JSON-stringified.
         * @param namespace - Access key / namespace (e.g. your space ID)
         * @param key - Data key (max 64 chars)
         * @param value - Any JSON-serialisable value
         * @returns true on success, false on error
         */
        set(namespace: string, key: string, value: any): Promise<boolean>;

        /**
         * Read a value. Returns the parsed value, null if not found, or false on error.
         * @param namespace - Access key / namespace
         * @param key - Data key
         * @param options.userId - Read another user's data
         * @param options.raw - Return raw string instead of auto-parsing JSON
         */
        get(namespace: string, key: string, options?: { userId?: string; raw?: boolean }): Promise<any | null | false>;

        /**
         * Delete a key for the current user.
         * @param namespace - Access key / namespace
         * @param key - Data key
         */
        delete(namespace: string, key: string): Promise<boolean>;

        /**
         * List keys for the current user (or another user).
         * @param namespace - Access key / namespace
         * @param options.prefix - Filter keys by prefix
         * @param options.userId - List another user's keys
         * @param options.limit - Max keys to return (default 100)
         */
        keys(namespace: string, options?: { prefix?: string; userId?: string; limit?: number }): Promise<string[] | false>;
    }

    /**
     * Per-user persistent key-value storage, accessible across spaces.
     * Data is scoped by `namespace` (typically the plugin author's space ID).
     * Only code that knows the namespace can read/write the data.
     *
     * @example
     * const NS = "45637586_1234"; // your space ID = your namespace
     *
     * // Save
     * await ArrivalSpace.userData.set(NS, 'inventory', { items: ['sword'], gold: 100 });
     *
     * // Load (auto-parses JSON)
     * const inv = await ArrivalSpace.userData.get(NS, 'inventory');
     *
     * // List keys
     * const keys = await ArrivalSpace.userData.keys(NS, { prefix: 'inv/' });
     *
     * // Read another user's data
     * const other = await ArrivalSpace.userData.get(NS, 'inventory', { userId: '12345678' });
     */
    const userData: UserData;

    /**
     * General one-shot LLM completion for plugins — build an NPC, a text tool,
     * a classifier, anything. The plugin supplies its own system prompt and
     * messages. Free GLM model by default; entity owners can store their own
     * OpenAI/Anthropic/GLM key server-side (never exposed to plugins or
     * visitors), spent only through a placed vibe entity they own.
     *
     * @example
     * const res = await ArrivalSpace.ai.complete({ prompt: 'Who are you?' });
     * if (res?.answer) showBubble(res.answer);
     */
    namespace ai {
        /**
         * Run a one-shot completion. Provide EITHER `prompt` (one user turn, no
         * history) OR `messages` (a chat, including prior turns).
         * @param opts.system - System prompt / instructions (max 4000 chars)
         * @param opts.prompt - A single user message (sugar for messages)
         * @param opts.messages - Turns, last 20 kept
         * @param opts.provider - 'glm' (free, default) | 'openai' | 'anthropic'
         * @param opts.entityId - Placed vibe entity ID; required to spend the owner's paid key
         * @returns {answer, provider, model, costUsd, inputTokens, outputTokens};
         *   {error} on a server error response; null on network failure
         */
        function complete(opts: {
            system?: string;
            prompt?: string;
            messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
            provider?: 'glm' | 'openai' | 'anthropic';
            entityId?: string;
        }): Promise<{ answer: string; provider: string; model: string; costUsd: number; inputTokens: number; outputTokens: number } | { error: string } | null>;

        /** Store a provider API key for the current user (server-side, write-only). */
        function setKey(provider: 'openai' | 'anthropic' | 'glm', apiKey: string): Promise<boolean>;

        /** Remove a stored provider API key. */
        function clearKey(provider: 'openai' | 'anthropic' | 'glm'): Promise<boolean>;

        /** Which providers have a stored key for the current user (never the keys). */
        function keyStatus(): Promise<{ openai: boolean; anthropic: boolean; glm: boolean } | null>;

        /**
         * Open the native account settings at the profile section
         * (Settings → Profile → AI Keys) so the creator can enter a key.
         * @returns whether the settings screen could be opened
         */
        function openKeySettings(): boolean;
    }

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
    // SEQUENCE PLAYER
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Sequence data types used by the SequencePlayer for keyframe animation,
     * cutscenes, and camera fly-throughs.
     */

    interface SequenceVec3 { x: number; y: number; z: number; }
    interface SequenceQuat { x: number; y: number; z: number; w: number; }
    type SequenceKeyframeData = SequenceVec3 | SequenceQuat | number;

    interface SequenceKeyframe {
        id: string;
        frameNumber: number;
        keyframeData: SequenceKeyframeData;
    }

    interface SequenceMarker {
        id: string;
        frameNumber: number;
        label: string;
        color: string;
        event?: string | null;
        payload?: Record<string, any> | null;
    }

    interface SequenceProperty {
        id?: string;
        label: string;
        type: "vec3" | "quat" | "number";
        keyframes: SequenceKeyframe[];
        minValue?: number | null;
        maxValue?: number | null;
    }

    interface SequenceEntityProperties {
        [propertyKey: string]: SequenceProperty;
    }

    interface SequenceData {
        fps: number;
        entities: Record<string, SequenceEntityProperties>;
        markers: SequenceMarker[];
        /** Legacy single-entity shape still understood by the runtime. */
        properties?: Record<string, SequenceProperty>;
    }

    interface Sequence {
        id: string;
        disabled?: boolean;
        name?: string;
        description?: string;
        data: SequenceData;
    }

    interface SequencePlayerAdapterOptions {
        entityId?: string | null;
        type?: "vec3" | "quat" | "number" | string | null;
        label?: string | null;
        minValue?: number | null;
        maxValue?: number | null;
    }

    interface SequencePlayerGetterOptions {
        entityId?: string | null;
    }

    interface SequencePlayerAdapterDescriptor {
        type?: "vec3" | "quat" | "number" | string | null;
        label: string;
        minValue?: number | null;
        maxValue?: number | null;
    }

    interface SequencePlayerAdapter {
        applyFn: (value: SequenceKeyframeData) => void;
        type?: "vec3" | "quat" | "number" | string | null;
        label?: string | null;
        entityId?: string | null;
        minValue?: number | null;
        maxValue?: number | null;
    }

    /**
     * Built-in PlayCanvas script for playing keyframe sequences.
     *
     * Create on any entity: `entity.script.create("sequencePlayer")`
     *
     * See docs/sequences.md for the usage guide. Cutscenes are usually authored
     * in the visual Sequence Editor and reached via `getCutsceneScript(id)` — see
     * examples/firework-marker-fx.mjs and examples/floating-cutscene-button.mjs.
     */
    interface SequencePlayer {
        /** Restart from the start frame instead of stopping at the end. Editor attribute. */
        loop: boolean;

        /** Begin playback automatically once a sequence is loaded. Editor attribute. */
        autoplay: boolean;

        /**
         * Play from the last keyframe back to the first. Editor attribute, read
         * every frame — set it before `playSequence()` / `resumeSequence()`.
         * When set, `playSequence()` starts at the last frame, playback settles
         * (or loops) at the first frame, `endSequence()` lands on the first
         * frame, and markers fire from high frame numbers to low.
         */
        reverse: boolean;

        /** Load a sequence without starting playback. */
        setSequence(sequence: Sequence): void;

        /** Set and start playing a sequence from its first keyframe (or the last when `reverse` is set). */
        playSequence(sequence: Sequence): void;

        /** Pause at the current frame. */
        pauseSequence(): void;

        /** Resume playback. Restarts from the directional start if at the directional end frame. */
        resumeSequence(): void;

        /**
         * Jump to the directional end frame (last, or first when `reverse` is
         * set), apply it, and fire completion. Use for skip/cancel.
         */
        endSequence(): void;

        /** Set the playhead to a specific frame. Applies adapters if `apply` is true (default). */
        setFrame(frame: number, apply?: boolean): void;

        /** Whether the sequence is currently playing. */
        isPlaying(): boolean;

        /**
         * Register an adapter — called each frame with the interpolated value
         * for the given property key.
         */
        setAdapter(
            propertyKey: string,
            applyFn: (value: SequenceKeyframeData) => void,
            options?: SequencePlayerAdapterOptions,
        ): void;

        /** Remove a previously registered adapter. */
        removeAdapter(propertyKey: string, entityId?: string | null): void;

        /** Read a previously registered adapter. */
        getAdapter(propertyKey: string, entityId?: string | null): SequencePlayerAdapter | null;

        /** Adapter metadata exposed to the Sequence Editor. */
        getAdapterDescriptors(entityId?: string | null): Record<string, SequencePlayerAdapterDescriptor>;

        /**
         * Register a getter — returns the current live value for a property.
         * Used by the Sequence Editor to read back state when recording keyframes.
         */
        setGetter(propertyKey: string, getFn: () => SequenceKeyframeData, options?: SequencePlayerGetterOptions): void;

        /** Remove a previously registered getter. */
        removeGetter(propertyKey: string, entityId?: string | null): void;

        /** Get the current value for one or all properties via registered getters. */
        getCurrentKeyframeData(
            propertyKey?: string,
            entityId?: string | null,
        ): SequenceKeyframeData | Record<string, SequenceKeyframeData> | null;

        /** Clear all adapters and getters. */
        clearAdaptersAndGetters(): void;

        /** Set or read the primary target entity associated with the loaded sequence. */
        setTargetEntity(entity: pc.Entity | null): void;
        getTargetEntity(): pc.Entity | null;

        /** Debug helpers for visualizing the selected entity position path. */
        showPath(options?: { color?: pc.Color | null; samplesPerFrame?: number }): void;
        hidePath(): void;
        isPathActive(): boolean;
        setSelectedEntity(options: { entityId?: string | null; color?: pc.Color | null }): void;

        /** Set a callback for when the sequence finishes or endSequence() is called. */
        setOnComplete(callback: () => void): void;

        /**
         * Listen for sequence events.
         * - `"sequence:marker"` — `{ marker: SequenceMarker, sequence: Sequence }`
         * - `"sequence:complete"` — no payload
         * - `"sequencePlayerScript:currentFrameChange"` — current frame number
         */
        on(event: "sequence:marker", callback: (data: { marker: SequenceMarker; sequence: Sequence }) => void, scope?: any): { off(): void };
        on(event: "sequence:complete", callback: () => void, scope?: any): { off(): void };
        on(event: "sequencePlayerScript:currentFrameChange", callback: (frame: number) => void, scope?: any): { off(): void };

        /** Remove an event listener. */
        off(event: string, callback: Function, scope?: any): void;

        /** Fire an event. */
        fire(event: string, ...args: any[]): void;
    }

    interface CutscenePlaybackOptions {
        /** Marks this run as the auto-playing intro (skips the seamless "in" keyframe). */
        isIntro?: boolean;
        /** Called once when the cutscene finishes or is skipped. */
        onComplete?: () => void;
    }

    /**
     * Cutscene controller attached to a cutscene entity (`cutsceneScript`).
     *
     * Cutscenes are authored in the visual Sequence Editor and saved on an
     * entity. Resolve the controller with `ArrivalSpace.getCutsceneScript(id)`
     * — typically from an `editor: "entity"` property with
     * `filterTypes: ["cutscene"]` — then start playback or react to markers.
     *
     * See docs/sequences.md and examples/floating-cutscene-button.mjs /
     * examples/firework-marker-fx.mjs.
     */
    interface CutsceneScript {
        /** Play from the start. No-op if the cutscene has no keyframes or is disabled. */
        playCutscene(options?: CutscenePlaybackOptions): void;

        /** Open the visual Sequence Editor for this cutscene (desktop only). */
        editCutscene(options?: CutscenePlaybackOptions): void;

        /** Play in render/recording mode with the editor open. */
        renderCutscene(options?: CutscenePlaybackOptions): void;

        /** Skip the running cutscene with a short fade. */
        skipIntroCutscene(): void;

        /** Merge partial config (e.g. `{ loop, triggerWithPosition }`) into the cutscene. */
        setData(data: Record<string, any>): void;

        /** Retarget the sequence's primary entity track. */
        setTarget(targetEntityId: string, entityIndex?: number): void;

        /** Whether the cutscene is set to loop. */
        getLoop(): boolean;

        /**
         * Subscribe to the cutscene's timeline markers. The controller re-fires
         * each `sequence:marker` from its SequencePlayer as `{ marker, sequence }`.
         * Unsubscribe with `off(...)` in `destroy()`.
         */
        on(event: "sequence:marker", callback: (data: { marker: SequenceMarker; sequence: Sequence }) => void, scope?: any): { off(): void } | void;
        on(event: string, callback: Function, scope?: any): { off(): void } | void;
        off(event: string, callback: Function, scope?: any): void;
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
