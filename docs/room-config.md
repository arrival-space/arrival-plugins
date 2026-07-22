# Room Config — `space/room.json` schema (RoomInfo `data`)

Everything about a space's *appearance and behavior* lives in one place: the
`data` object of `space/room.json` (the `RoomInfo` entity, `type: "Simple"`).
This is what the in-app **Edit Space** panel writes, and what you edit as an
agent. This doc is the full field reference — look here before setting any room
field, and **never invent a key**: if it isn't listed here, it isn't read.

## The file

```json
{
  "id": "RoomInfo",
  "type": "Simple",
  "data": {
    "roomTitle": "My Space",
    "roomPrivacy": "Open",
    "wallColor": "#334455",
    "skyboxIntensity": 3,
    "framePosteffectParams": { "bloomEnabled": true, "bloomIntensity": 0.14 }
  }
}
```

Edit fields under `data`. Do **not** touch `state` (runtime-owned). On save the
change hot-applies to connected viewers without a reload.

## Conventions that will bite you

- **Colors** are hex strings, sometimes with 8-digit alpha (`"#00000033"`).
- **`framePosteffectParams`** is ONE nested object — all post-effect fields
  (tone mapping, bloom, brightness…) go inside it, never as top-level keys.
- **`enrichment`** is ONE nested object (discovery/SEO); the server shallow-merges
  it by top-level key, so preserve fields you don't intend to change.
- **Hide toggles store the inverse of their UI label.** The panel shows
  "Show Hub"; the key is `hideArchitecture` (`true` = hidden). All `hide*` keys
  work this way.
- **`gateTextColor` and `gateTitleColor` are set together** by one control — keep
  them equal unless you deliberately want them to differ.
- **`dynamicRefraction` is compared as the STRING `"true"`**, not a boolean.
- **Empty string clears** the geo fields (`geo*`) and most optional URLs.
- Colors like `wallColor`/`floorColor` have no fixed default — unset means the
  space **theme** value is used.

---

## 1. Identity & access  *(panel: General)*

| key | type | default | values | effect |
|---|---|---|---|---|
| `roomTitle` | string | `"Untitled"` | ≤50 chars; empty→`"Untitled"` | Space name (header, gate title, `document.title`, SEO) |
| `roomDescription` | string | `""` | ≤2048 chars; HTML rendered if it contains `<…>` | Description board / meta text |
| `roomPrivacy` | enum | `"Open"` | `Open` \| `Closed` \| `Link Only` | Visibility. `Closed`=owner only; `Link Only`=unlisted (Pro) |
| `roomPassword` | string | `""` | free text | Entry code; only meaningful with `Link Only`. Cleared if privacy leaves Link Only |
| `allowRemix` | bool | `false` | | Others may remix/duplicate the space |
| `allowVisitorPropertyView` | bool | `false` | | Registered visitors get a read-only properties panel *(valid key; no UI control in the current build)* |

---

## 2. Hub / architecture visibility  *(panel: Content › Hub, and Pro)*

| key | type | default | effect |
|---|---|---|---|
| `hideArchitecture` | bool | `false` | Hide the default hub (gates, stage, walls, ceiling, logo). Also disables wall collision. When hidden, the styling colors/textures below have nothing to act on |
| `hideRoomTitle` | bool | `false` | Hide the 3D room-title text |
| `hideBackPortal` | bool | `false` | Hide the back navigation portal |
| `hideFeaturedPortal` | bool | `false` | Hide the featured portal |
| `hideHomePortal` | bool | `false` | Hide the home portal |
| `hideNavigationPortals` | bool | `false` | Hide the whole NavigationPortals group |
| `showGrid` | bool | `false` | Show the reference floor grid (auto-forced ON when the scene has no real entities) |
| `hideUI` | bool | `false` | Hide the entire client UI overlay for visitors *(Enterprise; reload-required)* |

---

## 3. Colors, textures & branding  *(panel: Content › Hub)*

Colors are hex; textures/logos are image URLs (in a space workspace, an
`assets/<name>` token or a CDN URL).

