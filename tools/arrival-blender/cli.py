# Runs the `arrival` CLI (tools/arrival-cli) as a subprocess and background work in threads.
#
# Blender started from the Dock/Finder gets a bare PATH (/usr/bin:/bin:...), so `node` and an
# `npm link`ed `arrival` are usually invisible to it. We prepend the usual Node install dirs.

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading

CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".arrival", "config.json")


class CliError(Exception):
    pass


def _extra_path_dirs():
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return [os.path.join(os.environ.get("APPDATA", ""), "npm"), r"C:\Program Files\nodejs"]
    nvm = sorted(glob.glob(os.path.join(home, ".nvm", "versions", "node", "*", "bin")), reverse=True)
    return nvm + [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        os.path.join(home, ".volta", "bin"),
        os.path.join(home, ".local", "bin"),
    ]


def _env():
    env = os.environ.copy()
    extra = [d for d in _extra_path_dirs() if os.path.isdir(d)]
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env


def resolve_command(cli_path):
    """argv prefix for the CLI. cli_path may be the `arrival` executable, the CLI's index.js,
    or its folder; empty means the arrival-cli next to this add-on in the repo, else `arrival`
    on PATH."""
    env = _env()
    p = os.path.expanduser((cli_path or "").strip())
    if not p:
        # realpath: the add-on is usually symlinked into Blender's extensions folder.
        sibling = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "arrival-cli")
        exe = shutil.which("arrival", path=env["PATH"])
        if os.path.isfile(os.path.join(sibling, "index.js")):
            p = sibling
        elif exe:
            return [exe]
        else:
            raise CliError("Arrival CLI not found. Set its path in the add-on preferences "
                           "(the arrival-cli folder or `arrival` executable).")
    if os.path.isdir(p):
        p = os.path.join(p, "index.js")
    if not os.path.exists(p):
        raise CliError(f"Arrival CLI not found at {p}")
    if p.endswith(".js"):
        if not os.path.isdir(os.path.join(os.path.dirname(p), "node_modules")):
            raise CliError(f"The Arrival CLI isn't installed yet. Run `npm install` in {os.path.dirname(p)}")
        node = shutil.which("node", path=env["PATH"])
        if not node:
            raise CliError("Node.js not found. Install Node 18+ or point the preferences at the `arrival` executable.")
        return [node, p]
    return [p]


def load_config():
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


class Task:
    """Runs fn(task, *args) on a thread. The operator polls `done` from a modal timer."""

    def __init__(self, fn, *args, label=""):
        self.label = label
        self.result = None
        self.error = None
        self.done = False
        self.progress = ""
        self.proc = None
        self.cancelled = False
        threading.Thread(target=self._run, args=(fn, args), daemon=True).start()

    def _run(self, fn, args):
        try:
            self.result = fn(self, *args)
        except BaseException as e:  # surfaced to the operator on the main thread
            self.error = e
        finally:
            self.done = True

    @property
    def cancellable(self):
        return self.proc is not None

    def cancel(self):
        self.cancelled = True
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


def _run_cli(task, argv, check=True):
    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    task.proc = subprocess.Popen(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=_env(), text=True, encoding="utf-8", errors="replace", **kwargs,
    )
    out, err = task.proc.communicate()
    if task.cancelled:
        raise CliError("Cancelled")
    if not check:
        return task.proc.returncode, out, err
    if task.proc.returncode != 0:
        msg = (err.strip() or out.strip() or f"arrival exited with code {task.proc.returncode}")
        raise CliError(msg.replace("✗ ", ""))
    return out


def run(cli_path, args, label="", check=True):
    """Start `arrival <args>` in the background; the Task's result is its stdout. With check=False
    it's (exit code, stdout, stderr), and a failing exit code isn't an error."""
    return Task(_run_cli, resolve_command(cli_path) + list(args), check, label=label)


_APPLIED = re.compile(r"^  (\S+ \S+) (.+)$")
_FAILED = re.compile(r"^  ! (\S+ \S+) (.+?): (.*)$")


def parse_push(code, out, err):
    """What `arrival push` did, read from its output: {status, applied: [(op, target)],
    failed: [(op, target, error)]}. status is "nothing" (the workspace matches the last pull),
    "noChanges" (the server had nothing to do; the CLI keeps its baseline then), "ok" or "partial"
    (some writes failed; the CLI marks them done anyway). Anything else raises CliError."""
    lines = out.splitlines()
    head = next((l for l in lines if l.startswith("✓")), "")
    if head.startswith("✓ Pushed"):
        applied, failed = [], []
        for line in lines:
            m = _FAILED.match(line)
            if m:
                failed.append((m.group(1), m.group(2), m.group(3)))
                continue
            m = _APPLIED.match(line)
            if m:
                applied.append((m.group(1), m.group(2)))
        partial = "(some writes failed)" in head or bool(failed)
        return {"status": "partial" if partial else "ok", "applied": applied, "failed": failed}
    if code == 0 and head.startswith("✓ Nothing to push —"):
        return {"status": "nothing", "applied": [], "failed": []}
    if code == 0 and head.startswith("✓ Nothing to push"):
        return {"status": "noChanges", "applied": [], "failed": []}
    msg = err.strip() or out.strip() or f"arrival exited with code {code}"
    raise CliError(msg.replace("✗ ", ""))


def parse_json_output(out):
    # The JSON is the last stdout line; anything before it is incidental logging.
    lines = [l for l in out.strip().splitlines() if l.strip()]
    if not lines:
        raise CliError("The CLI printed nothing")
    try:
        return json.loads(lines[-1])
    except ValueError:
        raise CliError("Unexpected CLI output (update tools/arrival-cli for --json support):\n" + out.strip())
