# ArrivalScript / ArrivalSpace Runtime API Reference

Distilled reference for the ArrivalScript / ArrivalSpace runtime API (PlayCanvas v2.x), generated from pluginUtils.js. This is the authoritative API surface — prefer it over reading engine source.

## Lifecycle

- `initialize()` — Called once when the vibe loads. Optional hook the platform calls; not defined on the base class.
  - _gotcha:_ All lifecycle hooks are optional and NOT defined on ArrivalScript — the platform invokes them if present. Do not declare a plugin property named `enabled` (reserved pc.Script prop): it is silently ignored by the property sync system and won't trigger onPropertyChanged.
- `update(dt)` — Called per frame with the frame delta time. Optional hook; not defined on the base class.
  - _gotcha:_ Platform-called only if implemented.
- `postUpdate(dt)` — Called per frame after update with the frame delta time. Optional hook; not defined on the base class.
  - _gotcha:_ Platform-called only if implemented.
- `onPropertyChanged(name, v, old)` — Called when an editor property changes, with the property name, new value, and old value. Optional hook; not defined on the base class.
  - _gotcha:_ setParam/setParams write silently and do NOT re-enter your own onPropertyChanged (you are the one setting the value) — apply side effects yourself in that case.
- `onInstall(ctx)` — Called once, right after a USER adds this vibe to the space in-app (library install, drag-drop, or upload), in the browser where they added it; ctx = { isFirstInstall, entityId, spaceId }.
  - _gotcha:_ NOT called on reload, for other visitors, or for CLI/MCP deploys — those should configure the vibe via entity `params` at deploy time (e.g. via setParam in this hook).
- `destroy()` — Called when the vibe is removed/unloaded. Optional hook; not defined on the base class.
  - _gotcha:_ Platform-called only if implemented. UI containers and managed key handlers are cleaned up automatically (entity 'destroy' triggers removeUI; _arrivalCleanupManagedState unbinds key handlers).

## ArrivalScript instance helpers

- `this.app, this.entity` — Inherited pc.Script accessors: the running PlayCanvas app and the script's host entity. Listed among reserved property names a plugin must not shadow.
  - _gotcha:_ Reserved names — do not declare plugin properties named app/entity (full reserved list at line 2370-2373).
- `get space()` — Current space/room. Returns this.app.customTravelCenter.
- `get isOwner()` — True if the current user is the owner of this space. Delegates to isOwner().
- `get position() / set position(v)` — World position shortcut. Getter returns this.entity.getPosition(); setter calls this.entity.setPosition(v.x, v.y, v.z).
- `get localPosition() / set localPosition(v)` — Local position shortcut. Getter returns this.entity.getLocalPosition(); setter calls this.entity.setLocalPosition(v.x, v.y, v.z).
  - _gotcha:_ Setter reads v.x/v.y/v.z, so pass a Vec3 or {x,y,z} object (not separate args).
- `get rotation() / set rotation(v)` — Rotation (Euler angles) shortcut. Getter returns this.entity.getEulerAngles(); setter calls this.entity.setEulerAngles(v.x, v.y, v.z).
- `get standingObject()` — Entity the player is currently standing on. Delegates to getStandingObject().
- `get isMobile()` — True if running on a touch/mobile device. Returns !!(this.app.touch).
- `log(...args)` — Log a message (also outputs to console as `[plugin]`). Buffered for remix-agent diagnostics.
  - _gotcha:_ Rate-limited per vibe to VIBE_LOG_RATE_MAX (>200/s over a 1000ms window); when the cap is hit a one-time suppression notice is emitted and further lines are dropped until the window resets. Consecutive identical messages from the same entity are deduped into a count.
- `warn(...args)` — Log a warning (also outputs to console.warn as `[plugin]`). Buffered for agent debugging.
  - _gotcha:_ Subject to the same per-vibe log rate limit and consecutive-dedup as log().
- `error(...args)` — Log an error (also outputs to console.error as `[plugin]`). Buffered for agent debugging.
  - _gotcha:_ Subject to the same per-vibe log rate limit and consecutive-dedup as log().
- `onKeyDown(key, callback)  // key: number|string, callback: Function` — Listen for a keydown event for a specific key code or key string.
  - _gotcha:_ Handlers are tracked per-script and auto-cleaned on teardown via _arrivalCleanupManagedState/_cleanupManagedKeyHandlers.
- `onKeyUp(key, callback)  // key: number|string, callback: Function` — Listen for a keyup event for a specific key code or key string.
  - _gotcha:_ Auto-cleaned on teardown like onKeyDown.
- `lockInput()` — Lock game input (mouse capture / scene touch) while interacting with plugin UI. Pushes this onto app.disablePointLock and app.disableSceneTouch.
  - _gotcha:_ Idempotent — guarded by an internal _isInputLocked flag, so repeated calls are no-ops until unlockInput(). Called automatically by createUI interactive elements on hover/touch.