| key | type | default | effect |
|---|---|---|---|
| `wallColor` | hex-color | theme | Hub wall tint |
| `wallTexture` | url | — | Hub wall texture map |
| `floorColor` | hex-color | theme | Stage/floor tint (also used by the copyright notice) |
| `floorTexture` | url | — | Stage/floor texture map |
| `glassColor` | hex-color | theme | Glass floors/ramps tint |
| `glassTexture` | url | — | Glass floors/ramps texture |
| `ceilingColor` | hex-color | theme | Ceiling tint |
| `ceilingTexture` | url | — | Ceiling texture |
| `roomTitleColor` | hex-color | `#4d4d4d` | 3D room-title text color |
| `gateTextColor` | hex-color | `#4d4d4d` | Wall/gate body-text color |
| `gateTitleColor` | hex-color | `#4d4d4d` | Gate title color — **set to the same value as `gateTextColor`** |
| `logoURL` | url | — | Image on the hub back wall |
| `customFont` | url/string | — | Override font for title + gate text *(advanced; no UI control)* |
| `copyrightNotice` | string | — | Copyright text rendered on the floor *(advanced; no UI control)* |

---

## 4. Skybox  *(panel: Pro › Skybox)*

| key | type | default | values | effect |
|---|---|---|---|---|
| `skyboxImage` | url | — | image / `.hdr` | Skybox environment image; empty = default env map |
| `skyboxType` | enum | `"infinite"` | `dome` \| `box` \| `infinite` | Projection geometry (`dome`/`box` also use `skyboxScale` + `skyboxTripodY`) |
| `skyboxHidden` | bool | `false` | | Hide the sky visually but keep it as a light source (good for black-bg splats) |
| `skyboxShadow` | bool | `false` | | Skybox casts sun/environment shadows |
| `skyboxIntensity` | number | `3` | 0–10 | Skybox / environment-light brightness *(same key appears in Lighting)* |
| `skyboxRotation` | number | `180` | 0–360 | Skybox Y-rotation (deg) |
| `skyboxScale` | number | `100` | ≥0 | Dome/box radius *(set via the HDRI upload dialog)* |
| `skyboxEncoding` | enum | — | `rgbe` \| `rgbm` \| `rgbp` | HDR encoding of the uploaded image *(HDRI dialog)* |
| `skyboxTripodY` | number | `0.1` | | Dome/box vertical-center offset *(HDRI dialog)* |

---

## 5. Lighting & shadows  *(panel: Pro › Lighting & Shadows)*

| key | type | default | values | effect |
|---|---|---|---|---|
| `stageLightType` | enum | `"point"` | `point` \| `directional` | Stage light type. `directional` disables `stageLightRange` and enables the cascade/range/quality controls |
| `stageLightIntensity` | number | `2.2` | 0–15 | Stage-light brightness |
| `stageLightRange` | number | `8` | 0–15 | Point-light range (ignored for `directional`) |
| `stageLightRotation` | number | `0` | 0–360 | Stage-light azimuth (deg) |
| `stageLightColor` | hex-color | per type | | Stage-light color *(advanced; no UI control)* |
| `stageLightElevation` | number | `-45` | | Directional-light elevation angle *(advanced; no UI control)* |
| `lightFadeIn` | number | `0` | 0–15 | Seconds the stage light fades in on load (welcome effect) |
| `lightFadeInFinal` | number | — | | Final point-light range after fade-in *(advanced)* |
| `envLightFinal` | number | `3.0` | | Final env/skybox intensity after fade-in *(advanced)* |
| `stageLightShadowIntensity` | number | `1.0` | 0–1 | Shadow darkness |
| `stageLightDirectionalShadowQuality` | number | `1024` | `512` \| `1024` \| `2048` \| `4096` | Shadow-map resolution *(directional only)* |
| `stageLightDirectionalShadowRange` | number | `10` | 1–100 | Shadow distance *(directional only)* |
| `stageLightDirectionalShadowCascades` | number | `1` | `1`\|`2`\|`3`\|`4` | Cascaded-shadow-map count *(directional only)* |

---

## 6. Post effects  *(panel: Pro › Post Effects — nested under `framePosteffectParams`)*

