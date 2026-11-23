#!/usr/bin/env python3
"""Runs as one zip file, to share them or to bring them to another computer.

    ./dataset.py export [run ids ...] [-o file.zip]   all finished runs, or the ones named
    ./dataset.py import file.zip                       adds the runs in it to runs/

The viewer does the same with its buttons "Export" and "Import".

A zip holds manifest.json (what is in it) and one folder per run, named by the run's id,
with the files needed to watch and compare it (FILES). Left out on purpose:
- world.pickle, the world a run can go on in: loading a pickle someone else made can run
  any code on this computer. An imported run can be watched, but not continued.
- mcp.*.json, how the agent reached its world: only needed while a run goes, and full of
  paths of this computer.
The home folder's path is replaced by "~" in every file, so it does not travel along.
"""
import io
import json
import os
import re
import sys
import tempfile
import time
import zipfile

import story

FORMAT = "ai-box runs"
VERSION = 1
RUN_ID = re.compile(r"^[0-9]{8}-[0-9]{6}$")
FILES = {"protocol.jsonl", "transcript.jsonl", "review.json", "prompt.txt", "system.txt",
         "limits.json", "calls.jsonl", "errors.txt", "done", "stopped"}
LIMIT = 1_000_000_000   # bytes an imported zip may unpack to at most
HOME = os.path.expanduser("~")


def finished():
    """The ids of all finished runs, oldest first."""
    if not os.path.isdir(story.RUNS):
        return []
    return sorted(i for i in os.listdir(story.RUNS)
                  if RUN_ID.match(i) and os.path.exists(os.path.join(story.RUNS, i, "done")))


def export(ids=None):
    """The runs (all finished ones if none are named) as the bytes of a zip file."""
    done = finished()
    ids = [i for i in (ids or done) if i in done]
    listed = []
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as box:
        for run_id in ids:
            run = os.path.join(story.RUNS, run_id)
            for name in sorted(FILES):
                path = os.path.join(run, name)
                if os.path.isfile(path):
                    with open(path, encoding="utf-8", errors="replace") as f:
                        box.writestr(f"{run_id}/{name}", f.read().replace(HOME, "~"))
            review = story.review(run) or {}
            listed.append({"id": run_id, "world": story.world(run), "model": story.model(run),
                           "name": review.get("name"), "rating": review.get("rating"),
                           "actions": story.actions(run)})
        box.writestr("manifest.json", json.dumps({
            "format": FORMAT, "version": VERSION, "exported": time.strftime("%Y-%m-%d %H:%M"),
            "runs": listed}, indent=2, ensure_ascii=False))
    return data.getvalue()


def import_(data, source="a zip file"):
    """Adds the runs in a zip file (its bytes) to runs/. A run that is here already is left as
    it is. Only the files in FILES are taken, nothing else. Returns {"added": [...], "skipped": [...]}."""
    try:
        box = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("This is not a zip file.")
    with box:
        try:
            manifest = json.loads(box.read("manifest.json"))
        except (KeyError, ValueError):
            raise ValueError("This zip file holds no runs of AI Box (it has no manifest.json).")
        if manifest.get("format") != FORMAT:
            raise ValueError("This zip file holds no runs of AI Box.")
        if manifest.get("version", 0) > VERSION:
            raise ValueError("These runs were exported by a newer AI Box. Update this one first.")
        wanted = {}   # run id -> [the zip's entries for it]
        for entry in box.infolist():
            run_id, _, name = entry.filename.partition("/")
            if RUN_ID.match(run_id) and name in FILES and not entry.is_dir():
                wanted.setdefault(run_id, []).append(entry)
        if sum(entry.file_size for entries in wanted.values() for entry in entries) > LIMIT:
            raise ValueError("This zip file is too big.")
        added, skipped = [], []
        os.makedirs(story.RUNS, exist_ok=True)
        for run_id, entries in sorted(wanted.items()):
            target = os.path.join(story.RUNS, run_id)
            if os.path.exists(target) or "protocol.jsonl" not in {e.filename.split("/")[1] for e in entries}:
                skipped.append(run_id)
                continue
            # Unpacked next to the runs first, then moved in at once: never half a run.
            folder = tempfile.mkdtemp(dir=story.RUNS, prefix=".import-")
            for entry in entries:
                with open(os.path.join(folder, entry.filename.split("/")[1]), "wb") as f:
                    f.write(box.read(entry))
            with open(os.path.join(folder, "imported"), "w") as f:
                f.write(f"{source}, {time.strftime('%Y-%m-%d %H:%M')}\n")
            os.rename(folder, target)
            added.append(run_id)
    return {"added": added, "skipped": skipped}


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["export"]:
        out = args[args.index("-o") + 1] if "-o" in args else f"ai-box-runs-{time.strftime('%Y%m%d-%H%M')}.zip"
        ids = [a for a in args[1:] if RUN_ID.match(a)]
        with open(out, "wb") as f:
            f.write(export(ids))
        print(f"Wrote {out}")
    elif args[:1] == ["import"] and len(args) == 2:
        with open(args[1], "rb") as f:
            try:
                result = import_(f.read(), os.path.basename(args[1]))
            except ValueError as e:
                sys.exit(str(e))
        print(f"Added {len(result['added'])} runs" + (f", {len(result['skipped'])} were here already" if result["skipped"] else "") + ".")
    else:
        sys.exit(__doc__)
