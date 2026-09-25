# A pulled workspace (space/entities/*.json) <-> Blender objects.
#
# Coordinates: Arrival (PlayCanvas) is Y-up, Blender is Z-up. The glTF importer/exporter converts
# mesh data with the same +90° X rotation (C), so an entity's Blender matrix is C · M_pc · C⁻¹ and
# an imported model hangs under it unchanged. PlayCanvas Euler angles are degrees applied X, then
# Y, then Z, which is Blender's "XYZ" order. Entity scale is a single uniform number.
#
# Every entity with a data.position becomes one "root" object carrying ObjectProps (props.py):
#   GLB    the imported model: the mesh itself when the file holds a single mesh, else an Empty
#          with the model's nodes parented under it. Its geometry is editable and re-uploaded.
#   IMAGE  a textured plane shaped like the client's image plane. Editing it (mesh, material, parts,
#          a stretch) turns the entity into a model: Push uploads the plane as a GLB.
#   SPLAT  a Gaussian splat imported by the Splatlight add-on, when it's installed. Splatlight keeps
#          the file's own axes and turns the object instead, so for these (raw_axes) the object
#          matrix is the entity matrix times C. Points can be deleted and re-uploaded as .ply.
#   SPAWN  a SpawnPoint: a marker mesh (spawn.py). Only its position and facing sync.
#   other  an Empty placeholder (plugins, video, splats without Splatlight, ...): transform only.
#
# A model's object may be stretched (non-uniform scale), which an entity can't hold. Push bakes the
# stretch into the uploaded GLB and keeps it on the object as model_offset: the object's matrix is
# the entity matrix times model_offset (for raw_axes splats that offset is C).
#
# Editable content (models, images, Splatlight splats) remembers the file it matches (source_url): the one it
# was imported from, or the one a Push uploaded it as. On Reload, an entity whose live file is still
# that one keeps its Blender object, modifiers and all, and only takes the live placement, name,
# folder and visibility. Re-importing it would bring back the flattened export instead.

import hashlib
import html
import json
import math
import os
import re
import secrets
import shutil
import ssl
import struct
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import hub, sky, spawn

C = Matrix.Rotation(math.radians(90.0), 4, "X")
C_INV = C.inverted()

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
MODEL_KINDS = {"GLB", "IMAGE"}  # what Push can export as a GLB
SPLAT_EXTS = {".ply", ".sog", ".spz", ".splat", ".splatv", ".lcc", ".lcc2", ".asat", ".ksplat"}
EMPTY_DISPLAY = {"PLUGIN": "PLAIN_AXES", "SPLAT": "CUBE", "OTHER": "ARROWS"}

EPS_POS = 1e-4
EPS_ROT = 1e-5
EPS_SCALE = 1e-5


class EntityError(Exception):
    pass


# ---- workspace files ----

def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    # Same shape as the server's JSON.stringify(obj, null, 2), so a push diff shows only real edits.
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, indent=2, ensure_ascii=False))


def load_entities(ws):
    """[(rel_path, entity)] for every entity that has a position. RoomInfo is left alone."""
    edir = os.path.join(ws, "space", "entities")
    out = []
    for name in sorted(os.listdir(edir)) if os.path.isdir(edir) else []:
        if not name.endswith(".json"):
            continue
        rel = f"space/entities/{name}"
        try:
            ent = read_json(os.path.join(ws, rel))
        except (OSError, ValueError):
            continue
        data = ent.get("data") if isinstance(ent, dict) else None
        if not (ent.get("id") and isinstance(data, dict)):
            continue
        # A CenterAsset is the room's old "center content": it is placed by the room's settings
        # rather than by a position of its own.
        if isinstance(data.get("position"), dict) or ent.get("type") == "CenterAsset":
            out.append((rel, ent))
    return out


# The app's CenterAsset scene entity, which those rows were positioned inside (see
# gate-server.js centerLocalRotationToWorld and the note in user-model-entity.js).
CENTER_SCENE_ROTATION = (180.0, 0.0, 180.0)
CENTER_IMAGE_FRAME_HEIGHT = 4.0  # user-model-entity.js


def center_placement(ent, room):
    """Where a CenterAsset sits, mirroring GateServer.buildUserModelDataFromCenter."""
    d = ent["data"]
    url = _str(d.get("assetURL"))
    cp = room.get("centerPosition") if isinstance(room.get("centerPosition"), dict) else {}
    cr = room.get("centerRotation") if isinstance(room.get("centerRotation"), dict) else {}
    is_image = url_ext(url) in IMAGE_EXTS

    if room.get("absolutePosition"):
        position = {"x": _f(cp, "x"), "y": _f(cp, "y"), "z": _f(cp, "z")}
        rotation = {"x": _f(cr, "x"), "y": _f(cr, "y"), "z": _f(cr, "z")}
    else:
        position = {"x": _f(cp, "x"), "y": _f(cp, "y") + _f(d, "assetYOffset"), "z": _f(cp, "z")}
        local = Euler((math.radians(_f(d, "assetXRotation") + _f(cr, "x")),
                       math.radians(_f(d, "assetRotation") + _f(cr, "y")),
                       math.radians(_f(cr, "z"))), "XYZ").to_quaternion()
        turn = Euler([math.radians(v) for v in CENTER_SCENE_ROTATION], "XYZ").to_quaternion() @ local
        if is_image:  # the old centre image was a two-sided pair; face its readable side outward
            turn = turn @ Euler((0.0, math.pi, 0.0), "XYZ").to_quaternion()
        e = turn.to_euler("XYZ")
        rotation = {"x": math.degrees(e.x), "y": math.degrees(e.y), "z": math.degrees(e.z)}

    scale = _f(d, "assetScale") or 1.0
    cs = room.get("centerScale")
    if isinstance(cs, dict):
        scale *= _f(cs, "x")
    if is_image:  # its size lived in the scene template, not in the row
        scale *= CENTER_IMAGE_FRAME_HEIGHT
        position["y"] += scale / 2.0
    return {"glbUrl": url, "position": position, "rotation": rotation, "scale": scale}


# spawn-point-entity.js loadData: a spawn point without a rotation faces +Z (yaw 180).
SPAWN_DEFAULT_ROTATION = {"x": 0, "y": 180, "z": 0}


def effective_data(ent, room):
    data = ent["data"]
    if ent.get("type") == "CenterAsset":
        return center_placement(ent, room)
    if ent.get("type") == "SpawnPoint" and not isinstance(data.get("rotation"), dict):
        return {**data, "rotation": dict(SPAWN_DEFAULT_ROTATION)}
    return data


def read_room(ws):
    """RoomInfo data (room.json): title, hideArchitecture, hub colors, ..."""
    try:
        data = read_json(os.path.join(ws, "space", "room.json")).get("data")
    except (OSError, ValueError, AttributeError):
        return {}
    return data if isinstance(data, dict) else {}


def url_ext(url):
    return os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()


def _glb_url(data):
    url = data.get("glbUrl")
    return url if isinstance(url, str) else ""