- `unlockInput()` — Unlock game input after leaving UI elements; re-enables mouse capture for camera control. Pops this from app.disablePointLock and app.disableSceneTouch.
  - _gotcha:_ No-op if not currently locked. Called automatically on UI removal (removeUI also unlocks).
- `lockKeyboard()` — Lock keyboard input (WASD etc.) while an input element has focus. Pushes this onto app.disableKeyboardMovement and zeroes in-progress movement.
  - _gotcha:_ Idempotent (guarded by _isKeyboardLocked). On lock it fires app 'firstperson:forward'/'firstperson:strafe'/'firstperson:boost' with 0 to stop any in-progress movement. Called automatically by createUI for input/textarea/contenteditable focus.
- `unlockKeyboard()` — Unlock keyboard input after leaving an input element; re-enables keyboard capture for player movement. Pops this from app.disableKeyboardMovement.
  - _gotcha:_ No-op if not currently locked. Called automatically on blur and on UI removal.
- `getLeftStick()` — Get current left-stick input from the mobile virtual joystick. x = left/right (strafe), y = forward/back, each -1..1.
  - _gotcha:_ Returns { x: 0, y: 0 } on desktop or when no touch is active (reads app._stickInput?.left).
- `getRightStick()` — Get current right-stick input from the mobile virtual joystick (object with x and y values).
  - _gotcha:_ Returns { x: 0, y: 0 } on desktop or when no touch is active (reads app._stickInput?.right).
- `getUIContainer()` — Get or create this script's 2D UI container element — a positioned div overlaying the 3D canvas. Created lazily.
  - _gotcha:_ Lazily creates a global #pluginUiContainer (pointer-events:none) and a per-script child div; container is pointer-events:none by default. Automatically removed when the host entity fires 'destroy' (registers entity.once('destroy', ...) → removeUI()).
- `createUI(tagName, options = {})  // options: {id?, className?, innerHTML?, style? (camelCase), interactive=true, lockKeyboard=true}` — Create a 2D HTML element with common styles applied and append it to the script's UI container.
  - _gotcha:_ interactive defaults true → sets pointerEvents:'auto' and (unless lockInput:false) wires mouseenter/leave + touchstart/end to lockInput/unlockInput (touchend unlock is delayed 100ms to let click fire). lockKeyboard defaults true → binds focus/blur of contained input/textarea/contenteditable to lockKeyboard/unlockKeyboard, re-scanning on a 0ms timeout for innerHTML set after creation. Pass interactive:false for passive overlays.
- `createPanel(options = {})  // options: {position='bottom-right', innerHTML?, padding=16, background='rgba(30,30,40,0.9)', borderRadius='12px', style?}` — Create a styled panel/card UI element (convenience over createUI) positioned via a named corner/center preset.
  - _gotcha:_ position is one of 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center'; unknown/omitted falls back to 'bottom-right'. Applies fixed positioning plus default white text, system-ui font, shadow, and backdrop blur; options.style is merged last.
- `removeUI()` — Remove this script's UI container and all its contents. Called automatically on entity destroy, but can be called manually.
  - _gotcha:_ Also calls unlockInput() and unlockKeyboard() to ensure input is released when the UI is removed.
- `setUIVisible(visible)  // visible: boolean` — Show or hide the script's UI by toggling the container's display between 'block' and 'none'.
  - _gotcha:_ No-op if the UI container hasn't been created yet.
- `setParam(name, value, options = {})  // name: string (declared property), value: *, options: {persist?: boolean}` — Persist one of this plugin's editor parameters (the canonical, editor-visible `params` on the entity) so it shows in the panel, survives reloads, and is seen by every visitor. Updates the live this[name] too.
  - _gotcha:_ Only declared plugin property names are valid. Unlike an editor edit, this does NOT call your own onPropertyChanged — apply side effects yourself. persist:false sets without uploading (batch several then call save()/setParams with persist to upload once). Delegates to setParams.
- `async setParams(values, options = {})  // values: Object<string, any> (declared name → value), options: {persist?: boolean}` — Persist several editor parameters at once in one upload. See setParam().
  - _gotcha:_ Returns false if there is no host UserModelEntity or values is not an object. Writes each via updateParamValue(..., {silent:true}) so it does not re-enter your own onPropertyChanged. Skips the upload (returns true) when options.persist === false.
