# Space tile images: the same square thumbnails as the client's space grid, i.e. the space's
# <room>_SEO.jpeg resized by the UGC transform service.

import urllib.parse

import bpy
import bpy.utils.previews

from . import space

TRANSFORM_URL = "https://ugc-transform.arrival.space"
SIZE = 256

_previews = None
_paths = {}  # space id -> local image file


def url(space_id, version):
    owner = space_id.split("_")[0]
    query = urllib.parse.urlencode({"v": version or "", "width": SIZE, "height": SIZE, "format": "jpeg"})
    return f"{TRANSFORM_URL}/{owner}/custom.travel.center.{space_id}_SEO.jpeg?{query}"


def fetch(task, spaces, cache_dir):
    """Task body: {space_id: path} for [(space_id, changeDate)]. Spaces without a screenshot are
    left out (the service answers 500 for those)."""
    urls = {sid: url(sid, version) for sid, version in spaces}
    results = space.download_all(task, sorted(set(urls.values())), cache_dir, label="Loading space images")
    return {sid: results[u] for sid, u in urls.items() if isinstance(results.get(u), str)}


def load(paths):
    for sid, path in paths.items():
        if path not in _previews:
            # Reading image_size loads the preview now instead of on first draw.
            _previews.load(path, path, "IMAGE").image_size[:]
        _paths[sid] = path


def icon_id(space_id):
    path = _paths.get(space_id)
    return _previews[path].icon_id if path in _previews else 0


def register():
    global _previews
    _previews = bpy.utils.previews.new()


def unregister():
    bpy.utils.previews.remove(_previews)
    _paths.clear()
