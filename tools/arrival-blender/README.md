# Arrival.Space for Blender

Edit your Arrival.Space spaces in Blender: sign in, pick a space, move things around or edit
models (modifiers included), and push the result back. Every push refreshes browsers that have
the space open.

All server traffic goes through the [`arrival` CLI](../arrival-cli), so the add-on needs it
installed.

## Install

1. Install the CLI dependencies (Node 18+):

   ```bash
   cd tools/arrival-cli && npm install
   ```

2. Install the add-on (Blender 4.2+). For development, link the folder into your extensions:

   ```bash
   mkdir -p ~/Library/Application\ Support/Blender/5.2/extensions/user_default
   ln -s "$PWD/tools/arrival-blender" ~/Library/Application\ Support/Blender/5.2/extensions/user_default/arrival_space
   ```

   Then enable **Arrival.Space** in *Preferences > Add-ons*. To get a zip for *Install from Disk*
   instead: `blender --command extension build --source-dir tools/arrival-blender`.

3. In the add-on preferences, set **Arrival CLI** to the `tools/arrival-cli` folder (not needed if
   `arrival` is on your PATH via `npm link`). **Server** only matters for sign-in, e.g.
   `https://api-dev.arrival.space`.

## Use

Open the **Arrival** tab in the 3D viewport sidebar (`N`).

1. **Sign In** opens your browser. The sign-in is shared with the CLI (`~/.arrival/config.json`).
2. Click the space image to open the grid of all your spaces (the search field filters it, hover a
   tile for details), click one, then **Load**. It is pulled into `~/ArrivalSpaces/<spaceId>` (a normal CLI
   workspace) and loaded into an `Arrival: <title>` collection. A scene holds one space: loading
   another removes the previous one (its objects, hub and skybox world). Anything you added to its
   collection moves to the scene's collection.
3. Edit, then **Push**. Turn on **Live** to push moves, renames and folder changes automatically.

### Sessions

Each space has its own `.blend`, saved in its workspace (`~/ArrivalSpaces/<spaceId>/<spaceId>.blend`):

- **Load** opens the space's file. The first time, it starts an empty file (your startup file's
  layout, none of its objects), builds the space in it and saves it there. If the file open now has unsaved changes, Load asks first.
- Opening a space's file (by Load or *File > Open*) picks up where you left it: modifiers, your own
  objects, unpushed edits. The add-on then checks the live space in the background, and *Open Space*
  says when it changed; **Reload** brings the changes in (the globe button checks again).
- A full **Push** and **Reload** save the file, so it matches the live space. Live pushes don't.
- A file saved before a later push or Reload (a Live push you didn't save, say) is caught up when
  it opens: moved entities take their pushed placement and entities deleted since are removed, so an
  old file never pushes its older state back. What it can't catch up on (a model replaced since, an
  entity it never had) is listed in *Open Space* and left out of pushes until a Reload.
- Splats are stored in the file as meshes, so spaces with big splats make big files.

| Entity content      | In Blender                           | What syncs                          |
| ------------------- | ------------------------------------ | ----------------------------------- |
| `.glb` model        | The imported model                   | Transform, and the model itself     |
| Gaussian splat      | The splat, via Splatlight LITE       | Transform, and deleted points       |
| Image               | Textured plane                       | Transform; edited, it becomes a model |
| Spawn point         | Spawn marker (see below)             | Position and facing                 |
| Plugin, video, etc. | Empty placeholder                    | Transform                           |
| Old centre asset    | The model, locked                    | Nothing (read-only)                 |

- **Moving an entity**: move the object that carries the entity (a single-mesh model is that mesh;
  a multi-part model has an Empty parent, use *Select Entity* from a part). Scaling a model or
  image unevenly works too: Push bakes the stretch into the uploaded model and gives the entity an
  even scale. Other entities (splats, plugins, placeholders) need an even scale.
- **Editing a model**: edit mesh, modifiers, materials or the parts' transforms. The add-on flags it
  as *Model edited*; on Push it exports the model as GLB with its modifiers applied, using their
  render settings like a final render would (no need to apply them yourself), uploads it with
  `arrival upload` and points the entity at the new file. Models that were auto-compressed on
  upload (`.opt.glb`) are loaded from their original file.
- **Modifiers that use other objects** (a Boolean cutter, a Mirror or Array offset object, a
  Shrinkwrap target, ...) work too, whether that object is part of the entity or not. Boolean
  cutters and parts hidden from renders (*Disable in Renders*) shape the model but aren't exported.
