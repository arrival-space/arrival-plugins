# API Reference

## ArrivalScript

Base class for all plugins. Extend this to create your plugin.

```javascript
export class MyPlugin extends ArrivalScript {
    static scriptName = "myPlugin";
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `this.entity` | `pc.Entity` | The entity this plugin is attached to |
| `this.app` | `pc.Application` | The PlayCanvas application |
| `this.space` | `object` | Current room/space |
| `this.isOwner` | `boolean` | Whether current user owns the current space |
| `this.position` | `pc.Vec3` | World position (get/set) |
| `this.localPosition` | `pc.Vec3` | Local position (get/set) |
| `this.rotation` | `pc.Vec3` | Euler rotation in degrees (get/set) |

### Scene Methods

#### `find(name)`

Find an entity by name in the scene.

#### `findByTag(tag)`

Find all entities with a specific tag.

#### `findChild(name)`

Find a child entity by name.

### UI Methods

#### `getUIContainer()`

Get (or create) this script's 2D UI container.

#### `createUI(tagName, options?)`

Create a 2D HTML element in your script UI container.

#### `createPanel(options?)`

Create a styled fixed-position 2D panel (top-left, top-right, bottom-left, bottom-right, center).

#### `removeUI()`

Remove all 2D UI created by this script.

#### `setUIVisible(visible)`

Show/hide this script's 2D UI container.

#### `lockInput()` / `unlockInput()`

Temporarily lock/unlock game pointer input while interacting with UI.

#### `lockKeyboard()` / `unlockKeyboard()`

Temporarily lock/unlock movement keys while typing in UI fields.

### Lifecycle Methods

```javascript
export class MyPlugin extends ArrivalScript {
    static scriptName = "myPlugin";

    initialize() {
        // Called once when plugin starts
    }

    update(dt) {
        // Called every frame
    }

    postUpdate(dt) {
        // Called after all update() methods
    }

    onPropertyChanged(name, value, oldValue) {
        // Called when an editor property changes
    }

    destroy() {
        // Called when plugin is removed/destroyed
    }
}
```

---

## ArrivalSpace

Global utilities available anywhere. No import required.

### Version

#### `ArrivalSpace.VERSION`

Current plugin API version string.

---

### Model Loading

#### `ArrivalSpace.loadGLB(url, options?)`

Load a GLB/GLTF 3D model.

**Returns:** `Promise<{ entity: pc.Entity, asset: pc.Asset }>`

#### `ArrivalSpace.loadTexture(url, options?)`

Load a texture/image.

**Returns:** `Promise<{ texture: pc.Texture, asset: pc.Asset }>`

---

### Audio

#### `ArrivalSpace.playSound(url, options?)`

Play positional or non-positional audio.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entity` | `pc.Entity` | - | Attach sound to an entity |
| `position` | `{x,y,z}` | - | World position if no entity |
| `volume` | `number` | `1` | Volume (0-1) |
| `loop` | `boolean` | `false` | Loop playback |
| `pitch` | `number` | `1` | Playback speed |
| `refDistance` | `number` | `1` | 3D falloff start |
| `maxDistance` | `number` | `100` | 3D falloff end |
| `rollOffFactor` | `number` | `1` | Falloff intensity |
| `positional` | `boolean` | `true` | Enable 3D positional audio |

**Returns:** `Promise<{ entity: pc.Entity, slot: pc.SoundSlot }>`

---

### Materials

#### `ArrivalSpace.createMaterial(options?)`

Create a `pc.StandardMaterial`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `diffuse` | `pc.Color` or `{r,g,b}` | - | Base color |
| `emissive` | `pc.Color` or `{r,g,b}` | - | Emissive color |
| `emissiveIntensity` | `number` | `1` | Emissive multiplier |
| `diffuseMap` | `pc.Texture` | - | Base color texture |
| `normalMap` | `pc.Texture` | - | Normal map |
| `emissiveMap` | `pc.Texture` | - | Emissive texture |
| `opacity` | `number` | `1` | Transparency amount |
| `transparent` | `boolean` | `false` | Enable transparency |
| `blendType` | `'normal' \| 'additive' \| 'multiply'` | `'normal'` | Blend mode (used when transparent) |
| `useLighting` | `boolean` | `true` | Lit vs unlit |
| `doubleSided` | `boolean` | `false` | Disable backface culling |
| `metalness` | `number` | `0` | Metalness value |
| `gloss` | `number` | `0.5` | Glossiness value |

**Returns:** `pc.StandardMaterial`

---

### UI Panels

#### `ArrivalSpace.createHTMLPanel(options)`