def classify(data, entity_type=""):
    if entity_type == "SpawnPoint":
        return "SPAWN"
    url = _glb_url(data)
    ext = url_ext(url)
    if url.startswith("plugins/") or ext == ".mjs":
        return "PLUGIN"
    if ext == ".glb":
        return "GLB"
    if ext in IMAGE_EXTS:
        return "IMAGE"
    if ext in SPLAT_EXTS or url.endswith("lod-meta.json"):
        return "SPLAT"
    return "OTHER"


def model_source(data):
    """The GLB to edit. Uploaded GLBs get a lossy draco+webp `.opt.glb` sibling (glbopt job) with the
    original kept in usdSourceFile; edit the original when it still matches."""
    url = _glb_url(data)
    src = data.get("usdSourceFile")
    if (isinstance(src, str) and re.search(r"\.opt\.glb(?=$|[?#])", url, re.I)
            and re.sub(r"\.glb(?=$|[?#])", ".opt.glb", src, flags=re.I) == url):
        return src
    return url


def splat_source(data):
    """The splat file to load. LOD splats (lod-meta.json, .lcc2) stream from many files; load the
    original they were built from instead."""
    url = _glb_url(data)
    lod = data.get("lodParameter")
    original = lod.get("originalFile") if isinstance(lod, dict) else None
    if isinstance(original, str) and original and url_ext(url) not in (".ply", ".sog", ".spz", ".splat", ".ksplat"):
        return original
    return url


# ---- names, as the client's Content panel shows them ----

PORTAL_NAMES = {"back": "Back Portal", "home": "Home Portal", "featured": "Featured Portal"}
DEFAULT_NAMES = {
    "UserModelEntity": "Asset", "CenterAsset": "Asset", "DynamicGate": "Gate", "RecordedAvatar": "Voicey",
    "CustomSoundEntity": "Sound", "AnnotationEntity": "Annotation", "NavigationPortal": "Portal",
}


def _str(v):
    return v if isinstance(v, str) else ""


def _file_name(url):
    """ui_utils.getFileNameFromUrl."""
    if not url:
        return ""
    if not urllib.parse.urlparse(url).scheme:
        return url.split("/")[-1]  # a workspace token (assets/…, plugins/…) standing in for the CDN url
    name = urllib.parse.urlparse(url).path.split("/")[-1] or url
    return urllib.parse.unquote(re.sub(r"^[a-f0-9]{64}(?:_[a-f0-9]{64})?_", "", name))


def _lod_name(url):
    """ui_utils.getNameFromLODUrl."""
    parts = url.split("/")
    if len(parts) < 2 or not re.search(r"_LOD$", parts[-2], re.I):
        return ""
    folder = parts[-2]
    folder = folder[folder.index("_") + 1:] if "_" in folder else folder
    folder = re.sub(r"(\.\w+)?_LOD$", "", folder, flags=re.I)
    return folder + ".lod" if folder else ""


def _strip_ext(name):
    """ui_utils.removeExtensionFromFileName."""
    i = name.rfind(".")
    return name if i <= 0 else name[:i]


def _html_text(html_string):
    """ui_utils.extractTextFromHtml: the text, cut to 16 characters."""
    text = html.unescape(re.sub(r"<[^>]*>", "", html_string or ""))
    return text[:16].strip()


def _model_entity_name(d):
    # The name user-model-entity.js gives the loaded content (entity.entityName).
    url = _glb_url(d)
    ext = url_ext(url)
    if d.get("hidden"):
        return _str(d.get("scriptName")) or _lod_name(url) or _file_name(url)
    if url.startswith("plugins/") or ext in (".mjs", ".js"):
        return _str(d.get("scriptName")) or _file_name(url)
    if ext in (".glb", ".gltf"):
        return _str(d.get("displayName")) or _file_name(url)
    if ext in (".ply", ".asat") and d.get("isSOGed"):
        return _file_name(re.sub(r"\.(ply|asat)(?=$|[?#])", ".sog", url, flags=re.I))
    return _lod_name(url) or _file_name(url)


def panel_name(ent):
    """getEntitySortName (ContentPanel) over GateServer.getFileNameFromEntity."""
    d, kind = ent["data"], ent.get("type")
    if _str(d.get("displayName")):
        return d["displayName"]
    if kind == "RecordedAvatar":
        return _str(d.get("name")) or DEFAULT_NAMES[kind]
    if kind == "CenterAsset":
        name = _file_name(_str(d.get("assetURL")))
    elif kind == "DynamicGate":
        name = _str(d.get("title")) or "Gate"
    elif kind == "UserModelEntity":
        name = _model_entity_name(d)
    elif kind == "AnnotationEntity":
        name = _html_text(_str(d.get("htmlString"))) or "Annotation"
    elif kind == "CustomSoundEntity":
        name = _file_name(_str(d.get("audioUrl"))) or "Sound"
    elif kind == "SpawnPoint":
        name = "Spawn Point"
    elif kind == "NavigationPortal":
        name = PORTAL_NAMES.get(d.get("kind"), "Portal")
    else:
        name = ""
    if name:
        return _strip_ext(name)
    if _str(d.get("scriptName")):
        return d["scriptName"]
    return _strip_ext(_str(d.get("name"))) or DEFAULT_NAMES.get(kind, "Entity")


def _blender_name(name):
    # Object names hold 63 bytes.
    return name.encode("utf-8")[:63].decode("utf-8", "ignore")


def _base_name(name):
    # Without the ".001" Blender adds when a name is taken.
    return re.sub(r"\.\d{3}$", "", name)


def _source(data, kind):
    if kind == "GLB":
        return model_source(data)
    if kind == "IMAGE":
        return _glb_url(data)
    if kind == "SPLAT" and splatlight_available():
        return splat_source(data)
    return ""


def is_editable(root):
    a = root.arrival
    return a.kind in MODEL_KINDS or (a.kind == "SPLAT" and a.raw_axes)


def kept_roots(scene, space_id, entities, room):
    """{entity id: root} for the entities Reload keeps: editable ones whose live file is still the
    one their object matches. A duplicate (same entity id) never counts, like in prepare_push."""
    live = {}
    for _rel, ent in entities:
        data = effective_data(ent, room)
        live[ent["id"]] = _source(data, classify(data, ent.get("type")))
    by_id = {}
    for root in sorted(entity_roots(scene, space_id), key=lambda o: o.name):
        by_id.setdefault(root.arrival.entity_id, root)
    return {eid: root for eid, root in by_id.items()
            if is_editable(root) and root.arrival.source_url and root.arrival.source_url == live.get(eid)}


def download_urls(entities, room=None, skip=()):
    """What build() needs downloaded. `skip`: entity ids it keeps (kept_roots), so no download."""
    urls = set()
    for _rel, ent in entities:
        if ent["id"] in skip:
            continue
        data = effective_data(ent, room or {})
        urls.add(_source(data, classify(data, ent.get("type"))))
    urls.add(_str((room or {}).get("skyboxImage")))
    return sorted(u for u in urls if u.startswith(("http://", "https://")))


