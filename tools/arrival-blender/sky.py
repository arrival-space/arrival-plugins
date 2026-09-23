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

import math

import bpy

from . import space

DECODE_LABEL = "Arrival decode"


def world_name(title, space_id):
    return f"Arrival: {title or space_id}"


def find_world(space_id):
    for world in bpy.data.worlds:
        if world.get("arrival_space_id") == space_id:
            return world
    return None


def remove(scene, space_id):
    world = find_world(space_id)
    if not world:
        return
    if scene.world == world:
        scene.world = None
    bpy.data.worlds.remove(world)


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


def apply(context, space_id, title, room, files):
    """Set up the scene's world from the space's skybox settings. Returns a warning, or ""."""
    url = space._str(room.get("skyboxImage"))
    if not url:
        remove(context.scene, space_id)
        return ""
    try:
        path = space._local_file("", url, files)
    except space.EntityError as e:
        return f"Skybox: {e}"

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

    coords = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    # Turning the lookup vector by +skyboxRotation turns the sky the way the app does (checked
    # against the app's screenshot of a space with a 35 degree rotation).
    mapping.inputs["Rotation"].default_value[2] = math.radians(space._f(room, "skyboxRotation"))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.extension = "EXTEND"  # the poles; the seam wraps through the lookup itself
    bg = nt.nodes.new("ShaderNodeBackground")
    for node, x in ((coords, -1400), (mapping, -1200), (tex, -500), (bg, -200), (out, 0)):
        node.location = (x, 0)

    image = bpy.data.images.load(path, check_existing=True)
    tex.image = image
    encoding = space._str(room.get("skyboxEncoding")).lower()
    if encoding in ("rgbm", "rgbe", "rgbp"):
        image.colorspace_settings.name = "Non-Color"  # the packed values are data, not colour

    nt.links.new(coords.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(_equirect_uv(nt, mapping.outputs["Vector"]), tex.inputs["Vector"])
    if encoding in ("rgbm", "rgbe", "rgbp"):
        nt.links.new(_decode(nt, tex, encoding), bg.inputs["Color"])
    else:
        nt.links.new(tex.outputs["Color"], bg.inputs["Color"])

    _show_world(context)

    intensity = room.get("skyboxIntensity")
    bg.inputs["Strength"].default_value = float(intensity) if isinstance(intensity, (int, float)) else 1.0

    if room.get("skyboxHidden") is True:
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
    return ""
