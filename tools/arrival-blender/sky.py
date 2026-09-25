# The space's skybox as Blender's world.
#
# A space stores an equirectangular skyboxImage plus rotation / intensity / encoding (see
# custom-travel-center.js updateSkybox). The lookup is built from the engine's own formula rather
# than Blender's Environment Texture node, because that node has no alpha output and the packed
# encodings below need it. PlayCanvas samples the sky (skyboxPS, toSphericalUv, with the x flip the
# cubemap lookup applies) at
#   u = 0.5 + atan2(-x, z) / 2pi,  v = 0.5 + asin(y) / pi   (v from the image bottom)
# in its Y-up axes; a Blender direction (X, Y, Z) is (X, Z, -Y) there.
#
# PNGs can carry HDR values in one of PlayCanvas's packed encodings; those are decoded in the
# node tree so the world is as bright as it is in the app.
#
# What the client does with the settings (updateSkybox, updateWelcomeEffects):
#   no skyboxImage   the app scene's own sky: an RGBM env atlas (the "Helipad" cubemap asset) drawn
#                    at its skyboxMip level, i.e. blurred. Read from the published app, like the hub.
#   skyboxRotation   yaw in degrees; 0 or unset is 180 (the scene's default rotation).
#   intensity        envLightFinal, else 3. updateWelcomeEffects runs after updateSkybox and
#                    overwrites skyboxIntensity (the editor saves the two together).
#   skyboxHidden     the sky isn't drawn but still lights the scene, with or without an image.
#   skyboxType       dome / box project the image onto a mesh of skyboxScale (default 100) around
#                    a tripod at skyboxTripodY (default 0.1) times the scale, instead of infinitely
#                    far away. Built here as a mesh with the same lookup from that tripod.
#   skyboxShadow     a shadow catcher for the stage light, which Blender doesn't have: ignored.

import json
import math

import bmesh
import bpy
from mathutils import Matrix

from . import hub, space

DEFAULT_INTENSITY = 3.0  # custom-travel-center.js DEFAULT_SKYBOX_INTENSITY
DEFAULT_ROTATION = 180.0  # updateSkybox: new pc.Quat(0, 1, 0, 0) when skyboxRotation is falsy
ATLAS_SIZE = 512.0  # envAtlasPS atlasSize
ENCODINGS = ("rgbm", "rgbe", "rgbp")

DECODE_LABEL = "Arrival decode"


def world_name(title, space_id):
    return f"Arrival: {title or space_id}"


def find_world(space_id):
    for world in bpy.data.worlds:
        if world.get("arrival_space_id") == space_id:
            return world
    return None


def remove(scene, space_id):
    _remove_sky_mesh(space_id)
    world = find_world(space_id)
    if not world:
        return
    if scene.world == world:
        scene.world = None
    bpy.data.worlds.remove(world)


def fetch_default(task, cache_dir):
    """Task body: the app scene's own sky, {path, encoding, level}, for spaces without a skybox."""
    ctx = space._ssl_context()
    task.progress = "Loading the default sky…"
    cfg = json.loads(hub._get(hub.APP_URL + "config.json", cache_dir, ctx))
    scene_url = next(s["url"] for s in cfg["scenes"] if s["name"] == hub.SCENE_NAME)
    render = json.loads(hub._get(hub.APP_URL + scene_url, cache_dir, ctx)).get("settings", {}).get("render", {})
    asset = cfg["assets"].get(str(render.get("skybox"))) or {}
    url = (asset.get("file") or {}).get("url")
    if not url:
        raise space.EntityError("the app's scene has no default sky")
    url = hub.APP_URL + url
    path = space.download_all(task, [url], cache_dir, label="Loading the default sky")[url]
    if isinstance(path, Exception):
        raise path
    if url.lower().split("?")[0].endswith(".dds"):
        raise space.EntityError("the app's default sky is a .dds file, which isn't supported")
    # The asset's file is its prefiltered env atlas. The engine loads a non-.dds one as RGBP,
    # whatever the asset's rgbm flag says (CubemapHandler.loadAssets), and with no cube faces draws
    # the sky from the atlas at skyboxMip (Scene._getSkyboxTex), 0 being the sharp one.
    return {"path": path, "encoding": "rgbp", "level": int(render.get("skyboxMip") or 0)}