def _cache_path(cache_dir, url):
    return os.path.join(cache_dir, hashlib.sha1(url.encode("utf-8")).hexdigest() + url_ext(url))


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def encode_url(url):
    """Percent-encode an URL's path/query. Uploads keep their original file names, so a space in
    one reaches us raw, and urllib refuses to request it."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(parts._replace(
        path=urllib.parse.quote(parts.path, safe="/%:@&=+$,~!*'()"),
        query=urllib.parse.quote(parts.query, safe="/%:@&=+$,~!*'()?"),
    ))


def _download(url, dest, ctx):
    # UGC file names are content-hashed, so a cached copy never goes stale.
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return dest
    tmp = dest + ".part"
    req = urllib.request.Request(encode_url(url), headers={"User-Agent": "arrival-blender"})
    with urllib.request.urlopen(req, timeout=120, context=ctx) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    os.replace(tmp, dest)
    return dest


def _fetch(url, cache_dir, ctx):
    # Uploaded splats get a compressed .sog written next to them (the client's resolveSplatUrl
    # prefers it): a fraction of the download, and .asat files are only readable that way.
    path = urllib.parse.urlparse(url).path.lower()
    if path.endswith((".ply", ".asat")):
        sog = re.sub(r"\.(ply|asat)(?=$|[?#])", ".sog", url, flags=re.I)
        try:
            return _download(sog, _cache_path(cache_dir, sog), ctx)
        except urllib.error.HTTPError:
            if path.endswith(".asat"):
                raise EntityError("encrypted .asat splat without a .sog version")
    return _download(url, _cache_path(cache_dir, url), ctx)


def download_all(task, urls, cache_dir, label="Downloading models"):
    """Task body: {url: local path | Exception}."""
    os.makedirs(cache_dir, exist_ok=True)
    ctx = _ssl_context()
    results = {}

    def one(url):
        try:
            return url, _fetch(url, cache_dir, ctx)
        except Exception as e:
            return url, e

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(one, u) for u in urls]
        for i, fut in enumerate(as_completed(futures), 1):
            url, res = fut.result()
            results[url] = res
            task.progress = f"{label} {i}/{len(urls)}"
    return results


def _local_file(ws, url, files):
    if url.startswith("assets/"):
        path = os.path.join(ws, "space", *url.split("/"))
        if not os.path.isfile(path):
            raise EntityError(f"missing {url}")
        return path
    res = files.get(url)
    if isinstance(res, Exception):
        raise EntityError(f"download failed: {res}")
    if not res:
        raise EntityError(f"can't load {url}")
    return res


# ---- transforms ----

def _num(v):
    v = round(v, 6)
    if v == 0:
        return 0
    return int(v) if v.is_integer() else v


def _f(d, key):
    v = d.get(key) if isinstance(d, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _scale(data):
    s = data.get("scale")
    # Mirrors the client: `data.scale && typeof data.scale === "number"`, else 1.
    return float(s) if isinstance(s, (int, float)) and not isinstance(s, bool) and s else 1.0


def _euler(data):
    r = data.get("rotation")
    return Euler(tuple(math.radians(_f(r, k)) for k in "xyz"), "XYZ")


def data_matrix(data):
    p = data.get("position")
    s = _scale(data)
    m_pc = Matrix.LocRotScale(Vector((_f(p, "x"), _f(p, "y"), _f(p, "z"))), _euler(data), Vector((s, s, s)))
    return C @ m_pc @ C_INV


def _spawn_rotation(rot, old):
    """spawn-point-entity.js moveFinished: pitch and yaw from the forward vector (-Z), no roll.
    Yaw stays within 180° of the old value, so the numbers stay readable."""
    f = rot @ Vector((0.0, 0.0, -1.0))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, f.y))))
    yaw = math.degrees(old.y)
    if f.x * f.x + f.z * f.z > 1e-6:
        yaw = math.degrees(math.atan2(-f.x, -f.z))
        yaw += 360.0 * round((math.degrees(old.y) - yaw) / 360.0)
    return pitch, yaw


def write_transform(data, mw, name, spawn=False):
    """Write a Blender world matrix into data.position/rotation/scale. Only the parts that moved are
    rewritten, so float round-trips never touch untouched values. Returns True if anything changed.
    A spawn point (spawn=True) has no scale and stores only pitch and yaw."""
    m_pc = C_INV @ mw @ C
    if m_pc.to_3x3().determinant() <= 0:
        raise EntityError(f"{name}: mirrored (negative) scale isn't supported on entities, apply it to the model instead")
    loc, rot, sca = m_pc.decompose()
    if spawn and max(abs(v - 1.0) for v in sca) > 1e-4:
        raise EntityError(f"{name}: spawn points can't be scaled, set its scale back to 1")
    if max(sca) - min(sca) > 1e-4 * max(sca):
        raise EntityError(f"{name}: entities only support uniform scale, scale evenly (or scale the model inside it)")

    changed = False
    p = data.get("position") if isinstance(data.get("position"), dict) else {}
    if (loc - Vector((_f(p, "x"), _f(p, "y"), _f(p, "z")))).length > EPS_POS:
        data["position"] = {**p, "x": _num(loc.x), "y": _num(loc.y), "z": _num(loc.z)}
        changed = True

    r = data.get("rotation") if isinstance(data.get("rotation"), dict) else None
    old = _euler({"rotation": r if r is not None or not spawn else SPAWN_DEFAULT_ROTATION})
    angle = rot.rotation_difference(old.to_quaternion()).angle
    if min(angle, 2 * math.pi - angle) > EPS_ROT:
        if spawn:
            pitch, yaw = _spawn_rotation(rot, old)
            data["rotation"] = {**(r or {}), "x": _num(pitch), "y": _num(yaw), "z": 0}
        else:
            e = rot.to_euler("XYZ", old)  # nearest to the old angles, so values stay readable
            data["rotation"] = {**(r or {}), "x": _num(math.degrees(e.x)), "y": _num(math.degrees(e.y)),
                                "z": _num(math.degrees(e.z))}
        changed = True

    if spawn:
        return changed
    s = sum(sca) / 3.0
    old_s = _scale(data)
    if abs(s - old_s) > EPS_SCALE * max(1.0, old_s):
        data["scale"] = _num(s)
        changed = True
    return changed


def matrices_close(a, b, eps=1e-5):
    return all(abs(x - y) <= eps for ra, rb in zip(a, b) for x, y in zip(ra, rb))


def model_offset(root):
    """The object's matrix relative to its entity's: C for raw_axes splats, else the stretch the
    last Push baked into the model (identity for an unstretched one)."""
    return C.copy() if root.arrival.raw_axes else Matrix(root.arrival.model_offset)


def entity_matrix(root):
    """The entity's placement as a Blender matrix (C · M_pc · C⁻¹)."""
    return root.matrix_world @ model_offset(root).inverted()


def set_entity_matrix(root, matrix):
    root.matrix_world = matrix @ model_offset(root)