Create a CSS3/iframe-based 3D panel. Best for interactive controls (buttons, forms, input fields).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `{x,y,z}` | required | World position |
| `width` | `number` | `1` | Panel width |
| `height` | `number` | `0.5` | Panel height |
| `html` | `string` | - | Custom HTML content |
| `text` | `string` | `''` | Simple text fallback |
| `rotation` | `{x,y,z}` | `{0,0,0}` | Euler rotation |
| `backgroundColor` | `string` | `#222222` | Panel background |
| `textColor` | `string` | `#ffffff` | Text color |
| `fontSize` | `string` | `24px` | Font size for `text` mode |
| `pixelsPerUnit` | `number` | `300` | UI texture density |
| `billboard` | `boolean` | `false` | Face camera every frame |
| `interactive` | `boolean` | `false` | Enable pointer events |
| `disableOnLook` | `boolean` | `true` | Disable mouse interaction while camera look is active |

**Returns:** `pc.Entity` (with helper `panel.updateContent(newOptions)`)

#### `ArrivalSpace.createTexturePanel(options)`

Create a texture-rendered 3D panel with alpha support. Best for transparent overlays and link interaction.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `{x,y,z}` | required | World position |
| `html` | `string` | required | HTML content to render |
| `width` | `number` | `1` | Panel width |
| `height` | `number` | `0.5` | Panel height |
| `resolution` | `number` | `300` | Pixels per world unit |
| `rotation` | `{x,y,z}` | `{0,0,0}` | Euler rotation |
| `billboard` | `boolean` | `false` | Face camera every frame |
| `transparent` | `boolean` | `false` | Render transparent background |
| `backgroundColor` | `string` | `#222222` | Background when not transparent |
| `onClick` | `(href: string) => void` | - | Anchor click callback |

**Returns:** `Promise<pc.Entity | null>` (entity includes `panel.updateContent(newHtml, options?)`)

---

### Cleanup

#### `ArrivalSpace.disposeEntity(entity, options?)`

Safely destroy an entity and optionally its assets/children.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `destroyAssets` | `boolean` | `false` | Destroy referenced assets too |
| `recursive` | `boolean` | `true` | Include child entities |

---

### Space Access

#### `ArrivalSpace.getStaticGates()`

Get all 7 static gates in the current space.

**Returns:** `Array<{ id, entity, index, gateLogic }>`

#### `ArrivalSpace.getStaticGate(index)`

Get one static gate by index (`0-6`).

**Returns:** `{ id, entity, index, gateLogic } | null`

#### `ArrivalSpace.getCenterAsset()`

Get the current room center asset entity/script.

**Returns:** `{ id, entity, centerAsset } | null`

---

### Scene Utilities

#### `ArrivalSpace.getRoom()`

Get current room info.

**Returns:** `{ roomId, roomName, roomData, owner }`

#### `ArrivalSpace.isOwner()`

Check whether the current user owns the current space.

**Returns:** `boolean`

#### `ArrivalSpace.getEntities(logTable?)`

List entities in the scene.

**Returns:** `Array<{ name, enabled, pos, children }>`

#### `ArrivalSpace.findEntity(name)`

Find an entity by name.

**Returns:** `pc.Entity | null`

#### `ArrivalSpace.findByTag(tag)`

Find entities by tag.

**Returns:** `pc.Entity[]`

#### `ArrivalSpace.inspectEntity(nameOrEntity)`

Inspect one entity.

**Returns:** `{ info, entity } | null`

#### `ArrivalSpace.printTree(name?)`

Print scene hierarchy.

**Returns:** `pc.Entity | null`

#### `ArrivalSpace.moveEntity(nameOrEntity, x, y, z)`

Move an entity.

**Returns:** `boolean`

#### `ArrivalSpace.rotateEntity(nameOrEntity, x, y, z)`

Rotate an entity (Euler degrees).

**Returns:** `boolean`

#### `ArrivalSpace.scaleEntity(nameOrEntity, s)`

Uniformly scale an entity.

**Returns:** `boolean`

#### `ArrivalSpace.getPlayer()`

Get player `CharacterController` entity.

**Returns:** `pc.Entity | null`

#### `ArrivalSpace.getCamera()`

Get camera entity.

**Returns:** `pc.Entity | null`

#### `ArrivalSpace.getUser()`

Get current user profile summary.

**Returns:** `{ userID, userName, uniqueName, avatar }`

#### `ArrivalSpace.captureView(width?, height?)`

Capture current camera view and upload screenshot.

Defaults: `width=1024`, `height=768`

**Returns:** `Promise<{ success: boolean, url?: string, error?: string }>`

---

### Space Loading

#### `ArrivalSpace.loadSpace(urlOrId)`

Load a space by full URL or shorthand (username/path).

```javascript
await ArrivalSpace.loadSpace("johndoe");
await ArrivalSpace.loadSpace("https://live.arrival.space/johndoe/gallery");
```

**Returns:** `Promise<any>`

#### `ArrivalSpace.loadUserSpace(userId)`

Load a user's home space by user ID.

**Returns:** `Promise<any>`

#### `ArrivalSpace.reloadSpace()`

Reload the currently loaded space.

**Returns:** `Promise<any>`

---

### Space Management

#### `ArrivalSpace.createSpace(options?)`

