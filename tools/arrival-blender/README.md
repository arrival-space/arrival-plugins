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

| Entity content      | In Blender                           | What syncs                          |
| ------------------- | ------------------------------------ | ----------------------------------- |
| `.glb` model        | The imported model                   | Transform, and the model itself     |
| Gaussian splat      | The splat, via Splatlight LITE       | Transform, and deleted points       |
| Image               | Textured plane                       | Transform                           |
| Plugin, video, etc. | Empty placeholder                    | Transform                           |
| Old centre asset    | The model, locked                    | Nothing (read-only)                 |

- **Moving an entity**: move the object that carries the entity (a single-mesh model is that mesh;
  a multi-part model has an Empty parent, use *Select Entity* from a part). Scale must stay uniform.
- **Editing a model**: edit mesh, modifiers, materials or the parts' transforms. The add-on flags it
  as *Model edited*; on Push it exports the model as GLB (modifiers applied), uploads it with
  `arrival upload` and points the entity at the new file. Models that were auto-compressed on
  upload (`.opt.glb`) are loaded from their original file.
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
- **Reload** (the refresh button) pulls again and rebuilds the space's objects.

### The skybox

A space's skybox becomes the scene's world, so Blender matches what the app shows: the
equirectangular image with its rotation and intensity, HDR `.hdr` files, and PNGs in the packed
encodings the app uses (`rgbm`, `rgbe`, `rgbp`) decoded to their real brightness. A skybox set to
hidden still lights the scene but isn't drawn, as in the app. Opening a space with a skybox
switches the viewport to Material Preview with **Scene World** on, since that mode otherwise lights
the scene with Blender's own studio HDRI and the skybox would be invisible. The world is named
after the space and is replaced on Reload; the skybox is read-only, like the hub.

### The hub

Spaces that show the default hub (`hideArchitecture` off) also get a **Hub** collection: the
stage, ceiling, back wall, navigation portals and the seven gate segments. The hub isn't space
data, it ships with the app, so the add-on reads it from the published app at
`https://arrival.space/` (the PlayCanvas scene and its models) and applies the space's settings:

- `wallColor`, `floorColor`, `glassColor`, `ceilingColor`
- `hideNavigationPortals`, `hideBackPortal`, `hideFeaturedPortal`, `hideHomePortal`, `enableEntities`
- each static gate's content: a gate with a link gets its ramp and opening, an empty gate its cap

The hub is reference geometry: it can't be selected (toggle that in the Outliner) and is never
pushed. To restyle it, change those settings in the space.

## Limits

- No deleting entities from Blender yet: a deleted object comes back on Reload. Copies of images,
  plugins, splats and placeholders block the push (copies of models become new entities).
- Last writer wins: a push overwrites changes other people made to the same entities since your
  pull. Reload before big edits.
- Pushes go through the CLI's server-side pipeline, so they take a few seconds, and the CLI is
  rate limited to 30 requests per minute.
- A pushed splat is an uncompressed `.ply` (the `.sog` compression only runs for in-app uploads),
  keeps view-dependent color up to SH degree 1 (Splatlight LITE's limit), and keeps its old
  collision mesh. `.lcc` splats without an original file show as placeholders.
- The hub shows colors, not the carbon textures or custom `floorTexture` / `wallTexture`.
- A skybox set to `dome` or `box` is shown the way an `infinite` one is: Blender's world has no
  finite sky, so `skyboxScale` / `skyboxTripodY` and the skybox shadow plane are ignored.