def _uniform(m):
    s = m.to_scale()
    return max(s) - min(s) <= 1e-4 * max(s)


def stretched(root):
    """A model or image scaled unevenly since its last Push: the next Push bakes the stretch."""
    a = root.arrival
    return a.kind in MODEL_KINDS and not a.read_only and not _uniform(entity_matrix(root))


def unstretch(root):
    """(entity matrix, model offset) splitting a stretched object into an evenly scaled entity and
    the stretch baked into its model. The entity keeps the volume: its scale is the stretch's
    geometric mean."""
    loc, rot, sca = entity_matrix(root).decompose()
    s = abs(sca.x * sca.y * sca.z) ** (1.0 / 3.0)
    matrix = Matrix.LocRotScale(loc, rot, Vector((s, s, s)))
    return matrix, matrix.inverted() @ root.matrix_world


# Last pushed/pulled {matrix, name, folder} per (space, entity). Kept out of the .blend on purpose:
# an undo must not rewind it, or undoing a live-pushed move would look like "nothing to push".
# After reopening a file it's read back from the workspace.
_synced = {}


def _state(entity, matrix=None):
    data = entity["data"]
    folder = _str(data.get("folderId"))
    # An entity whose folder was deleted sits at the top, like in the Content panel.
    if folder and not any(c.get("arrival_folder_id") == folder for c in bpy.data.collections):
        folder = ""
    if matrix is None:
        matrix = data_matrix(effective_data(entity, {}))
    return {"matrix": matrix, "name": panel_name(entity), "folder": folder}


def synced_state(root, ws):
    a = root.arrival
    key = (a.space_id, a.entity_id)
    if key not in _synced:
        try:
            _synced[key] = _state(read_json(os.path.join(ws, a.file)))
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            _synced[key] = {"matrix": entity_matrix(root), "name": root.name, "folder": entity_folder(root) or ""}
    return _synced[key]


def set_synced(root, state):
    _synced[(root.arrival.space_id, root.arrival.entity_id)] = state


def entity_folder(root):
    """Content-panel folder id from the collection the object sits in: "" for the space's own
    collection, None when it's somewhere unrelated (then the folder is left alone)."""
    for coll in root.users_collection:
        if coll.get("arrival_folder_id"):
            return coll["arrival_folder_id"]
        if coll.get("arrival_space_id"):
            return ""
    return None


def root_changes(root, ws):
    """(moved, renamed, refiled) since the last pull/push."""
    s = synced_state(root, ws)
    moved = not matrices_close(entity_matrix(root), s["matrix"])
    synced_name = _blender_name(s["name"])
    renamed = root.name != synced_name and _base_name(root.name) != synced_name
    folder = entity_folder(root)
    return moved, renamed, folder is not None and folder != s["folder"]


def clear_synced(space_id):
    for key in [k for k in _synced if k[0] == space_id]:
        del _synced[key]


def content_signature(root):
    """What an edit changes. For a model: names + local transforms of its parts (moving or renaming
    a part is a model edit though no geometry changed). For a splat: its points, since Splatlight's
    geometry nodes re-evaluate on every display tweak and can't flag edits."""
    if root.arrival.kind == "SPLAT":
        if not root.arrival.raw_axes:
            return ""
        me = root.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        return f"{len(me.vertices)}:{hashlib.sha1(co.tobytes()).hexdigest()}"
    parts = sorted(root.children_recursive, key=lambda o: o.name)
    text = "|".join(o.name + ":" + ",".join(f"{v:.5f}" for row in o.matrix_local for v in row) for o in parts)
    return hashlib.sha1(text.encode("utf-8")).hexdigest() if parts else ""


# ---- model-edit tracking ----

_suspend = 0


@contextmanager
def suspended():
    """Ignore depsgraph updates caused by our own imports/exports."""
    global _suspend
    _suspend += 1
    try:
        yield
    finally:
        _suspend -= 1


def find_root(ob):
    while ob is not None:
        if ob.arrival.entity_id:
            return ob
        ob = ob.parent
    return None


def entity_roots(scene, space_id):
    return [ob for ob in scene.objects if ob.arrival.entity_id and ob.arrival.space_id == space_id]


def on_depsgraph_update(scene, depsgraph):
    if _suspend:
        return
    materials = set()
    for u in depsgraph.updates:
        idb = u.id.original if u.id else None
        if isinstance(idb, bpy.types.Object) and u.is_updated_geometry:
            root = find_root(idb)
            if root and root.arrival.kind in MODEL_KINDS and not root.arrival.model_edited:
                root.arrival.model_edited = True
        elif isinstance(idb, bpy.types.Material):
            materials.add(idb)
    if not materials:
        return
    for ob in scene.objects:
        a = ob.arrival
        if a.entity_id and a.kind in MODEL_KINDS and not a.model_edited:
            parts = [ob, *ob.children_recursive]
            if any(s.material in materials for p in parts for s in p.material_slots):
                a.model_edited = True


# ---- building the scene ----

def space_collection(scene, space_id, title):
    for coll in scene.collection.children_recursive:
        if coll.get("arrival_space_id") == space_id:
            return coll
    coll = bpy.data.collections.new(f"Arrival: {title or space_id}")
    coll["arrival_space_id"] = space_id
    scene.collection.children.link(coll)
    return coll


def remove_entities(scene, space_id, keep=()):
    doomed = set()
    for root in entity_roots(scene, space_id):
        if root in keep:
            continue
        doomed.add(root)
        doomed.update(root.children_recursive)
    meshes = {ob.data for ob in doomed if ob.type == "MESH"}
    for ob in doomed:
        bpy.data.objects.remove(ob, do_unlink=True)
    # Splat meshes run to gigabytes; don't leave them in memory until the file is saved.
    for me in meshes:
        if me.users == 0:
            bpy.data.meshes.remove(me)
    clear_synced(space_id)


def _remove_folders(coll):
    for folder in [c for c in coll.children_recursive if c.get("arrival_folder_id")]:
        # Whatever the user added to a folder keeps a place in the scene.
        for ob in folder.objects:
            if len(ob.users_collection) == 1:
                coll.objects.link(ob)
        for child in folder.children:
            if not child.get("arrival_folder_id") and child.name not in coll.children:
                coll.children.link(child)
        bpy.data.collections.remove(folder)


def space_ids(scene):
    ids = {c.get("arrival_space_id") for c in scene.collection.children_recursive}
    ids |= {ob.arrival.space_id for ob in scene.objects if ob.arrival.entity_id}
    return ids - {None, ""}


def remove_space(scene, space_id):
    """Take a space out of the scene: its entities, folders, hub, world and collection. Whatever
    the user added to its collection moves to the scene's own."""
    remove_entities(scene, space_id)
    sky.remove(scene, space_id)
    for coll in [c for c in scene.collection.children_recursive if c.get("arrival_space_id") == space_id]:
        hub.remove(coll)
        _remove_folders(coll)
        for ob in coll.objects:
            if len(ob.users_collection) == 1:
                scene.collection.objects.link(ob)
        for child in coll.children:
            if child.name not in scene.collection.children:
                scene.collection.children.link(child)
        bpy.data.collections.remove(coll)