def _equirect_uv(nt, vector):
    """The engine's equirect lookup as nodes: a direction in, image coordinates out."""
    normalize = nt.nodes.new("ShaderNodeVectorMath")
    normalize.operation = "NORMALIZE"
    nt.links.new(vector, normalize.inputs[0])
    split = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(normalize.outputs["Vector"], split.inputs["Vector"])

    def scaled(socket, factor, offset):
        node = nt.nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY_ADD"
        node.inputs[1].default_value = factor
        node.inputs[2].default_value = offset
        nt.links.new(socket, node.inputs[0])
        return node.outputs["Value"]

    # u = 0.5 + atan2(-X, -Y) / 2pi   (PlayCanvas x = X, z = -Y)
    angle = nt.nodes.new("ShaderNodeMath")
    angle.operation = "ARCTAN2"
    nt.links.new(scaled(split.outputs["X"], -1.0, 0.0), angle.inputs[0])
    nt.links.new(scaled(split.outputs["Y"], -1.0, 0.0), angle.inputs[1])
    u = scaled(angle.outputs["Value"], 1.0 / (2.0 * math.pi), 0.5)

    # v = 0.5 + asin(Z) / pi
    elevation = nt.nodes.new("ShaderNodeMath")
    elevation.operation = "ARCSINE"
    nt.links.new(split.outputs["Z"], elevation.inputs[0])
    v = scaled(elevation.outputs["Value"], 1.0 / math.pi, 0.5)

    uv = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u, uv.inputs["X"])
    nt.links.new(v, uv.inputs["Y"])
    return uv.outputs["Vector"]


def _atlas_uv(nt, uv, level):
    """The equirect coordinates mapped into the env atlas's rectangle for a blur level
    (envAtlasPS mapRoughnessUv), in Blender's bottom-up image coordinates."""
    t = 1.0 / 2.0 ** level
    seam = 1.0 / ATLAS_SIZE
    split = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv, split.inputs["Vector"])
    out = nt.nodes.new("ShaderNodeCombineXYZ")
    for axis, size, start in (("X", t, 0.0), ("Y", t * 0.5, t * 0.5)):
        node = nt.nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY_ADD"
        node.inputs[1].default_value = size - 2 * seam
        node.inputs[2].default_value = start + seam
        nt.links.new(split.outputs[axis], node.inputs[0])
        nt.links.new(node.outputs["Value"], out.inputs[axis])
    return out.outputs["Vector"]


def _decode(nt, tex, encoding):
    """PlayCanvas's packed HDR encodings (decodeRGBM / decodeRGBP / decodeRGBE), as nodes."""
    scale = nt.nodes.new("ShaderNodeVectorMath")   # rgb * factor
    scale.operation = "SCALE"
    scale.label = DECODE_LABEL
    nt.links.new(tex.outputs["Color"], scale.inputs[0])

    if encoding == "rgbe":
        # rgb * 2^(a * 255 - 128)
        exp = nt.nodes.new("ShaderNodeMath")
        exp.operation = "MULTIPLY_ADD"
        exp.inputs[1].default_value = 255.0
        exp.inputs[2].default_value = -128.0
        nt.links.new(tex.outputs["Alpha"], exp.inputs[0])
        power = nt.nodes.new("ShaderNodeMath")
        power.operation = "POWER"
        power.inputs[0].default_value = 2.0
        nt.links.new(exp.outputs["Value"], power.inputs[1])
        nt.links.new(power.outputs["Value"], scale.inputs["Scale"])
        return scale.outputs["Vector"]

    if encoding == "rgbm":  # (8a * rgb)^2
        factor = nt.nodes.new("ShaderNodeMath")
        factor.operation = "MULTIPLY"
        factor.inputs[1].default_value = 8.0
        nt.links.new(tex.outputs["Alpha"], factor.inputs[0])
    else:  # rgbp: (rgb * (8 - 7a))^2
        factor = nt.nodes.new("ShaderNodeMath")
        factor.operation = "MULTIPLY_ADD"
        factor.inputs[1].default_value = -7.0
        factor.inputs[2].default_value = 8.0
        nt.links.new(tex.outputs["Alpha"], factor.inputs[0])
    nt.links.new(factor.outputs["Value"], scale.inputs["Scale"])
    square = nt.nodes.new("ShaderNodeVectorMath")
    square.operation = "MULTIPLY"
    nt.links.new(scale.outputs["Vector"], square.inputs[0])
    nt.links.new(scale.outputs["Vector"], square.inputs[1])
    return square.outputs["Vector"]


