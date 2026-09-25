# Space tile images: the same square thumbnails as the client's space grid, i.e. the space's
# <room>_SEO.jpeg resized by the UGC transform service.

import os
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


def cache_dir():
    from .props import workspaces_dir
    return os.path.join(workspaces_dir(bpy.context), ".cache", "thumbs")


def icon_id(space_id, version):
    """The tile's icon. A space the list shows without its image having been loaded this session
    (after Reload Scripts or re-enabling the add-on, or with a list kept in a reopened file) gets
    the copy downloaded before, if there is one."""
    path = _paths.get(space_id)
    if path is None:
        cached = space._cache_path(cache_dir(), url(space_id, version))
        _paths[space_id] = path = ""  # checked once; a refresh (load) sets it anew
        if os.path.isfile(cached) and os.path.getsize(cached) > 0:
            try:
                load({space_id: cached})
                path = cached
            except (RuntimeError, KeyError) as e:
                print(f"[arrival] space image {space_id}: {e}")
    return _previews[path].icon_id if path in _previews else 0


def register():
    global _previews
    _previews = bpy.utils.previews.new()


def unregister():
    bpy.utils.previews.remove(_previews)
    _paths.clear()