def _build_folders(coll, room):
    """The Content panel's folders (RoomInfo contentFolders) as nested collections."""
    folders = [f for f in room.get("contentFolders") or [] if isinstance(f, dict) and _str(f.get("id"))]
    colls = {}
    for f in folders:
        c = bpy.data.collections.new(_str(f.get("name")) or "Folder")
        c["arrival_folder_id"] = f["id"]
        colls[f["id"]] = c
    for f in folders:
        try:
            colls.get(f.get("parentId"), coll).children.link(colls[f["id"]])
        except RuntimeError:  # parent cycle
            coll.children.link(colls[f["id"]])
    return folders, colls


def _layer_collections(layer_coll, out):
    out[layer_coll.collection] = layer_coll
    for child in layer_coll.children:
        _layer_collections(child, out)
    return out


def read_glb(path):
    """(json, binary chunk) of a .glb."""
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise EntityError(f"{os.path.basename(path)} is not a GLB")
    off, js, binary = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8:off + 8 + clen]
        off += 8 + clen
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binary = chunk
    return js, binary


def _write_glb(path, js, binary):
    text = json.dumps(js, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    pad = b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(text) + (8 + len(binary) + len(pad) if binary else 0)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(text), 0x4E4F534A))
        f.write(text)
        if binary:
            f.write(struct.pack("<II", len(binary) + len(pad), 0x004E4942))
            f.write(binary + pad)


SPEC_GLOSS = "KHR_materials_pbrSpecularGlossiness"


def without_spec_gloss(path):
    """Blender's glTF importer raises on the deprecated KHR_materials_pbrSpecularGlossiness (it
    assumes a KHR_materials_specular that isn't there), so rewrite those materials as ordinary
    metallic-roughness first. Returns the path to import."""
    try:
        js, binary = read_glb(path)
    except (OSError, ValueError, EntityError, struct.error):
        return path
    if not js or SPEC_GLOSS not in (js.get("extensionsUsed") or []):
        return path
    fixed = os.path.splitext(path)[0] + ".no-specgloss.glb"
    if os.path.isfile(fixed):
        return fixed

    for material in js.get("materials") or []:
        ext = (material.get("extensions") or {}).pop(SPEC_GLOSS, None)
        if ext is None:
            continue
        pbr = material.setdefault("pbrMetallicRoughness", {})
        if "diffuseFactor" in ext:
            pbr["baseColorFactor"] = ext["diffuseFactor"]
        if "diffuseTexture" in ext:
            pbr["baseColorTexture"] = ext["diffuseTexture"]
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0 - float(ext.get("glossinessFactor", 1.0))
    for key in ("extensionsUsed", "extensionsRequired"):
        if SPEC_GLOSS in (js.get(key) or []):
            js[key] = [e for e in js[key] if e != SPEC_GLOSS]
    _write_glb(fixed, js, binary)
    return fixed


def _import_glb(coll, path, name):
    path = without_spec_gloss(path)
    before = set(bpy.data.objects)
    if "FINISHED" not in bpy.ops.import_scene.gltf(filepath=path):
        raise EntityError("glTF import failed")
    new = [o for o in bpy.data.objects if o not in before]
    if (len(new) == 1 and new[0].type == "MESH" and new[0].animation_data is None
            and new[0].data.users == 1 and new[0].matrix_basis.determinant() > 0):
        # A single mesh is its own root: click it to move the entity, Tab into it to edit the model.
        ob = new[0]
        if not matrices_close(ob.matrix_basis, Matrix.Identity(4)):
            ob.data.transform(ob.matrix_basis, shape_keys=True)
            ob.matrix_basis = Matrix.Identity(4)
        ob.name = name
        return ob
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.5
    coll.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    return root


IMAGE_ALPHA_CUTOFF = 0.1  # updateImageMaterial's alphaTest


def _image_material(img, data):
    """The client's image material (updateImageMaterial): unlit and alpha-tested, or lit with
    imageLighting. The unlit one is the node layout Blender's glTF importer builds for
    KHR_materials_unlit with alpha MASK, so a converted image exports as the same material."""
    mat = bpy.data.materials.new(img.name)
    if mat.node_tree is None:  # Blender < 5
        mat.use_nodes = True
    mat.use_backface_culling = data.get("doubleSided") is False
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.location = (bsdf.location.x - 320, bsdf.location.y)
    if data.get("imageLighting") is True:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        return mat
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    nt.nodes.remove(bsdf)
    emission = nt.nodes.new("ShaderNodeEmission")
    camera = nt.nodes.new("ShaderNodeLightPath")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    unlit = nt.nodes.new("ShaderNodeMixShader")
    cut = nt.nodes.new("ShaderNodeMath")
    cut.operation = "LESS_THAN"
    cut.inputs[1].default_value = IMAGE_ALPHA_CUTOFF
    keep = nt.nodes.new("ShaderNodeMath")
    keep.operation = "SUBTRACT"
    keep.inputs[0].default_value = 1.0
    masked = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
    nt.links.new(camera.outputs["Is Camera Ray"], unlit.inputs[0])
    nt.links.new(clear.outputs[0], unlit.inputs[1])
    nt.links.new(emission.outputs[0], unlit.inputs[2])
    nt.links.new(tex.outputs["Alpha"], cut.inputs[0])
    nt.links.new(cut.outputs[0], keep.inputs[1])
    nt.links.new(keep.outputs[0], masked.inputs[0])
    nt.links.new(clear.outputs[0], masked.inputs[1])
    nt.links.new(unlit.outputs[0], masked.inputs[2])
    nt.links.new(masked.outputs[0], out.inputs["Surface"])
    for i, node in enumerate((tex, cut, keep, emission, camera, clear, unlit, masked)):
        node.location = (out.location.x - 200 * (8 - i), out.location.y - 60 * (i % 2))
    return mat


def _image_plane(coll, path, name, data):
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    hw = (w / h if w and h else 1.0) / 2.0
    # The client's plane (loadImagePlane) lies in entity-local XY: 1 unit tall, aspect wide, image
    # top at +Y and image right at -X, facing -Z. Written here already converted to Blender axes.
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(hw, 0, -0.5), (-hw, 0, -0.5), (-hw, 0, 0.5), (hw, 0, 0.5)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name="UVMap")
    for loop, co in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = co
    mesh.materials.append(_image_material(img, data))
    ob = bpy.data.objects.new(name, mesh)
    coll.objects.link(ob)
    return ob


def splatlight_available():
    return hasattr(bpy.types, "GSPLAT_OT_import") and hasattr(bpy.types, "GSPLAT_OT_export_ply")


def _import_splat(path, name):
    before = set(bpy.data.objects)
    # Keep every splat (min_opacity 0) and the file's axes: an edited splat is exported from this
    # object, so anything dropped here would be missing from the upload.
    result = getattr(bpy.ops.gsplat, "import")(
        filepath=path, orientation="NONE", min_opacity=0.0, max_splats=0, auto_cameras=False,
    )
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if "FINISHED" not in result or len(new) != 1:
        raise EntityError("Splatlight couldn't import this splat (see the system console)")
    new[0].name = name
    return new[0]


