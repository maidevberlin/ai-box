#!/usr/bin/env python3
"""A small local web page to watch runs and start new ones.

Start it with  ./viewer.py  and open http://127.0.0.1:8765

  GET  /               the page (viewer.html)
  GET  /worlds/<name>.js   how one world is drawn (see worlds/)
  GET  /api/runs       the runs, newest first, and the worlds and models a new run can use
  GET  /api/runs/<id>  one run as a timeline (see story.py)
  POST /api/runs       start a new run: world, model, what agents know and are told, and when it ends
  POST /api/runs/<id>/stop   end a run that is still going
  POST /api/runs/<id>/delete delete a run that has ended, for good
  GET  /api/export?ids=<id>,<id>   finished runs as a zip file (all of them without ids; see dataset.py)
  POST /api/import     the runs in a zip file (the body) are added
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import behaviours
import dataset
import story
import worlds

HERE = os.path.dirname(os.path.abspath(__file__))
# The port is shared by every user of the computer: a second user's viewer cannot use one that
# is taken, and would otherwise end up looking at the first user's runs. PORT=8766 picks another.
PORT = int(os.environ.get("PORT") or 8765)
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}  # the only names this page is served under
RUN_ID = re.compile(r"^[0-9]{8}-[0-9]{6}$")
DRAWING = re.compile(r"^/worlds/([a-z0-9_]+)\.js$")
ASSET = re.compile(r"^/worlds/assets/([a-z0-9_-]+\.(glb|png|jpg))$")
MODELS = ["opus", "fable", "sonnet", "haiku"]  # offered in the page; the first is the default


def last(ids, name, otherwise):
    """A text of the newest run that has it, to suggest it for the next run."""
    for run_id in ids:
        text = story.read(os.path.join(story.RUNS, run_id), name)
        if text is not None:
            return text
    return otherwise


class Handler(BaseHTTPRequestHandler):
    def send(self, body, content_type="application/json", status=200, keep=False):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if keep:  # (a model or picture: the browser may keep it for a day instead of loading it again)
            self.send_header("Cache-Control", "max-age=86400")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host") not in HOSTS:
            return self.send({"error": "not allowed"}, status=403)
        if self.path == "/":
            with open(os.path.join(HERE, "viewer.html"), "rb") as f:
                return self.send(f.read(), "text/html; charset=utf-8")
        asset = ASSET.match(self.path)   # a model or picture a drawing uses (worlds/assets/)
        if asset and os.path.isfile(os.path.join(HERE, "worlds", "assets", asset[1])):
            with open(os.path.join(HERE, "worlds", "assets", asset[1]), "rb") as f:
                kind = {"glb": "model/gltf-binary", "png": "image/png", "jpg": "image/jpeg"}.get(asset[2], "application/octet-stream")
                return self.send(f.read(), kind, keep=True)
        drawing = DRAWING.match(self.path)
        if drawing and os.path.exists(os.path.join(HERE, "worlds", drawing[1] + ".js")):
            with open(os.path.join(HERE, "worlds", drawing[1] + ".js"), "rb") as f:
                return self.send(f.read(), "text/javascript; charset=utf-8")
        if self.path == "/api/runs":
            os.makedirs(story.RUNS, exist_ok=True)
            ids = sorted(filter(RUN_ID.match, os.listdir(story.RUNS)), reverse=True)
            return self.send({
                "worlds": [worlds.describe(name) for name in worlds.names()],
                "behaviours": behaviours.described(),
                "judged": behaviours.judged(),
                "models": MODELS, "prompt": last(ids, "prompt.txt", ""),
                "system": last(ids, "system.txt", story.SYSTEM), "runs": [
                {"id": i, "review": story.review(os.path.join(story.RUNS, i)),
                 "world": story.world(os.path.join(story.RUNS, i)),
                 "model": story.model(os.path.join(story.RUNS, i)),
                 "seconds": story.seconds(os.path.join(story.RUNS, i)),
                 "actions": story.actions(os.path.join(story.RUNS, i)),
                 "imported": os.path.exists(os.path.join(story.RUNS, i, "imported")),
                 "done": os.path.exists(os.path.join(story.RUNS, i, "done"))} for i in ids]})
        if self.path.startswith("/api/export"):
            ids = re.findall(r"[0-9]{8}-[0-9]{6}", self.path.partition("?")[2])
            data = dataset.export(ids)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="ai-box-runs-{time.strftime("%Y%m%d-%H%M")}.zip"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        # /api/runs/<id>?from=N sends only the steps from N on: a live run is read again every
        # second, and sending all of it each time was much more than the page needed.
        run_id, _, query = self.path.removeprefix("/api/runs/").partition("?")
        if RUN_ID.match(run_id) and os.path.isdir(os.path.join(story.RUNS, run_id)):
            told = story.load(os.path.join(story.RUNS, run_id))
            first = int(query.removeprefix("from=")) if query.startswith("from=") and query[5:].isdigit() else 0
            first = min(first, len(told["steps"]))
            return self.send({**told, "from": first, "steps": told["steps"][first:]})
        self.send({"error": "not found"}, status=404)

    def do_POST(self):
        # Only this page may start or end runs, not some other website open in the browser.
        origin = self.headers.get("Origin", "").removeprefix("http://")
        if origin not in HOSTS or self.headers.get("Host") not in HOSTS:
            return self.send({"error": "not allowed"}, status=403)
        if self.path == "/api/import":
            size = int(self.headers.get("Content-Length") or 0)
            if not 0 < size <= dataset.LIMIT:
                return self.send({"error": "This file is empty or too big."}, status=400)
            try:
                return self.send(dataset.import_(self.rfile.read(size), urllib.parse.unquote(self.headers.get("X-File-Name", "a zip file"))[:200]))
            except ValueError as e:
                return self.send({"error": str(e)}, status=400)
        try:
            wish = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or "{}")
            text = lambda key: str(wish.get(key) or "").strip()[:4000]
            minutes = max(0, min(float(wish.get("minutes") or 0), 24 * 60))  # 0: no time limit
            agents = max(0, min(int(wish.get("agents") or 0), 1000))         # 0: run.py's own limit
        except (ValueError, AttributeError, TypeError):
            return self.send({"error": "bad request"}, status=400)
        if self.path == "/api/runs":
            return self.start(wish, text, minutes, agents)
        run_id, _, action = self.path.removeprefix("/api/runs/").partition("/")
        run = os.path.join(story.RUNS, run_id)
        if action == "resume":
            return self.resume(run_id, run, minutes, agents)
        if action == "delete":
            if not RUN_ID.match(run_id) or not os.path.isdir(run):
                return self.send({"error": "no such run"}, status=404)
            if not os.path.exists(os.path.join(run, "done")):
                return self.send({"error": "End the run first."}, status=409)
            shutil.rmtree(run)
            return self.send({"ok": action})
        # Only a run that is still going: the number in an old pid file may belong to another program by now.
        if (action != "stop" or not RUN_ID.match(run_id) or not os.path.isdir(run)
                or os.path.exists(os.path.join(run, "done"))):
            return self.send({"error": "not running"}, status=409)
        try:
            with open(os.path.join(run, "pid")) as f:
                os.kill(int(f.read()), signal.SIGTERM)  # ends run.py, and with it the agent and its world
            open(os.path.join(run, "stopped"), "w").close()  # record that a person ended this run
        except (OSError, ValueError):
            return self.send({"error": "not running"}, status=409)
        self.send({"ok": action})

    def start(self, wish, text, minutes, agents):
        """A new world: which one, which model lives in it, what every agent knows and is told,
        and when the world ends."""
        model, world = wish.get("model"), wish.get("world")
        env = {**os.environ, "MODEL": model if model in MODELS else MODELS[0],
               "WORLD": world if world in worlds.names() else "island",
               "SYSTEM": text("system"), "MINUTES": str(minutes)}
        if text("prompt"):  # without one, run.py uses its own
            env["PROMPT"] = text("prompt")
        if agents:
            env["AGENTS"] = str(agents)
        try:  # how many agents live side by side
            env["TOGETHER"] = str(max(1, min(int(wish.get("together") or 1), 4)))
        except (ValueError, TypeError):
            env["TOGETHER"] = "1"
        try:  # friends can be called, up to this many agents alive (0: no calling)
            env["ROOM"] = str(max(0, min(int(wish.get("room") or 0), 4)))
        except (ValueError, TypeError):
            env["ROOM"] = "0"
        if wish.get("keep"):  # agents keep their memory when they wake up again
            env["MEMORY"] = "keep"
        else:
            env.pop("MEMORY", None)
        if text("note"):  # a note that lies in the world from the start
            env["WORLD_NOTE"] = text("note")
        else:
            env.pop("WORLD_NOTE", None)
        run_id = time.strftime("%Y%m%d-%H%M%S")
        try:
            os.makedirs(os.path.join(story.RUNS, run_id))
        except FileExistsError:  # a second click within the same second
            return self.send({"error": "a run just started"}, status=409)
        subprocess.Popen(
            [os.path.join(HERE, "run.py")], env={**env, "RUN_ID": run_id},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.send({"id": run_id})

    def resume(self, run_id, run, minutes, agents):
        """A world that has ended goes on, as it was left, for some more time or agents."""
        if not (RUN_ID.match(run_id) and os.path.exists(os.path.join(run, "done"))
                and os.path.exists(os.path.join(run, "world.pickle"))):
            return self.send({"error": "not a world that has ended"}, status=409)
        os.remove(os.path.join(run, "done"))  # at once, so that a second click does not start it twice
        env = {**os.environ, "RESUME": "1", "RUN_ID": run_id, "MINUTES": str(minutes)}
        if agents:
            env["AGENTS"] = str(agents)
        subprocess.Popen([os.path.join(HERE, "run.py")], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.send({"id": run_id})

    def log_message(self, *args):  # keep the terminal quiet
        pass


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is already in use, maybe by another viewer (another user's, too).\n"
                 f"What http://127.0.0.1:{PORT} shows is then not this viewer's runs.\n"
                 f"Start this one on another port, for example:  PORT={PORT + 1} ./viewer.py")
    print(f"Viewer: http://127.0.0.1:{PORT}   (Ctrl+C to stop)")
    server.serve_forever()