def _show_world(context):
    """Material Preview lights the scene with a studio HDRI unless it's told to use the scene's
    world, so a freshly applied skybox would otherwise be invisible."""
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            for area_space in area.spaces:
                shading = getattr(area_space, "shading", None)
                if not shading:
                    continue
                if shading.type in ("SOLID", "WIREFRAME"):
                    shading.type = "MATERIAL"
                shading.use_scene_world = True


def _sky_color(nt, vector, image, encoding, level, yaw):
    """The sky's color for a lookup direction, as the engine samples it."""
    mapping = nt.nodes.new("ShaderNodeMapping")
    # Turning the lookup vector by +yaw turns the sky the way the app does (checked against the
    # app's screenshot of a space with a 35 degree rotation).
    mapping.inputs["Rotation"].default_value[2] = math.radians(yaw)
    nt.links.new(vector, mapping.inputs["Vector"])
    uv = _equirect_uv(nt, mapping.outputs["Vector"])
    if level is not None:
        uv = _atlas_uv(nt, uv, level)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.extension = "EXTEND"  # the poles; the seam wraps through the lookup itself
    tex.image = image
    nt.links.new(uv, tex.inputs["Vector"])
    if encoding in ENCODINGS:
        return _decode(nt, tex, encoding)
    return tex.outputs["Color"]


def _load_image(path, encoding):
    image = bpy.data.images.load(path, check_existing=True)
    if encoding in ENCODINGS:
        image.colorspace_settings.name = "Non-Color"  # the packed values are data, not colour
        image.alpha_mode = "CHANNEL_PACKED"  # and the alpha is part of them, not coverage
    return image


def _remove_sky_mesh(space_id):
    for ob in [o for o in bpy.data.objects if o.get("arrival_sky") == space_id]:
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)


def _pc_to_blender(bm):
    bmesh.ops.transform(bm, matrix=space.C, verts=bm.verts)


def _dome(bm):
    """DomeGeometry(latitudeBands 50, longitudeBands 50): a sphere of radius 0.5 whose lower half
    is squashed into a floor at y = 0."""
    bands, r = 50, 0.5
    rows = []
    for lat in range(bands + 1):
        theta = lat * math.pi / bands
        row = []
        for lon in range(bands):
            phi = lon * 2 * math.pi / bands - math.pi / 2
            x, y, z = math.cos(phi) * math.sin(theta), math.cos(theta), math.sin(phi) * math.sin(theta)
            if y < 0:
                y *= 0.3
                if x * x + z * z < 0.95 * 0.95:
                    y = -0.1
            row.append(bm.verts.new((x * r, (y + 0.1) * r, z * r)))
        rows.append(row)
    for lat in range(bands):
        for lon in range(bands):
            nxt = (lon + 1) % bands
            quad = (rows[lat][lon], rows[lat + 1][lon], rows[lat + 1][nxt], rows[lat][nxt])
            if len(set(quad)) == 4:
                bm.faces.new(quad)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)


def _box(bm):
    """BoxGeometry({yOffset: 0.5}): a unit cube standing on y = 0."""
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((0, 0.5, 0)))