def _placeholder(coll, name, kind):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = EMPTY_DISPLAY.get(kind, "ARROWS")
    ob.empty_display_size = 0.5
    coll.objects.link(ob)
    return ob


def build(context, space_id, title, ws, entities, files, default_sky=None):
    """Replace this space's objects with fresh ones from the workspace, except the ones Reload keeps
    (kept_roots): those only take the live placement. Returns warnings."""
    scene = context.scene
    view_layer = context.view_layer
    warnings = []
    room = read_room(ws)
    kept = kept_roots(scene, space_id, entities, room)
    with suspended():
        remove_entities(scene, space_id, keep=set(kept.values()))
        coll = space_collection(scene, space_id, title)
        _remove_folders(coll)
        folders, folder_colls = _build_folders(coll, room)
        layers = _layer_collections(view_layer.layer_collection, {})
        for f in folders:
            if f.get("hidden") and folder_colls[f["id"]] in layers:
                layers[folder_colls[f["id"]]].hide_viewport = True
        prev_active = view_layer.active_layer_collection
        built = []
        splat_placeholders = 0
        try:
            for rel, ent in entities:
                data = effective_data(ent, room)
                read_only = ent.get("type") == "CenterAsset"
                kind = classify(data, ent.get("type"))
                name = panel_name(ent)
                folder = _str(data.get("folderId")) if _str(data.get("folderId")) in folder_colls else ""
                target = folder_colls.get(folder, coll)
                # Operator imports (glTF, Splatlight) land in the active collection.
                view_layer.active_layer_collection = layers.get(target, prev_active)
                raw_axes = False
                keep = kept.get(ent["id"])
                try:
                    if keep is not None:
                        root, kind, raw_axes = keep, keep.arrival.kind, keep.arrival.raw_axes
                        for ob in (root, *root.children_recursive):
                            _move_to(ob, target)
                    elif kind == "SPAWN":
                        root = spawn.build(target, name, data)
                    elif kind == "GLB":
                        root = _import_glb(target, _local_file(ws, model_source(data), files), name)
                    elif kind == "IMAGE":
                        root = _image_plane(target, _local_file(ws, _glb_url(data), files), name, data)
                    elif kind == "SPLAT" and splatlight_available():
                        root = _import_splat(_local_file(ws, splat_source(data), files), name)
                        raw_axes = True
                    else:
                        splat_placeholders += kind == "SPLAT"
                        root = _placeholder(target, name, kind)
                except Exception as e:
                    warnings.append(f"{name}: {e}")
                    kind = "OTHER"
                    root = _placeholder(target, name, kind)
                root.name = name
                a = root.arrival
                a.space_id = space_id
                a.entity_id = ent["id"]
                a.entity_type = str(ent.get("type") or "")
                a.file = rel
                a.kind = kind
                a.raw_axes = raw_axes
                a.read_only = read_only
                if keep is None:
                    a.model_offset = Matrix.Identity(4)
                    a.model_edited = False
                    a.source_url = _source(data, kind) if is_editable(root) else ""
                a.spawn_third_person = bool(data.get("isDefaultThirdPerson"))
                a.spawn_free_cam = bool(data.get("isDefaultFreeCam"))
                # The room's settings place a centre asset, and this add-on doesn't write those.
                root.lock_location = root.lock_rotation = root.lock_scale = (read_only,) * 3
                if kind == "SPAWN":
                    # Blender's XYZ Euler of a spawn point is (pitch, roll, yaw): keep roll at 0
                    # and scale at 1, which is all the entity can store.
                    root.lock_rotation = (False, True, False)
                    root.lock_scale = (True,) * 3
                set_entity_matrix(root, data_matrix(data))
                built.append((root, ent, folder))
        finally:
            view_layer.active_layer_collection = prev_active
        view_layer.update()
        for root, ent, folder in built:
            if root not in kept.values():
                # A kept model keeps its signature: edits made since the push still count.
                root.arrival.signature = content_signature(root)
            set_synced(root, {"matrix": entity_matrix(root), "name": panel_name(ent), "folder": folder})
            hidden = bool(effective_data(ent, room).get("hidden"))
            if hidden or root in kept.values():
                for ob in (root, *root.children_recursive):
                    ob.hide_set(hidden)
    sky_warning = sky.apply(context, space_id, title, room, files, default_sky)
    if sky_warning:
        warnings.append(sky_warning)
    if splat_placeholders:
        warnings.append(f"{splat_placeholders} splats show as placeholder cubes. "
                        "Install the Splatlight LITE add-on to see and edit them")
    return warnings


# ---- new entities ----

MODEL_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}  # what the glTF exporter writes as meshes


def new_entity_id():
    # The server's own upload-to-entity id (api.js); the file must be named after it.
    return "user-model-" + secrets.token_hex(8)


def is_new(root, ws):
    """Made in Blender and not pushed yet: there's no entity file for it."""
    return not os.path.isfile(os.path.join(ws, root.arrival.file))


def make_entity(root, space_id):
    """Turn an object into a new model entity of the space. Push exports and creates it."""
    a = root.arrival
    a.space_id = space_id
    a.entity_id = new_entity_id()
    a.entity_type = "UserModelEntity"
    a.file = f"space/entities/{a.entity_id}.json"
    a.kind = "GLB"
    a.raw_axes = a.read_only = False
    a.signature = a.source_url = ""
    a.model_offset = Matrix.Identity(4)
    a.model_edited = True


def loose_objects(objects):
    """The ones that aren't part of an entity or the hub, i.e. that can go into one."""
    return [ob for ob in objects if find_root(ob) is None and not hub.is_hub_object(ob)]


def _move_to(ob, coll):
    for c in list(ob.users_collection):
        if c is not coll:
            c.objects.unlink(ob)
    if coll not in ob.users_collection:
        coll.objects.link(ob)


def add_parts(root, objects, root_matrix=None):
    """Parent objects to a model entity where they are. Push exports them as part of its model."""
    coll = root.users_collection[0]
    inv = (root_matrix or root.matrix_world).inverted()
    for ob in objects:
        if ob.parent not in objects:
            mw = ob.matrix_world.copy()
            ob.parent = root
            ob.matrix_parent_inverse = Matrix.Identity(4)
            ob.matrix_basis = inv @ mw
        _move_to(ob, coll)
    root.arrival.model_edited = True