- `setParamOptions(paramName, options, refresh = true)  // options: Array<string|number|object>|object` — Replace the dropdown options for a plugin parameter (updates both the host UserModelEntity.propertySchema and the script's own schema).
  - _gotcha:_ Returns false if there is no host UserModelEntity or paramName is falsy. When refresh is true it fires 'UserModelEntity:update' to re-render the editor.

## Player & input

- `getPlayer()` — Get the local player entity (the 'CharacterController' node).
- `getPlayerMesh()` — Get the player's avatar mesh entity ('ReadyPlayerMe'), which carries the anim component.
- `getPlayerForward()` — Get the player's horizontal forward vector based on the avatar mesh facing (Y zeroed, normalized, negated).
- `getMoveInput()` — Get the local player's current movement intent (keyboard / mobile joystick / gamepad converge in firstPersonView) instead of polling the keyboard directly.
- `setPlayerCollision(enabled: boolean)` — Enable/disable the player's collision capsule (plus child 'Collision Cyl'/'Collision Cone'); useful when seated in a vehicle.
- `setPlayerAvatarOffset(offsetOrX, y = 0, z = 0)` — Offset the player's avatar mesh from its base local position; accepts either three numbers or a single Vec3-like offset object.
  - _gotcha:_ Caches the base local position the first time and restores it when the target entity changes; passing a new offset target restores the previous one first.
- `getStandingObject()` — Get the entity the player is currently standing on (characterController.groundEntity).
- `setPlayerAnimation(state: string, animationRef: string|null, options?: {inPlace?: boolean=true, inPlaceBoneName?: string, inPlaceBoneTargetLocalPosition?: pc.Vec3|{x,y,z}|number[], gender?: string, startTime?: number=0})` — Replace a character animation state by loading a GLB (or avatar animation catalog entry); persists across avatar reloads until cleared with null. State names: 'Idle', 'Forward' (walk), 'Jumping', 'Signature1'-'Signature4'.
  - _gotcha:_ Only applied to the local player when userProfileData.loadCustomAvatarAnimation is set; always broadcasts the override to peers. Passing null for animationRef resets the state and restores the original track.
- `setPlayerAnimSpeed(state: string, speed: number)` — Set an animation-speed multiplier for a specific state (multiplies the system's computed speed). State names: 'Idle', 'Forward' (walk), 'Jumping'.
  - _gotcha:_ Passing null/undefined for speed deletes the override for that state; no-op if there is no roomData.
- `setPlayerSpeed(multiplier: number)` — Set the character movement speed multiplier (1.0 = default); affects both physics movement and walk animation speed proportionally via roomData.moveSpeed.
  - _gotcha:_ No-op if customTravelCenter.roomData is unavailable.
- `createNPC(options = {})` — Create a lightweight controllable NPC (avatar + animation + locomotion helpers); avatar comes from avatarConfig/avatarParts/avatarUrl (never cloned from the local player). Options include name, parent, position, rotation, scale=0.7, avatarConfig, avatarParts, avatarTints, animations {idle,walk,jump}, headLabel, dynamicCapsule, speed, turnSpeed, onClick/onHoverEnter/onHoverLeave, etc.
  - _gotcha:_ Throws if the multiplayer remote-player template is unavailable. The controller identity is stable across avatar rebuilds (modular↔VRM/RPM); npc.jump() always resolves false. Re-apply setAnimation overrides after an avatarConfig URL change.
- `getAvatarCatalog(gender = "male")` — Get the avatar parts catalog (parts per category: body, head, teeth, eyeLeft, eyeRight, hair, glasses, headwear, facewear, top, bottom, footwear).
- `getAvatarAnimationCatalog(gender = "male")` — Get the avatar animation catalog listing available animation file paths for a gender.
- `getAvatarConfig()` — Get the current avatar's modular parts config (parts map, tints, gender, type).
  - _gotcha:_ Returns null if the avatar is not a modular/parts-based avatar (e.g. a VRM/uploaded URL avatar).
- `setAvatarParts(partsToSet: Object, options = {} /* {tints, gender} */)` — Change one or more avatar parts and re-render the avatar; part IDs come from the catalog (e.g. 'headwear-5.glb'), set a part to null to remove it.
  - _gotcha:_ Temporary (visual only) — does NOT save to the user's profile. If the current avatar has no modular parts (e.g. VRM) it merges onto a default modular base. Empty-string part values are skipped.
- `resetAvatar()` — Reset the avatar to the user's saved state; call this in destroy() to undo temporary avatar changes.
  - _gotcha:_ Busts the loaded-avatar cache (_lastLoadedAvatarUrl = null) and fires 'avatar:ready'.
- `attachPlayerToEntity(entity: pc.Entity, options = {} /* offset:{x,y,z}, animations?, disableCollision?, camera?:{heightOffset,distance}, rate=20, extra?:Function, meshEuler?:Function, meshRotationLag? */)` — Attach the local player to an entity for multiplayer riding (vehicles/mounts); handles collision, camera, animations, mount broadcast and a sideband for the entity quaternion + plugin extras.
  - _gotcha:_ Only one local attachment at a time; returns null if already attached (caller must detach first). Player position is synced by the network manager; remotes derive entity position from the player. Call the returned detach() to restore collision/camera/animations.
- `getLocalPlayerAttachment()` — Get the local player's current attachment state entry (the one flagged _isLocal), if the player is riding an entity.
- `getLocalAttachedEntity()` — Get the entity the local player is currently attached to (riding), if any.

## Entities & geometry

- `loadGLB(url, options = {} /* parent=null, name='LoadedModel', scale=1, position=null, rotation=null, castShadows=true, receiveShadows=true, onLoad=null, onError=null, onProgress=null */)` — Load a GLB container asset and instantiate its render hierarchy under a new container entity (added to options.parent or app.root).
  - _gotcha:_ Throws if url missing. If the target container is destroyed mid-load it aborts and rejects rather than leaking an orphan into the next space (WEB-6945). position/rotation accept {x,y,z} or a Vec3-like .data array; rotation is Euler degrees.
- `loadSplat(url, options = {} /* parent, name='LoadedSplat', scale=1, position, rotation, onLoad, onError */)` — Load a Gaussian splat (.ply/.sog/.spz) and attach it via a gsplat child entity (.spz is decompressed to PLY on the fly; .sog/.asat resolved through the shared splat pipeline).
  - _gotcha:_ Rejects if the gsplat component isn't supported in the engine build, or if the target entity is destroyed mid-load (WEB-6945). Uses the 'Splats' layer when present.
- `disposeEntity(entity: pc.Entity, options = {} /* destroyAssets=false, recursive=true */)` — Safely destroy an entity and optionally unload its render/model/gsplat/sound assets.
  - _gotcha:_ No-op if entity is null or already destroyed. Assets are only collected/removed when destroyAssets:true; recursive controls whether children's assets are collected.
- `getEntities(logTable = false)` — List all entities in the scene as plain summaries.
  - _gotcha:_ When logTable is true it console.table()s only the first 50 entries (the returned array is complete).
- `findEntity(name: string)` — Find an entity by name (app.root.findByName).
- `findByTag(tag: string)` — Find entities by tag (app.root.findByTag).
- `inspectEntity(nameOrEntity: string|pc.Entity)` — Return a detailed info snapshot of an entity (name, enabled, position, rotation, scale, parent, children names, script keys).
- `printTree(name = null)` — Print the scene hierarchy to the console (rooted at named entity, or the whole scene when name is null).
- `moveEntity(nameOrEntity: string|pc.Entity, x: number, y: number, z: number)` — Set an entity's world position (setPosition); accepts a name or entity.
- `rotateEntity(nameOrEntity: string|pc.Entity, x: number, y: number, z: number)` — Set an entity's world Euler rotation in degrees (setEulerAngles); accepts a name or entity.
- `scaleEntity(nameOrEntity: string|pc.Entity, s: number)` — Set an entity's uniform local scale (setLocalScale s,s,s); accepts a name or entity.
- `setPhysicsStepRate(stepHz = 60, maxSubSteps = 10)` — Set the rigidbody simulation rate by writing fixedTimeStep = 1/stepHz and maxSubSteps on the global rigidbody system.
  - _gotcha:_ Non-finite/non-positive inputs fall back to 60 / 10; maxSubSteps is rounded and floored at 1. Global change affecting all physics.
- `enableContinuousCollisionDetection(entity: pc.Entity, options = {} /* radius?, motionThreshold? */)` — Enable Bullet/Ammo continuous collision detection on an entity's rigidbody to prevent tunnelling of fast movers (sets swept-sphere radius + motion threshold and activates the body).
  - _gotcha:_ Requires a rigidbody with a backing Ammo body; radius/motionThreshold default from the collision shape (half the min half-extent / radius) when not provided.

## Materials

- `createMaterial(options = {} /* diffuse, emissive, emissiveIntensity=1, diffuseMap, normalMap, emissiveMap, opacity=1, transparent=false, blendType='normal', useLighting=true, doubleSided=false, metalness=0, gloss=0.5 */)` — Create a configured pc.StandardMaterial; colors accept pc.Color or {r,g,b}; calls material.update() before returning.
  - _gotcha:_ blendType ('additive'/'multiply') is only applied when options.transparent is truthy; doubleSided sets cull = CULLFACE_NONE.
- `loadTexture(url, options = {} /* name='LoadedTexture', mipmaps=true, anisotropy=1, addressU='repeat', addressV='repeat', minFilter='linear_mip_linear', magFilter='linear' */)` — Load an image texture from a URL and apply mipmaps/anisotropy/address modes; address modes 'repeat'|'clamp'|'mirror' map to pc.ADDRESS_* constants.
  - _gotcha:_ Throws if url missing. The minFilter/magFilter options are documented in the JSDoc but the implementation never applies them (only mipmaps, anisotropy, addressU, addressV are set).
- `enableSplatLightMaterial(options = {})` — Enable the center collision-mesh splat-light material so plugins can light splats from the collision mesh; also forces hdr post-effects and fires 'splatLightParamsChanged'.
  - _gotcha:_ JSDoc claims it returns true when the collision mesh is found, but the code has no return statement (returns undefined). Stores options on customTravelCenter.roomData.splatLightParams.
- `addSplatLight(light: pc.LightComponent|pc.Entity, options = {})` — Wire a light so it also lights splats: adds the 'AfterSplat' layer to the light and enables the splat-light material on that same layer (preferred over manual layer wiring).
  - _gotcha:_ Accepts either a light component or an entity owning one. Forwards options (plus a resolved lightLayerID) to enableSplatLightMaterial.
- `setLightProbe(config: LightProbeConfig|null = null)` — Replace the base room lighting override (primaryLight/environment/postEffects); pass null to clear and fall back to room-derived lighting.
- `createLocalizedLightProbe(config: LightProbeConfig, position: ArrivalVec3Like)` — Create a positioned localized light probe at a world position; returns a handle with update(config), setPosition(pos), getPosition(), setEnabled(bool), destroy().

## UI & panels

- `createHTMLPanel(options /* position(required), width=1, height=0.5, html, text, rotation, backgroundColor='#222222', textColor='#ffffff', fontSize='24px', pixelsPerUnit=300, billboard=false, interactive=false, disableOnLook=true */)` — Create a 3D panel that renders live HTML/DOM into 3D space via CSS3 (iframePlane); best for interactive content (buttons/inputs).
  - _gotcha:_ Throws if options.position missing. Requires opaque backgrounds (no true transparency). Has an undocumented lockInput option (default true) in addition to the JSDoc'd options.
- `createTexturePanel(options /* position(required), html(required), width=1, height=0.5, resolution=300, rotation, billboard=false, transparent=false, onClick(href) */)` — Create a 3D panel whose HTML is rendered server-side to a PNG texture with a real alpha channel and clickable anchors; best for transparent overlays / VR / links.
  - _gotcha:_ Throws if position or html missing. NOT interactive (no live buttons/inputs) and requires server rendering; clicks on <a> elements call onClick(href). JSDoc default transparent=true but the code defaults transparent to false.
- `setAppUIVisible(visible: boolean, keepMobileControls)` — Show/hide the app's built-in UI ('UI Game Overlay' — HUD, overlays, name tags) for immersive viewports.
  - _gotcha:_ keepMobileControls is a real second parameter not mentioned in the JSDoc (forwarded to the 'overlay:toggleUI' event). When hiding, it re-applies after 'hideLoadingScreen' (guarded by the load abort signal so a later space load doesn't re-hide the new space's UI). No-op if the overlay entity isn't found.

## Audio

- `playSound(url, options = {} /* entity=null, position=null, volume=1, loop=false, pitch=1, refDistance=1, maxDistance=100, rollOffFactor=1, positional=true */)` — Play a (3D positional by default) sound, attaching it to a provided entity or a temporary entity created at options.position.
  - _gotcha:_ Throws if url missing. Has an undocumented autoCleanup option (default true): non-looping sounds on auto-created entities destroy the entity ~100ms after the slot ends. Stop a looping sound via the returned slot.stop().

## Events

- `fire(name, [arg1], [arg2], ...) — bound pc.EventHandler.fire (line 7858)` — Emit an event on the shared plugin event bus (inter-plugin communication); bound method of a single module-scoped pc.EventHandler.
  - _gotcha:_ It is one global bus shared by every plugin in the space, not per-plugin — name your events with a prefix to avoid collisions.
- `on(name, callback, [scope]) — bound pc.EventHandler.on (line 7859)` — Subscribe a callback to a named event on the shared plugin event bus.
  - _gotcha:_ Listeners persist on the global bus until explicitly removed with off(); a destroyed plugin must clean up its own subscriptions.
- `off([name], [callback], [scope]) — bound pc.EventHandler.off (line 7860)` — Remove event listener(s) from the shared plugin event bus.
- `once(name, callback, [scope]) — bound pc.EventHandler.once (line 7861)` — Subscribe a one-shot callback to a named event on the shared plugin event bus.
- `onStandingObjectChanged(callback: Function, scope?: *)` — Subscribe to changes of the entity the player is standing on; callback receives (currentEntity, previousEntity). Returns an unsubscribe function.
- `onceStandingObjectChanged(callback: Function, scope?: *)` — Subscribe once to the next standing-object change; callback receives (currentEntity, previousEntity). Returns a cancel function.
- `offStandingObjectChanged(callback: Function, scope?: *)` — Remove a standing-object change listener previously registered.
- `onEntityAttachChanged(entity: pc.Entity, callback: Function)` — Listen for remote players mounting/dismounting a given entity; callback gets an info object (userId, offset, quaternion, extra, onExtra) on mount or null on dismount. Returns an unsubscribe function.
  - _gotcha:_ Fires the callback immediately if a remote player is already attached when you subscribe; initializes the attach system lazily on multiplayer connect.

## Camera

- `setCameraTargetHeightOffset(offsetY = 0)` — Set a shared Y offset for first- and third-person camera targets; intended for state changes, not per-frame.
- `setCameraTargetDistance(distance = 2.0)` — Set the third-person camera distance in world units (clamped to the firstPersonView min/max zoom).
- `getCameraTargetHeightOffset()` — Get the current shared camera target Y offset.
- `setCameraMode(mode: "free"|"third"|"first"|"orbital")` — Switch the camera mode.
  - _gotcha:_ Invalid modes warn and return false (does not throw).
- `getCameraMode()` — Get the current camera mode.
- `setFreeCamPose(position: pc.Vec3|{x,y,z}, lookAt?: pc.Vec3|{x,y,z})` — Position the free camera and optionally aim it at a target, keeping the horizon level (roll 0).
  - _gotcha:_ Switches to free-cam mode first if not already active (returns false if that fails or the freeCamView script isn't present).
- `setFreeCamSpeed(speed: number|null, maxSpeed?: number)` — Set the free camera's current movement speed and/or raise its maximum (scroll-wheel speed cap); pass speed=null to only raise the cap.
  - _gotcha:_ Requires free-cam mode to be active (freeCamView only exists on the detached camera). speed is clamped to [0.1, maxSpeed||50].
- `getFreeCamSpeed()` — Get the free camera's current movement speed and maximum (so plugins can detect the user's scroll-wheel adjustments instead of stomping them).
  - _gotcha:_ Returns null if not in free-cam mode.
- `getCamera()` — Get the camera entity (the 'Camera' node).
- `setPostEffects(params: PostEffectsParams)` — Override post-effect parameters (hdrEnabled, toneMapping, saturation, contrast, brightness, sharpness, bloom*, gamma), merging with room defaults so only provided keys change.
- `getPostEffects()` — Return the current effective post-effect parameters (a copy of room defaults / active overrides).
- `captureView(width = 1024, height = 768)` — Capture the current camera view via the ScreenshotEntity, upload it, and return the image URL.
  - _gotcha:_ Resolves {success:false,error} rather than throwing when the screenshot system is unavailable or capture fails.

## Room & user

- `getRoom()` — Get current room/space info ({roomId, roomName, roomData, owner}).
- `isOwner()` — Check whether the current user is the owner of the current space.
  - _gotcha:_ Owner comparison is loose (==) to tolerate number/string user-ID mismatch.
- `getUser()` — Get the current user's profile summary ({userID, userName, uniqueName, avatar}).
- `getStaticGates()` — Get all static gates of the current space via the GateServer.
  - _gotcha:_ Returns [] (with a warning) when the GateServer is not found.
- `getStaticGate(index: number)` — Get a specific static gate by index (0-6).
  - _gotcha:_ Warns and returns null on an invalid index (valid range 0-6) or if the GateServer is missing.
- `getCenterAsset()` — Get the center asset entity of the current space (the main 3D content in the room center).
  - _gotcha:_ Looks up a fixed center GUID ('496ba0ce-2628-4a36-8e02-2d7332d55528'); returns null if the GateServer or entity is absent.
- `getCutsceneScript(entityId: string)` — Get the cutsceneScript instance on a given entity via the GateServer.
- `loadSpace(urlOrId: string)` — Load a space by full URL or by username/path; bare ids are expanded to https://live.arrival.space/<id>.
- `loadUserSpace(userId: string)` — Load a user's home space by user ID.
- `reloadSpace()` — Reload the currently loaded space (custom.travel.center with the current room id).
  - _gotcha:_ Warns and returns undefined if no space is currently loaded.
- `createSpace(options = {} /* title='Untitled', description, privacy='Closed', environment='hub', loadAfterCreate=true */)` — Create a new space (and load it by default); environment 'hub' = full architecture, 'gallery' = minimal.
  - _gotcha:_ Validates privacy against ['Open','Closed','Link Only']; requires a logged-in user. Returns {success:false,error} instead of throwing for the caught failures.
- `listSpaces(userId?: string)` — List a user's spaces (defaults to the current user).
  - _gotcha:_ Returns [] on error; parses each room's data field whether it's a JSON string or object.
- `getPlugins()` — Get all plugins in the current space (UserModelEntity instances with dataType 'plugin').
- `createPlugin(code: string, options = {} /* name, position={x,y,z}, rotation={x,y,z}, scale=1, persist=true */)` — Upload plugin JS (ES module) as a .mjs file and deploy it as a new UserModelEntity in the current space.
  - _gotcha:_ Name is auto-derived from `static scriptName` in the code if options.name is absent. Registers the entity before persisting to avoid duplicate creation; persist:false skips the server upload. Returns {success:false,error} on caught failures.
- `removePlugin(pluginId: string, deleteFromServer = true)` — Remove a plugin from the current space, firing 'destroy' on its child plugin script instances first so cleanup handlers run.
  - _gotcha:_ Warns and returns false if the plugin id isn't found; waits ~100ms after firing destroy before tearing down the entity.
- `reloadPlugin(pluginId: string, newCode: string)` — Hot-reload a plugin in place: keeps the UserModelEntity, uploads new code, swaps the glbUrl, re-imports the module and re-runs initialize().
  - _gotcha:_ Persists the updated data (new URL, same entity id) back to the server. Returns {success:false,error} on caught failures.
- `xr = _createXRNamespace(pc.app)` — XR / Passthrough namespace object exposing the platform's XR helpers (created by the _createXRNamespace factory).
  - _gotcha:_ This is a nested namespace object, not a function — its members live behind the _createXRNamespace factory.
- `VERSION: '1.12.0'` — API version string for plugin compatibility checking.

## Persistence

- `saveUserFile(fileName: string, data: string|ArrayBuffer|Blob, mimeType = 'application/json')` — Save a file to the current user's storage; the name is prefixed with 'plugins/'. Returns the uploaded file URL, or false on failure.
  - _gotcha:_ Returns false (logs error) if the user isn't logged in / uploadUserFile unavailable. The mimeType parameter is accepted but not forwarded to uploadUserFile in this wrapper.
- `loadUserFile(fileName: string, userId?: string)` — Load a 'plugins/<fileName>' file from the current user's storage (or another user's by id). Returns a fetch Response, or false on failure.
- `deletePluginFile(fileName: string)` — Delete a 'plugins/<fileName>' file from the current user's storage.
- `getPluginFileURL(fileName: string, userId?: string)` — Get the public URL for a 'plugins/<fileName>' user file (defaults to the current user). Synchronous; returns string|false.
- `getVibeLogs()` — Get a copy of the global plugin/vibe log buffer (for remix-agent diagnostics); a slice/copy capped at 200 entries.
- `clearVibeLogs()` — Empty the global plugin/vibe log buffer.
- `async push(key, value, options = {})  // options: {numval?, mode?='unique'|'min'|'max'|'append', spaceId?}` — ArrivalSpace.pluginStore.push: Push a value to the plugin store. POSTs {spaceId, key, value:String(value), numval, mode} to /pluginstore/push/{userID}/{logonCertificate}.
  - _gotcha:_ Returns false (logs to console.error) if not logged in (needs userProfileData.userServerURL+userID+logonCertificate) or no space loaded (pc.app.loadSceneParameter.room). Scoped per space (spaceId) + per user (userID in URL path) + per key. value is coerced via String(value); numval defaults to null. mode controls write semantics; server-side enforces the mode.
- `async get(key, options = {})  // options: {sort?='asc'|'desc', limit?=10, spaceId?}` — ArrivalSpace.pluginStore.get: Get entries from the plugin store via GET /pluginstore/get/{userID}/{logonCertificate}?spaceId&key&sort&limit[&prefix=1].
  - _gotcha:_ limit defaults to 10, sort defaults to 'asc'. Undocumented options.prefix — if truthy, sets query param prefix=1 (prefix match on key). Returns false (not []) on not-logged-in / no-space / error.
- `async delete(key, options = {})  // options: {spaceId?}` — ArrivalSpace.pluginStore.delete: Delete OWN entry for a key. POSTs {spaceId, key} to /pluginstore/delete/{userID}/{logonCertificate}.
  - _gotcha:_ Deletes only the calling user's own entry for the key, not other users' rows. Returns false if not logged in / no space loaded / request error.
- `async set(namespace, key, value)` — ArrivalSpace.userData.set: Store a per-user value. POSTs {namespace, key, value} to /pluginstore/user/set/{userID}/{logonCertificate}; value auto-JSON.stringify'd unless already a string.
  - _gotcha:_ Per-user cross-space storage backed by the SAME vibeKeyValueStore table as pluginStore. The namespace is stored in the space_id column and acts as an ACCESS KEY — only plugins that know the namespace can read/write; typical namespace = the plugin author's own space ID. Returns false if not logged in.
- `async get(namespace, key, options = {})  // options: {userId?, raw?=false}` — ArrivalSpace.userData.get: Read a per-user value (or another user's, via options.userId) from /pluginstore/user/get/...; auto-JSON.parse unless raw.
  - _gotcha:_ Three-state return: parsed value / null (not found) / false (error or not logged in) — distinguish carefully. With options.raw the raw string is returned; otherwise JSON.parse is attempted and falls back to the raw string on parse failure. options.userId lets you read ANOTHER user's data as long as you know the namespace (the namespace is the only access control).
- `async delete(namespace, key)` — ArrivalSpace.userData.delete: Delete a key for the current user. POSTs {namespace, key} to /pluginstore/user/delete/{userID}/{logonCertificate}.
  - _gotcha:_ Returns false if not logged in or on request error.
- `async keys(namespace, options = {})  // options: {prefix?, userId?, limit?=100}` — ArrivalSpace.userData.keys: List keys for the current user (or another user via options.userId) from /pluginstore/user/keys/...
  - _gotcha:_ limit documented default is 100 but it is only sent when truthy; when omitted the server applies its own default. prefix and userId are only appended when truthy.

## Multiplayer

- `get isConnected()` — ArrivalSpace.net.isConnected: true when multiplayer is connected (app.networkManager?.initialized).
  - _gotcha:_ Property getter, not a method — read as ArrivalSpace.net.isConnected (no parens).
- `send(type, data = {})` — ArrivalSpace.net.send: Broadcast a message of `type` to all peers via networkManager.broadcastMessage.
  - _gotcha:_ Silently no-ops with a console.warn if not connected. Auto-enriches the payload with senderId (userProfileData.userID), senderName (userProfileData.userName) and senderNetworkId (networkManager.mySocketID) — those keys are reserved/overwritten on every send.
- `sendTo(targetUserId, type, data = {})` — ArrivalSpace.net.sendTo: Direct-message a single player (resolved by userId) via networkManager.sendDirectMessage.
  - _gotcha:_ No-ops + console.warn if not connected, OR if the target user can't be resolved to a socket (player not found). Resolution is by userId via _findSocketIdByUserId (matches user_id / userID / id). Same senderId/senderName/senderNetworkId auto-enrichment as send().
- `on(type, callback) — callback receives (data, sender)` — ArrivalSpace.net.on: Subscribe to messages of `type`. Returns an unsubscribe function. The callback gets (data, sender) where sender is derived from the enriched payload.
  - _gotcha:_ The underlying networkManager.onBroadcastMessageCB handler for a type is wired lazily, only the FIRST time on(type) is called AND only if app.networkManager exists at that moment. If you call on() before multiplayer connects, the network-level subscription is never established for that type — subscribe after connect (or in onConnect).
- `once(type, callback) — callback receives (data, sender)` — ArrivalSpace.net.once: Subscribe to the next single message of `type`, then auto-unsubscribe. Implemented on top of on().
  - _gotcha:_ Inherits the same lazy-wiring caveat as on() (the network handler must be established while app.networkManager exists).
- `off(type, callback)` — ArrivalSpace.net.off: Unsubscribe a handler for `type`; if callback is omitted, clears ALL handlers for that type.
  - _gotcha:_ Calling off(type) with no callback clears the entire callback set for that type. Removing handlers only mutates the local callbacks set; it does not tear down the underlying networkManager subscription.
- `getPlayers()` — ArrivalSpace.net.getPlayers: Snapshot of currently-connected OTHER players ({userID, userName, avatar, isOwner, entity, socketId}).
  - _gotcha:_ Excludes self (skips id === networkManager.mySocketID). userID falls back across playerData.userID || user_id || id; userName falls back across entity.userInfo.name || userName || name || 'Unknown'. Returns [] (never throws) when not connected.
- `onPlayerJoin(callback) — callback receives (playerInfo)` — ArrivalSpace.net.onPlayerJoin: Register a callback fired when another player connects. Returns an unsubscribe function.
  - _gotcha:_ Fires only AFTER the joining entity's userInfo.name is populated — it polls up to 20 times at 100ms intervals before invoking, so the callback can lag the raw socket connect by up to ~2s and may fire with partial info if userInfo never arrives.
- `onPlayerLeave(callback) — callback receives (playerInfo)` — ArrivalSpace.net.onPlayerLeave: Register a callback fired when another player disconnects. Returns an unsubscribe function.
  - _gotcha:_ playerInfo is resolved via _getPlayerInfoFromId after the player is already gone from the session.
- `onConnect(callback)` — ArrivalSpace.net.onConnect: Register a callback fired on the 'multiplayer:connected' app event. Returns an unsubscribe function.
  - _gotcha:_ Only fires for connect events that occur AFTER registration — if multiplayer is already connected when you register, this callback will not back-fire; check net.isConnected for current state.
- `onDisconnect(callback)` — ArrivalSpace.net.onDisconnect: Register a callback fired on the 'multiplayer:disconnected' app event. Returns an unsubscribe function.
- `getNetworkId()` — ArrivalSpace.net.getNetworkId: Returns the local socket id (networkManager.mySocketID) or null if not connected.
- `attribute(defaultValue, options = {})  // options: {title?, min?, max?, step?, ui?=true (auto-false if property starts with _), group?, sync?=false, authority?='any'|'owner'|'self', throttle?=100, onChange?}` — Defines a plugin script attribute with optional editor-UI metadata and network sync. Returns a marker-tagged wrapper {[ATTRIBUTE_MARKER], defaultValue, options} resolved during plugin init (processAttributes); when sync:true the property is replaced by a get/set pair that validates authority, deep-equal-skips no-ops, runs onChange, and throttle-broadcasts changes.
  - _gotcha:_ Per-property network channel is keyed on entity id AND property name (`ArrivalAttr:${entityId}:${propName}`) — sync REQUIRES a stable entityId and two entities sharing an id would cross-talk. Authority is enforced ONLY on the writer's setter via _canModifyProperty: 'any'/'self' always allowed locally; 'owner' rejects the local set with a console.warn unless the local user is the room owner. Receivers do NOT re-validate authority beyond 'self' routing — authority is a writer-side guard, not a verified contract. Setter no-ops when _deepEqual(old,new). onChange is invoked as onChange(newValue, oldValue, isRemote) — isRemote=false for local sets, true for incoming/late-join applies. Broadcasts are throttled by `throttle` ms with a trailing-edge setTimeout flush. authority:'self' is per-player: incoming messages whose forPlayerId != my userID are stored in _arrivalPerPlayerState instead of overwriting the local value. Late-join: on init the joiner broadcasts on `ArrivalLateSyncReq:${entityId}`, a host (room owner, or lowest-sorted userID when the owner is absent) answers on `ArrivalLateSync:${entityId}`; the request retries every 500ms up to 30 attempts (~15s) only once connected with other players present — if no host responds the late joiner keeps its saved/default value. A saved editor value is applied only if the user explicitly set it (propName in savedParams), otherwise the code default is used.