- **Editing an image**: an image entity is a plane with the app's image material (unlit, alpha
  cut at 0.1, lit with *imageLighting*). Moving, turning or evenly scaling it keeps it an image.
  Editing its mesh or material, adding parts, or stretching it turns it into a model: Push exports
  the plane as a GLB (the image embedded, the material as unlit `KHR_materials_unlit`) and points
  the entity at it. From then on it's a model entity.
- **Editing a splat**: splats need the free Splatlight LITE add-on (without it they're placeholder
  cubes). Delete points in Edit Mode; on Push the splat is exported with Splatlight as `.ply`,
  uploaded, and the entity points at it. Splats load from the compressed `.sog` the server keeps
  next to an upload, and LOD splats from their original file.
- **Names and folders** match the in-app Content panel: objects are named like its list (a set name,
  else the file or script name), and its folders are nested collections, hidden ones hidden.
  Renaming an object saves its name like the panel's Rename does, and moving it to another folder
  collection (or to the space's own collection) moves it there in the app. Folders themselves
  (new, renamed, deleted) are only read, not pushed. Entities are matched by id, never by name.
- **Models Blender refuses**: a few older models use the deprecated glTF spec/gloss materials, which
  crash Blender's own importer. Those are converted to standard materials before loading.
- **Old centre assets**: a space whose main content predates entities (a `CenterAsset` row) shows
  it placed as the app places it, from the room's settings. It's locked and never pushed, because
  its position lives in those settings. Editing the space in the app converts it to a normal entity.
- **New entities**: model anything in Blender, select it and click **New Entity from Selection**
  (in *Open Space*). A lone mesh becomes the entity itself; several objects get an Empty parent at
  their centre. With nothing selected, **New Entity** makes an empty one at the 3D cursor. In the
  *Entity* panel, **Add** puts a primitive on the entity and **Add Selected** puts the other
  selected objects into it. On Push the entity is exported as one GLB (modifiers applied),
  uploaded, and created in the space as a model. Duplicating a model entity (Shift+D) works too:
  the copy is pushed as a new entity.
- **Spawn points** (`SpawnPoint` entities, where visitors appear) show as the app's yellow
  markers, pointing the way visitors will face: a spawn recorded from the avatar is a
  ring and an arrow on the floor with an avatar-sized wire figure for scale; one recorded from the
  free camera is a camera pyramid at eye height. Spawn points that hold a default role (avatar or
  free camera, shown in the *Entity* panel) are bright, the others dimmed. Moving and turning one
  syncs its position, yaw and pitch, as the app's gizmo saves them: roll and scale are locked, since
  the entity can't store them. The default roles are read, not edited.
- **Deleting**: delete an entity's object (for a multi-part model, its Empty; deleting parts is a
  model edit) and Push deletes it from the space. *Open Space* lists what the next Push deletes,
  and Push asks first, warning when a spawn point holds a default role. Live never deletes. As in
  the app, deleting a portal hides it (`hideBackPortal` / `hideHomePortal` / `hideFeaturedPortal`)
  instead, and the old centre asset can't be deleted from Blender. Undo (Ctrl+Z) brings a deleted
  object back: before the Push that keeps the entity, after it the next Push re-creates it as it
  was. The app also keeps a snapshot of the space before every push. Nothing is deleted while the
  space's collection isn't in the scene.
- **Reload** (the refresh button) pulls again and rebuilds the space's objects, except edited
  models and splats whose live file is still the one you have (see below).
- **Reload keeps your model**: each model and splat remembers the file it matches, the one it was
  loaded from or the one your last Push uploaded. While the entity still points at that file (also
  after the server compresses it to `.opt.glb`), Reload keeps the Blender object as it is,
  modifiers and unpushed edits included, and only takes the live position, name, folder and
  visibility. So after pushing a model with unapplied modifiers you can keep working on it; it isn't
  replaced by the flattened GLB. If someone replaced the file in the app, Reload loads the new one.
  **Revert to Live Model** in the *Entity* panel throws the Blender version away and loads the live
  file.

### Export settings

The **Export Settings** panel controls how Push writes a model before uploading it. It's saved
with the scene and applies to every model Push uploads: edited, new or stretched ones. Unedited
models aren't re-uploaded, so a change applies once a model is next pushed. **Presets** set
everything at once: *Original* (full-size textures, uncompressed meshes), *Balanced* (textures up
to 2048 px as WebP, Draco meshes), *Small* (1024 px WebP, strong Draco).

