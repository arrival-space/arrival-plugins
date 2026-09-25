# The default hub ("architecture") around spaces with hideArchitecture off.
#
# It isn't space data: it's part of the Arrival app's PlayCanvas scene. We read that scene from the
# published app (config.json, the custom.travel.center scene, its GLB containers), switch parts on
# and off from the space's room.json and static gates the way custom-travel-center.js and
# gate-logic.js do, and build read-only reference geometry. Nothing here is ever pushed.

import json
import os
import struct
import urllib.request

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import space

APP_URL = "https://arrival.space/"
SCENE_NAME = "custom.travel.center"

# gate-server.js GATE_GUIDS: the i-th child of "Gates" is stored in the space under this entity id.
GATE_GUIDS = [
    "9769e4b4-e5d9-4286-9353-c2c66b158347",
    "1aef8fd4-6447-4e04-969a-4669c11dd52e",
    "75f16b87-5314-4cdf-a8d5-bb2a8292b687",
    "608f2483-802b-4fa7-95bb-920bed1431ad",
    "fcc35518-309c-47e1-8d93-d939d6bca475",
    "404c7fe3-26f1-4fb6-bac7-a50bf1f3cb1a",
    "b9a67fa0-00ce-401d-94c2-4045c4aaec35",
]

ROOTS = ("ArrivalLobby02", "Gates", "NavigationPortals")
BLEND_NONE = 3


# ---- reading the app scene (background thread) ----

def _get(url, cache_dir, ctx):
    # config.json and the scene aren't versioned, so fetch them fresh and fall back to the last copy.
    path = os.path.join(cache_dir, "app-" + os.path.basename(url))
    try:
        req = urllib.request.Request(space.encode_url(url), headers={"User-Agent": "arrival-blender"})
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
        return data
    except OSError:
        if os.path.isfile(path):
            with open(path, "rb") as f:
                return f.read()
        raise


def _decompress(scene):
    # PlayCanvas's compressed scene format (engine Decompress + CompressUtils).
    cf = scene.get("compressedFormat")
    if not cf:
        return scene["entities"], None

    def key(k):
        if len(k) > 2:
            return k
        i = 0
        for ch in k:
            i = i * cf["fieldCodeBase"] + ord(ch) - cf["fieldFirstCode"]
        return cf["fieldArray"][i]

    def dec(n):
        if isinstance(n, dict):
            return {key(k): dec(v) for k, v in n.items()}
        if isinstance(n, list):
            return [dec(v) for v in n]
        return n

    return dec(scene["entities"]), cf


def _local_matrix(e, cf):
    if cf:
        sv, tv = cf["singleVecs"], cf["tripleVecs"]
        idx = e.get("___1") or tv[e["___2"]:e["___2"] + 3]
        pos, rot, scl = (sv[i:i + 3] for i in idx)
    else:
        pos, rot, scl = e["position"], e["rotation"], e["scale"]
    return Matrix.LocRotScale(Vector(pos), Euler([v * 0.017453292519943295 for v in rot], "XYZ"), Vector(scl))


