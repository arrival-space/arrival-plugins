# Arrival.Space CLI (`arrival`)

Manage your Arrival.Space spaces as **local files** — pull a space into a git-friendly
workspace, edit it with your own tools, and push it back. It talks to the same
materialize / validate / sync-back pipeline the in-app space agent uses, minus the AI.

> Replaces the old `arrival-cli` browser REPL. That was a live-debug bridge; this is the
> space-as-code tool people expected. (A live hot-reload `arrival dev` mode is planned.)

## Install

```bash
cd tools/arrival-cli
npm install
npm link          # optional: puts `arrival` on your PATH
```

## Usage

```bash
arrival login                    # sign in with your browser (OAuth); token saved to ~/.arrival/config.json
arrival spaces                   # list your spaces
arrival create "Photo wall"      # create a new space; prints its id
arrival pull 45637586_1234       # download into ./45637586_1234/
cd 45637586_1234
#   edit files under space/ (room.json, entities/*.json, plugins/*.mjs, assets/*) with any editor + git
arrival validate                 # server-side dry-run — catch problems before applying
arrival push                     # apply to the live space
```

### Starting from scratch

`arrival create` mints a space server-side (the id is `<userId>_<4 digits>`) and `--pull` checks it
out in the same step, so a new space is one command away from being editable files:

```bash
arrival create "Photo wall" --privacy Open --pull
cd 45637586_1234
```

Options: `--description <text>`, `--privacy Open|Closed` (default `Closed`), `--type infinite|hub`
(default `infinite`), `--pull` (+ `--dir <path>` to choose where). Without `--pull` it just prints
the id for a follow-up `arrival pull`.

## Workspace layout

```
<spaceId>/
  space/
    room.json              # the RoomInfo entity (space title / privacy / …)
    entities/*.json        # one file per entity
    plugins/<name>.mjs      # flat plugin, or plugins/<name>/ for a multi-file plugin
    assets/<name>          # images / models referenced as the token "assets/<name>"
    README.md              # a generated map of the space
  .arrival/manifest.json   # the pull baseline (do not edit) — how push knows what changed
```

`git init` inside the workspace and you get version control for free.

## Notes / current limits (phase 1)

- **Deletions are confirmed.** If a file is missing on push, `arrival` refuses to delete the
  matching entity unless you pass `--force` (so a half-written workspace can't wipe a space).
- **Last-writer-wins.** If the live space changed since you pulled, `push` currently overwrites
  those changes. Conflict detection (`status` / 3-way) is coming next.
- **Assets** ≤ 25 MB each; binary files inside a multi-file plugin directory don't round-trip yet.
- `arrival push` takes a server-side snapshot first, so a bad push is undoable in-app.