def new_entity_root(coll, objects, location):
    """The object a new entity is made of. A lone mesh is its own root, like an imported
    single-mesh model; anything else gets an Empty parent at the objects' centre (the 3D cursor
    when there are none)."""
    if len(objects) == 1:
        ob = objects[0]
        m = ob.matrix_world.to_3x3()
        s = m.to_scale()
        if (ob.type == "MESH" and ob.parent is None and not ob.children and ob.data.users == 1
                and m.determinant() > 0 and max(s) - min(s) <= 1e-4 * max(s)):
            _move_to(ob, coll)
            return ob
    top = [ob for ob in objects if ob.parent not in objects]
    if top:
        location = sum((ob.matrix_world.translation for ob in top), Vector()) / len(top)
    root = bpy.data.objects.new("Model", None)
    root.empty_display_type = "ARROWS"
    root.empty_display_size = 0.5
    root.location = location
    coll.objects.link(root)
    add_parts(root, objects, Matrix.Translation(location))
    return root


def _new_entity_json(entity_id):
    zero = {"x": 0, "y": 0, "z": 0}
    return {"id": entity_id, "type": "UserModelEntity",
            "data": {"position": dict(zero), "rotation": dict(zero), "scale": 1}}


# ---- pushing ----

def _slug(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.") or "model"


def _objects_in(value):
    if isinstance(value, bpy.types.Object):
        return {value}
    if isinstance(value, bpy.types.Collection):
        return set(value.all_objects)
    return set()


def _references(ob):
    """Objects ob's modifiers and constraints use: a Boolean cutter, a Mirror or Array offset
    object, a Shrinkwrap target, a Geometry Nodes object input, ..."""
    out = set()
    for owner in (*ob.modifiers, *ob.constraints):
        for prop in owner.bl_rna.properties:
            if prop.type == "POINTER":
                out |= _objects_in(getattr(owner, prop.identifier, None))
        if isinstance(owner, bpy.types.Modifier) and owner.type == "NODES":
            for key in owner.keys():
                out |= _objects_in(owner[key])
    return out


def _outside_references(objects):
    """The objects outside `objects` that their modifiers use, directly or through each other,
    leaving out ones whose parent is among them (they move with it)."""
    found, todo = set(), list(objects)
    while todo:
        for ref in _references(todo.pop()):
            if ref not in objects and ref not in found:
                found.add(ref)
                todo.append(ref)

    def carried(ob):
        p = ob.parent
        while p is not None:
            if p in found:
                return True
            p = p.parent
        return False
    return [ob for ob in found if not carried(ob)]


def _tools(parts):
    """Parts that shape the others instead of being content: Boolean cutters, and objects kept out
    of renders (a hidden helper). They aren't exported."""
    cutters = set()
    for ob in parts:
        for m in ob.modifiers:
            if m.type == "BOOLEAN":
                cutters |= _objects_in(m.collection if getattr(m, "operand_type", "") == "COLLECTION" else m.object)
    return {ob for ob in parts if ob in cutters or ob.hide_render}


@contextmanager
def _render_modifiers(objects):
    """Evaluate the objects' modifiers with their render settings, the finished model, rather than
    the viewport's (a lower Subdivision level, a modifier kept off while modelling). Only settings
    that differ are touched: every change, the restore included, re-evaluates the mesh."""
    saved = []

    def use(m, attr, value):
        if getattr(m, attr) != value:
            saved.append((m, attr, getattr(m, attr)))
            setattr(m, attr, value)
    for ob in objects:
        for m in ob.modifiers:
            use(m, "show_viewport", m.show_render)
            if m.type in ("SUBSURF", "MULTIRES"):
                use(m, "levels", m.render_levels)
    try:
        yield
    finally:
        for m, attr, value in reversed(saved):
            setattr(m, attr, value)


def export_options(settings):
    """glTF exporter arguments for the scene's Export Settings (None: the exporter's defaults).
    Options this Blender's exporter doesn't have are left out."""
    if settings is None:
        return {}
    opts = {
        "export_image_format": settings.image_format,
        "export_image_quality": settings.image_quality,
        "export_jpeg_quality": settings.image_quality,  # its name before Blender 4.3
        "export_draco_mesh_compression_enable": settings.draco,
        "export_draco_mesh_compression_level": settings.draco_level,
        "export_draco_position_quantization": settings.draco_position,
        "export_draco_normal_quantization": settings.draco_normal,
        "export_draco_texcoord_quantization": settings.draco_texcoord,
        "export_draco_color_quantization": settings.draco_color,
        "export_draco_generic_quantization": settings.draco_generic,
        "export_normals": settings.normals,
        "export_tangents": settings.tangents,
        "export_texcoords": settings.texcoords,
        "export_vertex_color": settings.vertex_colors,
        "export_materials": settings.materials,
        "export_animations": settings.animations,
        "export_morph": settings.shape_keys,
        "export_skins": settings.skins,
        "export_attributes": settings.attributes,
    }
    supported = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    return {k: v for k, v in opts.items() if k in supported}


def _material_images(objects):
    """(node, image) for every image texture the objects' materials use, node groups included."""
    trees, seen = [], set()
    for ob in objects:
        for slot in ob.material_slots:
            if slot.material and slot.material.node_tree:
                trees.append(slot.material.node_tree)
    out = []
    while trees:
        tree = trees.pop()
        if tree in seen:
            continue
        seen.add(tree)
        for node in tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                out.append((node, node.image))
            elif node.type == "GROUP" and node.node_tree:
                trees.append(node.node_tree)
    return out


@contextmanager
def _smaller_textures(objects, max_size):
    """Point the objects' materials at copies of their textures scaled to at most max_size px, and
    back afterwards. The copies are edited pixels, so the exporter encodes them anew."""
    swapped, copies = [], {}
    try:
        for node, image in _material_images(objects) if max_size else []:
            w, h = image.size
            if max(w, h) <= max_size:
                continue
            if image not in copies:
                f = max_size / max(w, h)
                small = image.copy()
                small.scale(max(1, round(w * f)), max(1, round(h * f)))
                copies[image] = small
            swapped.append((node, image))
            node.image = copies[image]
        yield
    finally:
        for node, image in swapped:
            node.image = image
        for small in copies.values():
            bpy.data.images.remove(small)


def export_glb(context, root, path, offset=None, settings=None):
    """Export a model root's parts to GLB in entity-local space, with modifiers applied (their render
    settings) and the object's model offset (its stretch, see unstretch) baked in. `settings`: the
    scene's Export Settings (props.ExportSettings)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    view_layer = context.view_layer
    entity = {root, *root.children_recursive}
    parts = [ob for ob in entity if ob is not root or root.type != "EMPTY"]
    parts = [ob for ob in parts if ob not in _tools(parts)]
    # The entity carries the placement, so the file must hold the model at the origin, stretched by
    # the offset. Moving the root there moves its parts along; the objects outside it that its
    # modifiers use (a cutter, a mirror object) are moved with it, or the result would change.
    target = offset if offset is not None else model_offset(root)
    delta = target @ root.matrix_world.inverted()
    outside = _outside_references(entity)
    movers = [root, *outside]
    saved = {ob: ob.matrix_basis.copy() for ob in movers}
    prev_selected = [ob for ob in view_layer.objects if ob.select_get()]
    prev_active = view_layer.objects.active
    # The restores below re-evaluate the model. They're flushed with view_layer.update() while
    # still suspended, or the edit tracking would see them afterwards and mark the model edited.
    with suspended():
        max_size = int(settings.max_texture_size) if settings is not None else 0
        with _render_modifiers([*entity, *outside]), _smaller_textures(parts, max_size):
            try:
                for ob in movers:
                    ob.matrix_world = delta @ ob.matrix_world
                view_layer.update()
                for ob in prev_selected:
                    ob.select_set(False)
                for ob in parts:
                    ob.select_set(True)
                # An unselected Empty root isn't exported; its children are written with their world
                # matrices.
                result = bpy.ops.export_scene.gltf(
                    filepath=path, export_format="GLB", use_selection=True, use_visible=False,
                    use_renderable=False, use_active_collection=False, export_apply=True, export_yup=True,
                    **export_options(settings),
                )
            finally:
                for ob, basis in saved.items():
                    ob.matrix_basis = basis
                for ob in parts:
                    ob.select_set(False)
                for ob in prev_selected:
                    ob.select_set(True)
                view_layer.objects.active = prev_active
                view_layer.update()
        view_layer.update()
    if "FINISHED" not in result or not os.path.isfile(path):
        raise EntityError(f"{root.name}: glTF export failed")


def export_splat(context, root, path):
    """Export a splat's points to .ply in entity-local space (the file's own axes)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with suspended(), context.temp_override(active_object=root, object=root):
        result = bpy.ops.gsplat.export_ply(filepath=path, apply_transform=False)
    if "FINISHED" not in result or not os.path.isfile(path):
        raise EntityError(f"{root.name}: splat export failed")