Create a new space and optionally load it.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | `string` | `'Untitled'` | Space title |
| `description` | `string` | `''` | Space description |
| `privacy` | `'Open' \| 'Closed' \| 'Link Only'` | `'Closed'` | Privacy mode |
| `environment` | `'hub' \| 'gallery'` | `'hub'` | Hub uses full architecture, gallery uses minimal setup |
| `loadAfterCreate` | `boolean` | `true` | Auto-load newly created space |

**Returns:** `Promise<{ success: boolean, roomId?: string, roomName?: string, title?: string, error?: string }>`

#### `ArrivalSpace.listSpaces(userId?)`

List spaces for current user or a target user.

**Returns:** `Promise<Array<{ id: string, title: string, privacy: string }>>`

---

### Plugin Management

#### `ArrivalSpace.getPlugins()`

List currently loaded plugins in the room.

**Returns:** `Array<{ id: string, url: string, entity: pc.Entity, name: string }>`

#### `ArrivalSpace.createPlugin(code, options?)`

Upload code, create plugin entity, and load it.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | auto | Plugin name/file stem |
| `position` | `{x,y,z}` | `{0,0,0}` | Spawn position |
| `rotation` | `{x,y,z}` | `{0,0,0}` | Spawn rotation |
| `scale` | `number` | `1` | Uniform scale |
| `persist` | `boolean` | `true` | Save plugin entity to server |

**Returns:** `Promise<{ success: boolean, entity?: pc.Entity, id?: string, url?: string, name?: string, error?: string }>`

#### `ArrivalSpace.removePlugin(pluginId, deleteFromServer?)`

Remove plugin entity from current space and optionally delete from server.

Default: `deleteFromServer=true`

**Returns:** `Promise<boolean>`

#### `ArrivalSpace.reloadPlugin(pluginId, newCode)`

Hot-reload a plugin with new code while preserving the same plugin entity.

**Returns:** `Promise<{ success: boolean, id?: string, url?: string, error?: string }>`

---

### Plugin File Storage

Plugin file helpers use `plugins/<fileName>` under user storage.

#### `ArrivalSpace.saveUserFile(fileName, data, mimeType?)`

Save file content under current user's plugin folder.

Default MIME type: `'application/json'`

**Returns:** `Promise<string | false>` (URL or `false`)

#### `ArrivalSpace.loadUserFile(fileName, userId?)`

Load plugin file from current user or another user.

**Returns:** `Promise<Response | false>`

#### `ArrivalSpace.deletePluginFile(fileName)`

Delete plugin file from current user's plugin folder.

**Returns:** `Promise<boolean>`

#### `ArrivalSpace.getPluginFileURL(fileName, userId?)`

Get public URL for plugin file.

**Returns:** `string | false`

---

### Multiplayer

See `docs/multiplayer.md` for `attribute()` and `ArrivalSpace.net`.

---

### CLI Bridge (Local)

There is no public `ArrivalSpace.debug` API.

For local tooling, Arrival may expose an internal `_cli` bridge when launched with `?cli-port=...`. This is for `arrival-cli` integration and not intended as a stable plugin API surface.

---

## Gotchas And Tips

### createTexturePanel Transform Offset

`createTexturePanel()` and `createHTMLPanel()` internally apply `90 + rotation.x` on the entity X axis. If you later set Euler angles directly, apply the same offset.

```javascript
// Correct
panel.setEulerAngles(90 + rotation.x, rotation.y, rotation.z);
```

### Panel Is The Entity

The value returned by `createTexturePanel()` is the entity itself (not `{ entity }`).

```javascript
const panel = await ArrivalSpace.createTexturePanel(...);
panel.setPosition(x, y, z);
```

### Gate Flipped Detection

Some static gates are flipped (about 180 on X). Detect and compensate when applying gate-relative rotations.

```javascript
const gateRoot = gate.entity.findByName("root");
const rot = gateRoot.getEulerAngles();
const isFlipped = Math.abs(Math.abs(rot.x) - 180) < 1;
```

### onPropertyChanged Optimization

Avoid recreating expensive objects unless required:

```javascript
async onPropertyChanged(name) {
    switch (name) {
        case "offset":
        case "rotationY":
            this._updateTransforms();
            break;
        case "width":
        case "height":
            await this._recreate();
            break;
        default:
            this._updateContent();
            break;
    }
}
```

### Gate Space ID Format

Gate links may be short IDs or full room names:

```javascript
return link.startsWith("custom.travel.center.")
    ? link
    : `custom.travel.center.${link}`;
```

### Creator ID From Space ID

Space IDs are:

`custom.travel.center.{creatorID}` or `custom.travel.center.{creatorID}_{num}`

### Async initialize Pattern

Call async setup from `initialize()` without awaiting:

```javascript
initialize() {
    this._setup();
}
```

---

## PlayCanvas API

You have full access to the PlayCanvas engine API:

https://developer.playcanvas.com/api/

```javascript
const box = new pc.Entity("Box");
box.addComponent("render", { type: "box" });
this.entity.addChild(box);
```
