# Tile images for the pickers. Spaces: the same square thumbnails as the client's space grid, i.e.
# the space's <room>_SEO.jpeg resized by the UGC transform service. Avatars: the image the avatar
# service renders next to the GLB (the url `arrival avatar list` gives). Keyed by a string: the
# space id, or "avatar:<id>".

import os
import urllib.parse

import bpy
import bpy.utils.previews

from . import space

TRANSFORM_URL = "https://ugc-transform.arrival.space"
SIZE = 256

_previews = None
_paths = {}  # key -> local image file ("" when there is none)


def url(space_id, version):
    owner = space_id.split("_")[0]
    query = urllib.parse.urlencode({"v": version or "", "width": SIZE, "height": SIZE, "format": "jpeg"})
    return f"{TRANSFORM_URL}/{owner}/custom.travel.center.{space_id}_SEO.jpeg?{query}"


def fetch_urls(task, urls, cache_dir, label="Loading images"):
    """Task body: {key: path} for {key: image url}. Images that fail to download are left out."""
    results = space.download_all(task, sorted(set(urls.values())), cache_dir, label=label)
    return {key: results[u] for key, u in urls.items() if isinstance(results.get(u), str)}


def fetch(task, spaces, cache_dir):
    """Task body: {space_id: path} for [(space_id, changeDate)]. Spaces without a screenshot are
    left out (the service answers 500 for those)."""
    return fetch_urls(task, {sid: url(sid, version) for sid, version in spaces}, cache_dir, "Loading space images")


def load(paths):
    for sid, path in paths.items():
        if path not in _previews:
            # Reading image_size loads the preview now instead of on first draw.
            _previews.load(path, path, "IMAGE").image_size[:]
        _paths[sid] = path


def cache_dir():
    from .props import workspaces_dir
    return os.path.join(workspaces_dir(bpy.context), ".cache", "thumbs")


def icon_for(key, image_url):
    """The tile's icon. A tile the list shows without its image having been loaded this session
    (after Reload Scripts or re-enabling the add-on, or with a list kept in a reopened file) gets
    the copy downloaded before, if there is one."""
    path = _paths.get(key)
    if path is None:
        _paths[key] = path = ""  # checked once; a refresh (load) sets it anew
        cached = space._cache_path(cache_dir(), image_url) if image_url else ""
        if cached and os.path.isfile(cached) and os.path.getsize(cached) > 0:
            try:
                load({key: cached})
                path = cached
            except (RuntimeError, KeyError) as e:
                print(f"[arrival] image {key}: {e}")
    return _previews[path].icon_id if path in _previews else 0


def icon_id(space_id, version):
    return icon_for(space_id, url(space_id, version))


def register():
    global _previews
    _previews = bpy.utils.previews.new()


def unregister():
    bpy.utils.previews.remove(_previews)
    _paths.clear()
