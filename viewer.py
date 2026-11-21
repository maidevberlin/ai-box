#!/usr/bin/env python3
"""A small local web page to watch runs and start new ones.

Start it with  ./viewer.py  and open http://127.0.0.1:8765

  GET  /               the page (viewer.html)
  GET  /api/runs       list of runs (id and review), newest first
  GET  /api/runs/<id>  one run as a timeline (see story.py)
  POST /api/runs       start a new run with the model named in the request, returns its id
  POST /api/runs/<id>/stop   stop the agent of a run that is still going
"""
import json
import os
import re
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import story

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8765
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}  # the only names this page is served under
RUN_ID = re.compile(r"^[0-9]{8}-[0-9]{6}$")
MODELS = ["opus", "fable", "sonnet", "haiku"]  # offered in the page; the first is the default


class Handler(BaseHTTPRequestHandler):
    def send(self, body, content_type="application/json", status=200):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host") not in HOSTS:
            return self.send({"error": "not allowed"}, status=403)
        if self.path == "/":
            with open(os.path.join(HERE, "viewer.html"), "rb") as f:
                return self.send(f.read(), "text/html; charset=utf-8")
        if self.path == "/api/runs":
            os.makedirs(story.RUNS, exist_ok=True)
            ids = sorted(filter(RUN_ID.match, os.listdir(story.RUNS)), reverse=True)
            return self.send({"models": MODELS, "runs": [
                {"id": i, "review": story.review(os.path.join(story.RUNS, i)),
                 "model": story.model(os.path.join(story.RUNS, i))} for i in ids]})
        run_id = self.path.removeprefix("/api/runs/")
        if RUN_ID.match(run_id) and os.path.isdir(os.path.join(story.RUNS, run_id)):
            return self.send(story.load(os.path.join(story.RUNS, run_id)))
        self.send({"error": "not found"}, status=404)

    def do_POST(self):
        # Only this page may start runs, not some other website open in the browser.
        origin = self.headers.get("Origin", "").removeprefix("http://")
        if origin not in HOSTS or self.headers.get("Host") not in HOSTS:
            return self.send({"error": "not allowed"}, status=403)
        if self.path.endswith("/stop"):
            return self.stop(self.path.removeprefix("/api/runs/").removesuffix("/stop"))
        if self.path != "/api/runs":
            return self.send({"error": "not found"}, status=404)
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        model = body if body in MODELS else MODELS[0]
        run_id = time.strftime("%Y%m%d-%H%M%S")
        try:
            os.makedirs(os.path.join(story.RUNS, run_id))
        except FileExistsError:  # a second click within the same second
            return self.send({"error": "a run just started"}, status=409)
        subprocess.Popen(
            [os.path.join(HERE, "run.sh")], env={**os.environ, "RUN_ID": run_id, "MODEL": model},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.send({"id": run_id})

    def stop(self, run_id):
        run = os.path.join(story.RUNS, run_id)
        # Only a run that is still going: the number in an old pid file may belong to another program by now.
        if not RUN_ID.match(run_id) or os.path.exists(os.path.join(run, "done")):
            return self.send({"error": "not running"}, status=409)
        try:
            with open(os.path.join(run, "pid")) as f:
                os.kill(int(f.read()), signal.SIGTERM)  # ends the agent; its world ends with it
            open(os.path.join(run, "stopped"), "w").close()  # record that a person ended this run
        except (OSError, ValueError):
            return self.send({"error": "not running"}, status=409)
        self.send({"stopped": run_id})

    def log_message(self, *args):  # keep the terminal quiet
        pass


if __name__ == "__main__":
    print(f"Viewer: http://127.0.0.1:{PORT}   (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