All of these are **sub-fields of the single `framePosteffectParams` object**, e.g.
`"framePosteffectParams": { "toneMapping": 3, "bloomEnabled": true }`.

| `framePosteffectParams.<field>` | type | default | values | effect |
|---|---|---|---|---|
| `hdrEnabled` | bool | `false` | | HDR pipeline (experimental; forces `gamma`=1 and widens bloom threshold to 0–3; may break transparency) |
| `toneMapping` | number | `3` (ACES) | `pc.TONEMAP_*`: ACES, LINEAR, FILMIC, HEJL, ACES2, NEUTRAL | Tone-mapping operator. **This is the live tone-mapping control** |
| `brightness` | number | `1.0` | 0–2 | Output brightness |
| `contrast` | number | `1.0` | 0.5–1.5 | Output contrast |
| `saturation` | number | `1.0` | 0–2 | Output saturation |
| `sharpness` | number | `1.0` | 0–2 | Output sharpening |
| `gamma` | number | `1.0` | 0.1–3 | Gamma (forced to 1 and disabled when `hdrEnabled`) |
| `bloomEnabled` | bool | `true` | | Enable bloom |
| `bloomIntensity` | number | `0.14` | 0–1 | Bloom strength |
| `bloomThreshold` | number | `0.9` | 0–1 (0–3 if HDR) | Luminance threshold for bloom |
| `bloomBlurLevel` | number | `4` | 1–8 | Bloom blur mip level |
| `bloomDebug` | bool | `false` | | Visualize the bloom buffer only |

> Legacy top-level `toneMapping` (string/number, default ACES) is still read at
> runtime but is **not** the control the panel uses — prefer
> `framePosteffectParams.toneMapping`.

---

## 7. Camera & movement  *(panel: Pro)*

| key | type | default | values | effect |
|---|---|---|---|---|
| `cameraFOV` | number | `60` | 20–120 | Camera field of view (deg) |
| `defaultCamera` | enum | `"third"` | `first` \| `third` \| `free` | Initial camera mode on load |
| `farClip` | number | — | | Camera far-clip distance *(advanced; no UI control)* |
| `moveSpeed` | number | `0.8` | 0.01–3 | Avatar movement speed |
| `jumpHeight` | number | `1.0` | 0.0–1.5 | Avatar jump-height multiplier (max real jump ≈ 1.25 m at 1.0) |

---

## 8. Audio  *(panel: Pro › Audio)*

| key | type | default | values | effect |
|---|---|---|---|---|
| `introSoundURL` | url | `""` | audio file | Ambient / intro sound source |
| `introSoundLoop` | bool | `false` | | Loop the ambient sound |
| `introSoundVolume` | number | `1` | 0–1 | Ambient sound volume |

---

## 9. Avatar overrides  *(advanced; set by AI/import — no current UI control)*

Force a custom avatar for every visitor to the space.

| key | type | effect |
|---|---|---|
| `customAvatar` | url | Custom avatar GLB for all visitors |
| `customAvatarIdle` | url | Idle animation clip |
| `customAvatarWalking` | url | Walk animation clip |
| `customAvatarJumping` | url | Jump animation clip |
| `customAvatarYRotation` | number | Spawn Y-rotation |
| `customAvatarScale` | number | Avatar scale |

---

## 10. Collision  *(advanced; no current UI control)*

| key | type | default | effect |
|---|---|---|---|
| `disableWallCollision` | bool | `false` | Disable hub wall collision |
| `disableFloorCollision` | bool | `false` | Disable floor collision |
| `customCollisionBox` | object | — | Custom collision-box config |

*(Main-asset collision — `noCollision` — is a per-space main-asset flag, see §14.)*

---

## 11. Performance / GPU textures  *(panel: Content › GPU Memory › GPU Textures)*

Reduce VRAM use (not download size) by downscaling textures, separately per
platform.

| key | type | default | range | effect |
|---|---|---|---|---|
| `textureDividerMobile` | number | `1` | 1–8 | Downscale divisor for all textures on mobile (1 = off, 2 = half-res) |
| `textureDividerDesktop` | number | `1` | 1–8 | Same, desktop |
| `maxTextureSizeMobile` | number | `0` | 0–8192 | Hard cap on texture dimension on mobile (0 = unlimited) |
| `maxTextureSizeDesktop` | number | `0` | 0–8192 | Same, desktop |