def _sky_mesh(context, space_id, title, room, image, encoding, yaw, strength):
    """skyboxType dome / box: the sky drawn on a mesh around the tripod, as SkyMesh does."""
    kind = room.get("skyboxType")
    scale = room.get("skyboxScale")
    scale = float(scale) if isinstance(scale, (int, float)) and not isinstance(scale, bool) else 100.0
    tripod = room.get("skyboxTripodY")
    tripod = float(tripod) if isinstance(tripod, (int, float)) and not isinstance(tripod, bool) else 0.1

    bm = bmesh.new()
    (_dome if kind == "dome" else _box)(bm)
    _pc_to_blender(bm)
    me = bpy.data.meshes.new(f"Sky {kind}")
    bm.to_mesh(me)
    bm.free()

    mat = bpy.data.materials.new(f"Sky {kind}")
    if mat.node_tree is None:  # Blender < 5
        mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(node)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    geometry = nt.nodes.new("ShaderNodeNewGeometry")
    direction = nt.nodes.new("ShaderNodeVectorMath")
    direction.operation = "SUBTRACT"
    direction.inputs[1].default_value = (0.0, 0.0, tripod * scale)  # the tripod, in Blender axes
    nt.links.new(geometry.outputs["Position"], direction.inputs[0])
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = strength
    nt.links.new(_sky_color(nt, direction.outputs["Vector"], image, encoding, None, yaw), emission.inputs["Color"])
    nt.links.new(emission.outputs["Emission"], out.inputs["Surface"])
    me.materials.append(mat)

    ob = bpy.data.objects.new(f"Sky {kind}", me)
    ob["arrival_sky"] = space_id
    ob.scale = (scale, scale, scale)
    ob.hide_select = True
    # Only drawn, like the app's sky mesh: the scene is still lit by the world.
    for ray in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter",
                "visible_shadow"):
        setattr(ob, ray, False)
    space.space_collection(context.scene, space_id, title).objects.link(ob)


def apply(context, space_id, title, room, files, default=None):
    """Set up the scene's world from the space's skybox settings, or the app's default sky
    (fetch_default) when it has none. Returns a warning, or ""."""
    _remove_sky_mesh(space_id)
    url = space._str(room.get("skyboxImage"))
    if url:
        try:
            path = space._local_file("", url, files)
        except space.EntityError as e:
            return f"Skybox: {e}"
        encoding, level = space._str(room.get("skyboxEncoding")).lower(), None
    elif default:
        path, encoding, level = default["path"], default["encoding"], default["level"]
    else:
        remove(context.scene, space_id)
        return ""

    world = find_world(space_id) or bpy.data.worlds.new(world_name(title, space_id))
    world["arrival_space_id"] = space_id
    world.name = world_name(title, space_id)
    context.scene.world = world

    if world.node_tree is None:  # Blender < 5
        world.use_nodes = True
    nt = world.node_tree
    for node in list(nt.nodes):
        if node.type != "OUTPUT_WORLD":
            nt.nodes.remove(node)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")

    yaw = space._f(room, "skyboxRotation") or DEFAULT_ROTATION
    final = room.get("envLightFinal")
    strength = float(final) if isinstance(final, (int, float)) and not isinstance(final, bool) else DEFAULT_INTENSITY
    image = _load_image(path, encoding)

    coords = nt.nodes.new("ShaderNodeTexCoord")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(_sky_color(nt, coords.outputs["Generated"], image, encoding, level, yaw), bg.inputs["Color"])
    for i, node in enumerate(sorted(nt.nodes, key=lambda n: n.type == "OUTPUT_WORLD")):
        node.location = (200 * i - 200 * len(nt.nodes), 0)

    _show_world(context)

    hidden = room.get("skyboxHidden") is True
    if hidden:
        # The app keeps the lighting but draws no sky: show the background to rays, not the camera.
        light_path = nt.nodes.new("ShaderNodeLightPath")
        mix = nt.nodes.new("ShaderNodeMixShader")
        black = nt.nodes.new("ShaderNodeBackground")
        black.inputs["Strength"].default_value = 0.0
        nt.links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
        nt.links.new(bg.outputs["Background"], mix.inputs[1])
        nt.links.new(black.outputs["Background"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    else:
        nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if url and not hidden and room.get("skyboxType") in ("dome", "box"):
        _sky_mesh(context, space_id, title, room, image, encoding, yaw, strength)
    return ""