- **Textures**: a maximum size (larger ones are scaled down for the upload only; your images in
  Blender keep their size), the format (Automatic, JPEG, WebP, or none), and the JPEG/WebP quality.
  JPEG keeps textures with transparency as PNG.
- **Meshes**: Draco compression, with its level and the bits kept per attribute (fewer is smaller
  and less exact). The app decodes Draco. Meshopt compression isn't offered: the app can't load it.
- **Include**: materials, vertex colors, normals, tangents, UVs, animation, shape keys, skinning
  and custom attributes, to leave out what a model doesn't need.

The *Entity* panel shows the size of a model's last export. Models uploaded in the app are
compressed by the server (Draco + WebP); models pushed from Blender are uploaded as exported, so
these settings are where they get optimized.

### The skybox

A space's skybox becomes the scene's world, so Blender matches what the app shows, following the
client's own rules:

- `skyboxImage`: the equirectangular image, `.hdr` files, and PNGs in the packed encodings the
  app uses (`skyboxEncoding` `rgbm`, `rgbe`, `rgbp`) decoded to their real brightness.
- No `skyboxImage`: the app's default sky, read from the published app like the hub. The app
  draws it from a prefiltered atlas at the scene's blur level, so it's blurred here too.
- `skyboxRotation`: 0 or unset is 180°, as in the app.
- Brightness is `envLightFinal`, else 3. The app sets it after the skybox, so `skyboxIntensity`
  on its own doesn't count (the editor saves both together).
- `skyboxHidden`: not drawn but still lights the scene, also for the default sky.
- `skyboxType` `dome` / `box`: a **Sky** mesh of `skyboxScale` (default 100) with the image
  projected from the tripod at `skyboxTripodY` (default 0.1) times the scale, like the app's sky
  mesh. It's only drawn: the world still lights the scene.

Opening a space switches the viewport to Material Preview with **Scene World** on, since that mode
otherwise lights the scene with Blender's own studio HDRI and the sky would be invisible. The world
is named after the space and is replaced on Reload; the skybox is read-only, like the hub.

### The hub

Spaces that show the default hub (`hideArchitecture` off) also get a **Hub** collection: the
stage, ceiling, back wall, navigation portals and the seven gate segments. The hub isn't space
data, it ships with the app, so the add-on reads it from the published app at
`https://arrival.space/` (the PlayCanvas scene and its models) and applies the space's settings:

- `wallColor`, `floorColor`, `glassColor`, `ceilingColor`
- `hideNavigationPortals`, `hideBackPortal`, `hideFeaturedPortal`, `hideHomePortal`, `enableEntities`
- each static gate's content: a gate with a link gets its ramp and opening, an empty gate its cap

The hub is reference geometry: it can't be moved and is never pushed. To restyle it, change those
settings in the space. It isn't selectable, so clicks reach the entities. Its parts can be targets
of your models' modifiers (a Shrinkwrap onto the floor, a Boolean against a wall): pick one in the
modifier's object field, whose list always includes them. Reload keeps each part's object, so
those targets survive; a part the space's settings turn off is removed, and its targets are
cleared. Hub parts can't be made part of an entity.

## Limits

- Spawn points can't be created from Blender yet; add them in the app.
- Copies of images, plugins, splats and placeholders block the push (copies of models become new
  entities).
- Deleting a plugin from Blender leaves its vibe-install record on the server (the app removes it;
  the CLI's push doesn't yet).
- Last writer wins: a push overwrites changes other people made to the same entities since your
  pull. Reload before big edits.
- Pushes go through the CLI's server-side pipeline, so they take a few seconds, and the CLI is
  rate limited to 30 requests per minute.
- A pushed splat is an uncompressed `.ply` (the `.sog` compression only runs for in-app uploads),
  keeps view-dependent color up to SH degree 1 (Splatlight LITE's limit), and keeps its old
  collision mesh. `.lcc` splats without an original file show as placeholders.
- An image turned into a model loses `imageBrightness` (a GLB's unlit material has no
  brightness).
- The hub shows colors, not the carbon textures or custom `floorTexture` / `wallTexture`.
- `skyboxShadow` (a plane catching the stage light's shadow) isn't shown: the stage light isn't
  brought into Blender.
- Blender's color management isn't the app's tone mapping, so a bright sky can look different.
  The app's scene uses ACES; choose a similar *View Transform* to compare.