---

## 12. Rendering backend  *(panel: Pro › Other)*

| key | type | default | effect |
|---|---|---|---|
| `unifiedSplats` | bool | `true` | Merge Gaussian splats into one renderer for correct sort/render *(reload-required)* |
| `useWebGPU` | bool | `false` | Request the WebGPU backend when supported *(applies on next page load)* |
| `dynamicRefraction` | string | — | Enable dynamic refraction — **compared as the string `"true"`**, not a boolean *(advanced)* |

---

## 13. Content organization  *(panel: Content)*

| key | type | shape | effect |
|---|---|---|---|
| `contentFolders` | array | `[{ id, name, parentId?, order?, collapsed?, hidden? }]` | Folder tree that organizes entities in the Content list. A folder's `hidden:true` cascades to hide the entities it contains in-scene |

---

## 14. Main-asset (space GLB/splat) settings  *(advanced; mostly migrated to per-entity — see boundary note)*

These control the space's primary uploaded asset. Most are being migrated to
per-entity `data`, but are still read at the room level for legacy spaces.

| key | type | default | effect |
|---|---|---|---|
| `splatBounds` | object | — | Room-level splat clip bounds `{min_x,min_z,max_x,max_z,…}` *(legacy — new spaces use per-entity `data.splatBounds`)* |
| `splatBrightness` | number | `1.1` | Main-asset splat brightness |
| `splatContrast` | number | `1.0` | Main-asset splat contrast |
| `splatDisableToneMapping` | bool | `false` | Disable tone-mapping on splats |
| `splatShadows` | bool | `false` | Splats cast shadows |
| `noAssetShadows` | bool | `false` | Main asset casts no shadows |
| `noCollision` | bool | `false` | Disable main-asset collision *(reload-required)* |
| `disableAnimationLoop` | bool | `false` | Don't loop main-asset animation *(reload-required)* |
| `animationIndex` | number | `0` | Which embedded animation to play |
| `rotateAssetSpeed` | number | `0` | Auto-rotate the main asset |
| `centerPosition` / `centerRotation` | `{x,y,z}` | — | Main-asset placement *(legacy; stripped on remix)* |
| `absolutePosition` | bool | — | Treat center pos/rot as absolute |

---

## 15. Scene & plugins  *(advanced; set by the AI agent / import)*

| key | type | effect |
|---|---|---|
| `plugins` | array | Loaded plugin list |
| `addPlugin` | url/id | A single plugin to append |
| `sceneObjects` | array | Programmatic scene-object instantiation args |
| `enableEntities` | array | `[name, enabled]` pairs to enable/disable named scene entities |

> Prefer the normal entity workflow (`space/entities/*.json` +
> `space/plugins/*.mjs`) over these room-level hooks — see the main repo docs.

---

## 16. Enterprise & branding  *(panel: Pro › Enterprise — gated, but valid keys)*

| key | type | default | effect |
|---|---|---|---|
| `disableMultiplayer` | bool | `false` | Turn off realtime multiplayer *(reload-required)* |
| `disableBranding` | bool | `false` | Remove the arrival.space logo (leaves a small info icon) |
| `customBrandingIcon` | url | — | Icon replacing branding (bottom-left + loading screen) |

---

## 17. Discovery & SEO  *(editor currently code-disabled, but all keys are valid & read)*

The Discovery panel is compiled out (`SHOW_DISCOVERY_SEO = false`) in the current
build, but these keys are fully wired server-side (JSON-LD, recommendations). Two
storage shapes: a nested `enrichment` object and flat `geo*` keys.

**Any edit to `enrichment` should set `enrichment.manualEdit = true`** so the
automated AI-tagging batch skips the space.

### `enrichment` (nested object)