def _hex(color):
    if not isinstance(color, str) or not color.startswith("#") or len(color) < 7:
        return None
    try:
        return [int(color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    except ValueError:
        return None


def _gate_state(data):
    """Which gate_modules parts a static gate shows (gate-logic.js, desktop)."""
    d = data or {}
    empty = not (d.get("description") or d.get("link") or d.get("title") or d.get("videoURL"))
    return {
        "Ramp": bool(d.get("link")),
        "ScreenCap": empty,
        "DescriptionScreen": bool(d.get("description") or d.get("logoURL") or d.get("productID") or d.get("downloadable")),
    }


def _color_overrides(ctc_attrs, room):
    """Material asset id -> room color, mirroring CustomTravelCenter.updateRoomColors."""
    def ids(name):
        v = ctc_attrs.get(name)
        return [x for x in (v if isinstance(v, list) else [v]) if x]

    out = {}
    wall, floor = _hex(room.get("wallColor")), _hex(room.get("floorColor"))
    glass, ceiling = _hex(room.get("glassColor")), _hex(room.get("ceilingColor"))
    walls = ids("wallMaterials")
    for i, m in enumerate(walls):
        if wall and (not room.get("wallTexture") or i == 2):
            out[m] = wall
    if floor and not room.get("floorTexture"):
        out.update((m, floor) for m in ids("floorMaterials"))
    if glass:
        out.update((m, glass) for m in ids("glassMaterial") + ids("rampMaterials"))
    if ceiling:
        out.update((m, ceiling) for m in ids("ceilingMaterial"))
    return out


def _collect(assets, scene, room, gates):
    ents, cf = _decompress(scene)
    by_name = {}
    for eid, e in ents.items():
        by_name.setdefault(e.get("name"), []).append(eid)

    # Visitor view of a registered user who navigated here (updateArchitecture / updateNavigationPortals).
    fixed = {
        "ArrivalLobby02": True, "Gates": True,
        "NavigationPortals": not room.get("hideNavigationPortals"),
        "PortalToBack": not room.get("hideBackPortal"), "PortalToNoBack": False,
        "PortalToFeatured": not room.get("hideFeaturedPortal"),
        "PortalToHome": not room.get("hideHomePortal"), "PortalToHomeAtHome": False,
        "PortalToHomeUnregistered": False, "PortalToNew": False, "PortalToNoNew": False,
    }
    # enableEntities goes through findByName, which only hits the first match.
    root_id = next(eid for eid, e in ents.items() if not e.get("parent"))
    order = []
    stack = [root_id]
    while stack:
        eid = stack.pop()
        order.append(eid)
        stack.extend(reversed(ents[eid].get("children", [])))
    first = {}
    for eid in order:
        first.setdefault(ents[eid].get("name"), eid)
    by_id = {}
    for pair in room.get("enableEntities") or []:
        if isinstance(pair, list) and len(pair) >= 2 and pair[0] in first:
            by_id[first[pair[0]]] = pair[1] in (True, "true")

    ctc = by_name.get("CustomTravelCenter", [None])[0]
    ctc_attrs = {}
    if ctc:
        ctc_attrs = (ents[ctc].get("components", {}).get("script", {}).get("scripts", {})
                     .get("customTravelCenter", {}).get("attributes", {}))
    colors = _color_overrides(ctc_attrs, room)

    parts, materials = [], {}

    def material(mid):
        if mid not in materials:
            d = (assets.get(str(mid)) or {}).get("data") or {}
            materials[mid] = {
                "name": (assets.get(str(mid)) or {}).get("name") or str(mid),
                "color": colors.get(mid) or list(d.get("diffuse") or [0.8, 0.8, 0.8])[:3],
                "alpha": 1.0 if d.get("blendType", BLEND_NONE) == BLEND_NONE else float(d.get("opacity", 1)),
            }
        return mid

    def walk(eid, parent, gate_state, in_gates):
        e = ents[eid]
        name = e.get("name")
        enabled = e.get("enabled", True)
        if name in fixed:
            enabled = fixed[name]
        if name in gate_state:
            enabled = gate_state[name]
        if eid in by_id:
            enabled = by_id[eid]
        if not enabled:
            return
        m = parent @ _local_matrix(e, cf)
        r = e.get("components", {}).get("render")
        if r and r.get("enabled", True):
            mats = [material(x) if x else None for x in (r.get("materialAssets") or [])]
            part = {"id": eid, "name": name, "matrix": [list(row) for row in m], "materials": mats}
            ra = assets.get(str(r.get("asset"))) if r.get("type") == "asset" else None
            if ra and ra.get("type") == "render":
                container = assets.get(str(ra["data"]["containerAsset"])) or {}
                if container.get("file"):
                    part["container"] = APP_URL + container["file"]["url"]
                    part["index"] = ra["data"].get("renderIndex", 0)
                    parts.append(part)
            elif r.get("type") in ("box", "cylinder", "plane") and not in_gates:
                part["primitive"] = r["type"]  # gate primitives are buttons and portal effects
                parts.append(part)
        children = e.get("children", [])
        for i, ch in enumerate(children):
            if name == "Gates":
                guid = GATE_GUIDS[i] if i < len(GATE_GUIDS) else None
                walk(ch, m, _gate_state(gates.get(guid)), True)
            else:
                walk(ch, m, gate_state, in_gates)

    for root_name in ROOTS:
        for eid in by_name.get(root_name, []):
            parent = Matrix.Identity(4)
            chain = []
            p = ents[eid].get("parent")
            while p:
                chain.append(p)
                p = ents[p].get("parent")
            for p in reversed(chain):
                parent = parent @ _local_matrix(ents[p], cf)
            walk(eid, parent, {}, False)
    return parts, materials


_COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_SIZES = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def _accessor(js, binary, index):
    acc = js["accessors"][index]
    if "bufferView" not in acc or "sparse" in acc:
        raise ValueError("unsupported glTF accessor")
    view = js["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(_COMPONENTS[acc["componentType"]])
    n, count = _SIZES[acc["type"]], acc["count"]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or dtype.itemsize * n
    out = np.empty((count, n), dtype)
    for c in range(n):
        out[:, c] = np.ndarray((count,), dtype, binary, start + c * dtype.itemsize, (stride,))
    return out


def _read_mesh(js, binary, index):
    """[(positions, normals | None, triangle indices)] of one glTF mesh (= a PlayCanvas renderIndex)."""
    prims = []
    for prim in js["meshes"][index]["primitives"]:
        if prim.get("mode", 4) != 4:
            continue
        attrs = prim["attributes"]
        pos = _accessor(js, binary, attrs["POSITION"]).astype(np.float32)
        nrm = _accessor(js, binary, attrs["NORMAL"]).astype(np.float32) if "NORMAL" in attrs else None
        idx = (_accessor(js, binary, prim["indices"]).ravel() if "indices" in prim else np.arange(len(pos))).astype(np.int32)
        prims.append((pos, nrm, idx[: len(idx) // 3 * 3]))
    return prims


def fetch(task, cache_dir, room, gates):
    """Task body: the hub parts for this space, with their mesh data read from the app's GLBs."""
    os.makedirs(cache_dir, exist_ok=True)
    ctx = space._ssl_context()
    task.progress = "Loading the hub…"
    cfg = json.loads(_get(APP_URL + "config.json", cache_dir, ctx))
    scene_url = next(s["url"] for s in cfg["scenes"] if s["name"] == SCENE_NAME)
    scene = json.loads(_get(APP_URL + scene_url, cache_dir, ctx))
    parts, materials = _collect(cfg["assets"], scene, room, gates)

    urls = sorted({p["container"] for p in parts if "container" in p})
    files = space.download_all(task, urls, cache_dir, label="Downloading the hub")
    glbs, meshes = {}, {}
    for p in parts:
        if "container" not in p:
            continue
        key = (p["container"], p["index"])
        if key in meshes:
            continue
        path = files.get(p["container"])
        if isinstance(path, Exception):
            raise path
        if path not in glbs:
            glbs[path] = space.read_glb(path)
        meshes[key] = _read_mesh(*glbs[path], p["index"])
    return {"parts": parts, "materials": materials, "meshes": meshes}


def read_static_gates(ws):
    out = {}
    edir = os.path.join(ws, "space", "entities")
    for name in os.listdir(edir) if os.path.isdir(edir) else []:
        if not name.endswith(".json"):
            continue
        try:
            ent = space.read_json(os.path.join(edir, name))
        except (OSError, ValueError):
            continue
        if isinstance(ent, dict) and ent.get("id") in GATE_GUIDS and isinstance(ent.get("data"), dict):
            out[ent["id"]] = ent["data"]
    return out


# ---- building (main thread) ----

def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _material(info):
    mat = bpy.data.materials.new("Hub " + info["name"])
    mat["arrival_hub"] = True
    if mat.node_tree is None:  # Blender < 5
        mat.use_nodes = True
    color = [_srgb_to_linear(c) for c in info["color"]] + [1.0]
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Alpha"].default_value = info["alpha"]
    mat.diffuse_color = color[:3] + [info["alpha"]]
    return mat


def _mesh_from_prims(name, prims):
    pos = np.concatenate([p[0] for p in prims])
    tris, mat_index, offset = [], [], 0
    for i, (p, _n, idx) in enumerate(prims):
        tris.append(idx + offset)
        mat_index.append(np.full(len(idx) // 3, i, np.int32))
        offset += len(p)
    tris = np.concatenate(tris)
    # PlayCanvas (x, y, z) -> Blender (x, -z, y), same as the glTF importer.
    co = np.column_stack((pos[:, 0], -pos[:, 2], pos[:, 1])).astype(np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.ravel())
    me.loops.add(len(tris))
    me.loops.foreach_set("vertex_index", tris)
    me.polygons.add(len(tris) // 3)
    me.polygons.foreach_set("loop_start", np.arange(0, len(tris), 3, dtype=np.int32))
    me.polygons.foreach_set("material_index", np.concatenate(mat_index))
    me.update(calc_edges=True)
    me.validate()
    if all(p[1] is not None for p in prims):
        nrm = np.concatenate([p[1] for p in prims])
        me.shade_smooth()
        me.normals_split_custom_set_from_vertices(np.column_stack((nrm[:, 0], -nrm[:, 2], nrm[:, 1])).tolist())
    return me


def _primitive(name, kind):
    # PlayCanvas primitives are unit sized and centred; the cylinder runs along Y (Blender Z).
    me = bpy.data.meshes.new(name)
    if kind == "box":
        v = [(x, y, z) for x in (-.5, .5) for y in (-.5, .5) for z in (-.5, .5)]
        f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    elif kind == "plane":
        v = [(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0)]
        f = [(0, 1, 2, 3)]
    else:
        seg = 32
        ring = [(0.5 * np.cos(a), 0.5 * np.sin(a)) for a in np.linspace(0, 2 * np.pi, seg, endpoint=False)]
        v = [(x, y, -.5) for x, y in ring] + [(x, y, .5) for x, y in ring]
        f = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
        f += [tuple(reversed(range(seg))), tuple(range(seg, 2 * seg))]
    me.from_pydata(v, [], f)
    return me


def hub_collection(space_coll):
    for coll in space_coll.children:
        if coll.get("arrival_hub"):
            return coll
    return None


def remove(space_coll):
    coll = hub_collection(space_coll)
    if coll:
        for ob in list(coll.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in [x for x in block if x.get("arrival_hub") and x.users == 0]:
            block.remove(item)


def is_hub_object(ob):
    return "arrival_hub_part" in ob


def set_selectable(scene, selectable):
    for ob in scene.objects:
        if is_hub_object(ob):
            ob.hide_select = not selectable


def build(space_coll, hub, selectable=False):
    """Build or update the space's Hub collection. A part keeps its object across rebuilds (keyed by
    its entity in the app's scene), so modifiers of other objects that target it keep their target.
    Unselectable by default, so clicks reach the entities; its transforms are always locked."""
    coll = hub_collection(space_coll)
    if coll is None:
        coll = bpy.data.collections.new("Hub")
        coll["arrival_hub"] = True
        space_coll.children.link(coll)
    existing = {ob.get("arrival_hub_part"): ob for ob in coll.objects}

    mats = {mid: _material(info) for mid, info in hub["materials"].items()}
    meshes = {}
    for part in hub["parts"]:
        source = (part["container"], part["index"]) if "container" in part else part["primitive"]
        key = (source, tuple(part["materials"]))
        me = meshes.get(key)
        if me is None:
            if "container" in part:
                me = _mesh_from_prims(part["name"], hub["meshes"][source])
            else:
                me = _primitive(part["name"], part["primitive"])
            me["arrival_hub"] = True
            for mid in part["materials"]:
                me.materials.append(mats.get(mid))
            meshes[key] = me
        ob = existing.pop(part["id"], None)
        if ob is None:
            ob = bpy.data.objects.new(part["name"], me)
            ob["arrival_hub_part"] = part["id"]
            coll.objects.link(ob)
        else:
            ob.data = me
            ob.name = part["name"]
        ob.matrix_world = space.C @ Matrix(part["matrix"]) @ space.C_INV
        ob.lock_location = ob.lock_rotation = ob.lock_scale = (True,) * 3
        ob.hide_select = not selectable
    # Parts the space's settings turned off, and objects of older builds (without a part id).
    for ob in existing.values():
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in [x for x in block if x.get("arrival_hub") and x.users == 0]:
            block.remove(item)
    return coll
