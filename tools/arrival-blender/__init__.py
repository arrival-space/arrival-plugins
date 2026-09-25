# Arrival.Space for Blender: sign in, pick a space, edit it here, push it back.
#
# All server traffic goes through the `arrival` CLI (tools/arrival-cli): the add-on pulls a space
# into a CLI workspace, maps its entities to objects (space.py), and on push writes the changed
# entity files, uploads re-exported models with `arrival upload` and runs `arrival push`, which
# also refreshes any browser that has the space open. Spaces that show the app's default hub get
# it as read-only reference geometry (hub.py).

if "ops" in locals():
    # Reload Scripts (F3) re-runs only this file. Re-import the submodules too, or Blender keeps
    # running their old code. Order: a module before those that `from .x import` names out of it.
    import importlib
    import sys

    for _name in ("cli", "spawn", "sky", "hub", "space", "thumbs", "props", "ops", "ui"):
        _module = sys.modules.get(f"{__package__}.{_name}")
        if _module is not None:
            importlib.reload(_module)

from . import ops, props, thumbs, ui

_modules = (props, thumbs, ops, ui)


def register():
    for m in _modules:
        m.register()


def unregister():
    for m in reversed(_modules):
        m.unregister()