class PushItem:
    def __init__(self, root, path, entity, export_path, signature, matrix, offset):
        self.root = root
        self.path = path
        self.entity = entity
        self.export_path = export_path
        self.signature = signature
        self.matrix = matrix  # the entity's pushed placement
        self.offset = offset  # the model offset the export bakes in
        self.url = None  # where the export was uploaded


def pending_roots(scene, space_id, ws):
    """Entities moved, renamed or moved to another folder since the last pull/push. New and
    stretched entities aren't listed: they need a full Push, which uploads their model."""
    return [r for r in entity_roots(scene, space_id)
            if not r.arrival.read_only and not is_new(r, ws) and not stretched(r) and any(root_changes(r, ws))]


def prepare_push(context, space_id, ws, export_dir, include_models):
    """Collect entities whose transform, name, folder (or model, if include_models) changed and
    export the edited models. Nothing is written yet: the caller uploads the exports, then calls
    write()."""
    roots = entity_roots(context.scene, space_id)
    by_id = {}
    for r in roots:
        by_id.setdefault(r.arrival.entity_id, []).append(r)
    # A duplicated object carries its entity along. The first by name ("Chair", not "Chair.001")
    # keeps it; copies of a model become new entities, copies of anything else can't be pushed.
    dups = []
    for copies in by_id.values():
        for r in sorted(copies, key=lambda o: o.name)[1:]:
            if r.arrival.kind == "GLB" and not r.arrival.read_only:
                make_entity(r, space_id)
            else:
                dups.append(r.name)
    if dups:
        raise EntityError("Copies of images, plugins, splats, spawn points and placeholders can't be pushed. "
                          "Delete: " + ", ".join(sorted(dups)))

    if include_models:
        for ob in context.view_layer.objects:
            if ob is not None and ob.mode == "EDIT":
                ob.update_from_editmode()

    items, errors = [], []
    for root in roots:
        a = root.arrival
        if a.read_only:
            continue
        path = os.path.join(ws, a.file)
        new = not os.path.isfile(path)
        stretch = stretched(root)
        if (new or stretch) and not include_models:
            continue  # a Live push; the next Push creates or re-uploads it
        if new and not any(o.type in MODEL_TYPES for o in (root, *root.children_recursive)):
            errors.append(f"{root.name}: a new entity needs a mesh. Add a part to it, or delete it")
            continue
        editable = is_editable(root)
        signature = content_signature(root) if include_models and editable else a.signature
        model_changed = new or stretch or (include_models and editable and (a.model_edited or signature != a.signature))
        matrix, offset = unstretch(root) if stretch else (entity_matrix(root), model_offset(root))
        moved, renamed, refiled = root_changes(root, ws)
        moved = moved or stretch
        if not (moved or renamed or refiled or model_changed):
            continue
        try:
            entity = _new_entity_json(a.entity_id) if new else read_json(path)
            data = entity["data"]
            write_transform(data, matrix, root.name, spawn=a.kind == "SPAWN")
        except EntityError as e:
            errors.append(str(e))
            continue
        except (OSError, ValueError, KeyError, TypeError) as e:
            errors.append(f"{root.name}: can't read {a.file} ({e})")
            continue
        if renamed or new:
            data["displayName"] = _base_name(root.name)  # what the Content panel's Rename saves
        if refiled or new:
            folder = entity_folder(root)
            if folder:
                data["folderId"] = folder
            else:
                data.pop("folderId", None)
        ext = ".ply" if a.kind == "SPLAT" else ".glb"
        export_path = os.path.join(export_dir, _slug(a.entity_id), _slug(root.name) + ext) if model_changed else None
        items.append(PushItem(root, path, entity, export_path, signature, matrix, offset))
    if errors:
        raise EntityError("\n".join(errors))

    for item in items:
        if item.export_path:
            # Cleared before exporting so an edit made during the upload marks the model again.
            item.root.arrival.model_edited = False
            try:
                if item.root.arrival.kind == "SPLAT":
                    export_splat(context, item.root, item.export_path)
                else:
                    export_glb(context, item.root, item.export_path, item.offset, context.scene.arrival.export)
                item.root.arrival.export_size = os.path.getsize(item.export_path)
            except Exception:
                item.root.arrival.model_edited = True
                raise
    return items


def set_model_url(entity, url):
    data = entity["data"]
    name = panel_name(entity)
    data["glbUrl"] = url
    # Unnamed entities are listed by file name; keep the name the panel showed.
    if panel_name(entity) != name:
        data["displayName"] = name
    # These described the previous file: its uncompressed original (.opt.glb), or the source and
    # state of a splat's LOD build.
    for key in ("usdSourceFile", "lodParameter", "fileBeforeLOD", "isSOGed"):
        data.pop(key, None)


def write(items):
    for item in items:
        write_json(item.path, item.entity)


def mark_pushed(items):
    for item in items:
        try:
            # The pushed matrix, not the file's: write_transform leaves sub-epsilon moves unwritten.
            set_synced(item.root, _state(item.entity, item.matrix))
            if item.export_path:
                a = item.root.arrival
                a.signature = item.signature
                a.source_url = item.url or ""
                if not a.raw_axes:
                    a.model_offset = item.offset
                if a.kind == "IMAGE":
                    a.kind = "GLB"  # its entity now holds the uploaded model
        except ReferenceError:  # deleted while the push ran
            pass


def mark_failed(items):
    for item in items:
        try:
            if item.export_path:
                item.root.arrival.model_edited = True
        except ReferenceError:
            pass