| `enrichment.<field>` | type | values | effect |
|---|---|---|---|
| `category` | string | `""`(auto) \| art, architecture, gaming, education, retail, music, social, showroom, simulation, nature, other | Discovery category |
| `tags` | string[] | free keywords | Search tags |
| `place` | object | `{ type, name }` | schema.org place |
| `place.type` | string | `""`(auto) \| Place, Museum, ArtGallery, Store, ShoppingCenter, Restaurant, Residence, LodgingBusiness, Park, Beach, Mountain, BodyOfWater, LakeBodyOfWater, RiverBodyOfWater, SeaBodyOfWater, Waterfall, LandmarksOrHistoricalBuildings, PlaceOfWorship, TouristAttraction, EventVenue, StadiumOrArena, PerformingArtsTheater, CivicStructure | JSON-LD place @type |
| `place.name` | string | free | Place display name |
| `manualEdit` | bool | | Locks out the AI-tagging batch (set `true` on any manual edit) |
| `visualDescription` | string | *AI-only* | AI screenshot-derived description — preserve, don't hand-edit |
| `tagsRaw` | string[] | *AI-only* | AI raw tags — preserve |
| `source` | object | *AI-only* | `{ model, promptVersion, enrichedAt, screenshotRef? }` provenance — preserve |

### Flat geo keys (top-level, creator-only)

| key | type | range | effect |
|---|---|---|---|
| `geoLatitude` | number | −90…90 | Real-world latitude → JSON-LD GeoCoordinates; used by map / 3D-tiles plugins. `""` clears |
| `geoLongitude` | number | −180…180 | Longitude. `""` clears |
| `geoAltitude` | number | metres (WGS84 ellipsoid) | Elevation / plugin "ground altitude". `""` clears |
| `geoAddress` | string | ≤300 chars | Human address label. `""` clears |

---

## NOT in room.json — these live on entities or elsewhere

Do not put these in `room.json`; they belong to individual entities or other
records. Setting them on `RoomInfo.data` does nothing.

- **LOD (streaming & generation)** — `LodSettingsEditor` / `LodGenerateSettingsEditor`
  write to the **main-asset / `UserModelEntity` entity's `data`**, not the room.
  Shape (on the entity): `{ presets: { [name]: { range, lodBaseDistance,
  lodMultiplier, splatBudget, cullDistance, lodBehindPenalty, enabled,
  lcc2_quality, lcc2_environment } }, defaultDesktopPreset, defaultMobilePreset,
  enableDebugUI, colorizeLod, … }` (VR presets `quest` / `vision-pro`;
  `lcc2_quality` 0–100, default 80). Generation params `lodLevels`,
  `lodChunkCount`, `lodChunkExtent`, `lodEngine` are entity-level too.
- **Collision generation** — `collisionDensity`, `collisionTriangles`,
  `collisionVoxel`, `collisionRadius`, `collisionMinOpacity`, `collisionMaxScale`
  → entity `data`.
- **Per-entity model settings** — brightness/contrast/tone-map/`videoURL`/
  `animationIndex`/`doubleSided`/`autoPlay`/`loop`/etc. → the entity's own `data`
  (`space/entities/<id>.json`).
- **Spawn points** — a `SpawnPoint` entity's `data`, not `room.json`.
- **Domain / URL** — `domainData.domain` / `domainData.alias` → the DomainInfo
  record.
- **Git binding** — `gitRepoName` / `gitUser` → written by the Versioning panel.
- **Space pin/hide** — `pinned` / `hidden` → set through other endpoints.

---

## Maintenance

This reference is derived from the live edit-panel source and the client
consumers; it can lag when new fields ship. Authoritative sources to re-sync from:

- Master type: `react-ui/src/space-overlay/creator-profile/CreatorProfileTypes.ts`
  (`RoomData` interface).
- Defaults: `react-ui/src/space-overlay/CreatorBadge/CreatorBadgeEditMode/DefaultValues.ts`.
- Panels: `react-ui/src/space-overlay/CreatorBadge/CreatorBadgeEditMode/CreatorBadgeEditModePanels/*`
  and `react-ui/src/arrival.space-components/MoreSettings/*`.
- Consumers (effects/defaults): `scripts/custom-travel-center.js` (`updateRoomFromData`
  and its `update*` methods), `scripts/local-lighting-controller.js`,
  `scripts/ply-asset.js`.
