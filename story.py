#!/usr/bin/env python3
"""Turns the files of one run into a single timeline of steps.

A step is the prompt, something the agent thought, said or did, or the end of the run.
Every step carries the world's state after it, so the viewer can draw any step alone.
This file knows nothing about any particular world: a state is whatever the world recorded.

Run it directly to print a run as text:  ./story.py [runs/<id>]   (default: latest)
"""
import json
import os
import sys
import time

import worlds

RUNS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")


def read_jsonl(path):
    """Read a file of JSON lines. A half-written last line (live run) is skipped."""
    entries = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8", errors="replace"):
            try:
                entries.append(json.loads(line))
            except ValueError:
                pass
    return entries


def first_line(run, name):
    """The first entry of one of a run's files, or nothing if there is none yet."""
    path = os.path.join(run, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            try:
                return json.loads(f.readline())
            except ValueError:
                pass
    return {}


def review(run):
    """The name, summary and rating that review.py gave this run, if it has been reviewed."""
    path = os.path.join(run, "review.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)


def model(run):
    """Which model the agent was, as Claude Code reported it at the start of the run."""
    return first_line(run, "transcript.jsonl").get("model", "").removeprefix("claude-")


def world(run):
    """Which world the run took place in. Runs from before there was a choice were on the island."""
    return first_line(run, "protocol.jsonl").get("world", "island")


# The file "auto" in a run's folder means: repeat the prompt whenever the agent stops.
# With a time limit, it holds the moment the time is up and how many minutes that was.
def auto_text(minutes):
    return f"{time.time() + minutes * 60} {minutes:g}" if minutes else ""


def limit(run):
    """The time limit of a run that repeats its prompt: (when it is up, minutes), if it has one."""
    try:
        with open(os.path.join(run, "auto")) as f:
            until, minutes = f.read().split()
        return float(until), minutes
    except (OSError, ValueError):
        return None


# Runs recorded before worlds became separate files kept the island's facts loose in each entry.
def old_setup(start):
    return {"size": start["size"], "view": start["view"], "north": start.get("north", 1)}


def old_state(entry, start):
    return {"pos": entry["pos"], "carrying": entry["carrying"], "view": entry.get("view", start["view"]),
            "blocks": entry.get("blocks") or entry.get("stones") or []}


def load(run):
    protocol = read_jsonl(os.path.join(run, "protocol.jsonl"))
    start = protocol[0] if protocol and protocol[0]["tool"] == "start" else None
    # Later "start" entries are not actions: the world was picked up again, by a new agent
    # after the one before died.
    actions = [entry for entry in protocol[1:] if entry["tool"] != "start"]
    wakings = [entry for entry in protocol[1:] if entry["tool"] == "start"]
    story = {
        "id": os.path.basename(run),
        "world": start.get("world", "island") if start else None,
        "setup": (start.get("setup") or old_setup(start)) if start else None,
        "review": review(run),
        "model": model(run),
        "done": os.path.exists(os.path.join(run, "done")),
        "waiting": False,  # the agent has stopped and the run waits for a message
        "auto": os.path.exists(os.path.join(run, "auto")),      # the prompt is repeated by itself
        "queued": os.path.exists(os.path.join(run, "inbox")),   # a message waits to be delivered
        # when the run ends by itself, if repeating has a time limit
        "until": time.strftime("%H:%M", time.localtime(limit(run)[0])) if limit(run) else None,
        "steps": [],
    }
    if not start:  # the world has not started yet
        return story

    def after(entry):
        """The moment after a protocol entry: the time and the world's state."""
        return {"time": entry.get("time"), "state": entry.get("state") or old_state(entry, start)}

    now = after(start)
    prompt_file = os.path.join(run, "prompt.txt")
    prompt = open(prompt_file).read().strip() if os.path.exists(prompt_file) else ""
    story["steps"].append({"kind": "prompt", "text": prompt, **now})

    done_actions = 0
    for event in read_jsonl(os.path.join(run, "transcript.jsonl")):
        if event.get("type") == "result":  # the agent stopped
            story["waiting"] = not story["done"]
        elif event.get("type") == "died":  # the agent died; a new one wakes up
            story["waiting"] = False
            story["steps"].append({"kind": "death", "text": "The agent died. A new agent wakes up, knowing nothing.", **now})
            if wakings:  # from here on the world is shown as the new agent finds it
                now = after(wakings.pop(0))
        elif event.get("type") == "told":  # run.py told it something more
            story["waiting"] = False
            story["steps"].append({"kind": "prompt", "text": event["text"], "how": event["how"], **now})
        if event.get("type") != "assistant":
            continue
        for part in event["message"]["content"]:
            if part["type"] == "thinking" and part["thinking"].strip():
                story["steps"].append({"kind": "think", "text": part["thinking"].strip(), **now})
            elif part["type"] == "text" and part["text"].strip():
                story["steps"].append({"kind": "say", "text": part["text"].strip(), **now})
            # Only calls to the world's tools reach the protocol.
            elif part["type"] == "tool_use" and part["name"].startswith("mcp__world__"):
                if done_actions >= len(actions):  # called, but not finished yet (a long wait)
                    story["steps"].append({
                        "kind": "act", "tool": part["name"].removeprefix("mcp__world__"),
                        "args": part["input"], "pending": True, **now,
                        "result": "… stopped" if story["done"] else "… in progress"})
                    return stopped(run, story)
                action = actions[done_actions]
                done_actions += 1
                now = after(action)
                # Extra facts about this action for the viewer, such as the path of a throw.
                detail = action.get("detail") or ({"flight": action["flight"]} if action.get("flight") else {})
                story["steps"].append({"kind": "act", "tool": action["tool"], "args": action["args"],
                                       "result": action["result"], **detail, **now})
    return stopped(run, story)


def stopped(run, story):
    """If the run was ended from outside, say so as a last step.

    The 'stopped' file is left by the viewer (empty: ended by hand) or by the world (with the reason).
    """
    marker = os.path.join(run, "stopped")
    if os.path.exists(marker):
        at = time.strftime("%H:%M:%S", time.localtime(os.path.getmtime(marker)))
        with open(marker) as f:
            why = f.read().strip() or "Ended by hand"
        last = story["steps"][-1] if story["steps"] else {}
        story["steps"].append({"kind": "stop", "text": f"{why} at {at}.", "time": at, "state": last.get("state")})
    return story


def text(story):
    """The whole run as readable text."""
    lines = [f"Run {story['id']}  (world: {story['world']}, agent: {story['model']})", ""]
    for step in story["steps"]:
        if step["kind"] == "act":
            args = ", ".join(f"{k}={v!r}" for k, v in step["args"].items())
            lines.append(f"DOES  {step['tool']}({args})")
            lines.append("      " + step["result"].replace("\n", "\n      ") + "\n")
        else:
            label = {"prompt": "TOLD ", "think": "THINKS", "say": "SAYS ", "stop": "STOP ", "death": "DIES "}[step["kind"]]
            lines.append(f"{label} {step['text']}\n")
    picture = getattr(worlds.load(story["world"]), "picture", None) if story["steps"] else None
    if picture:  # not every world can draw itself as text
        lines += ["Final world:", picture(story["setup"], story["steps"][-1]["state"])]
    return "\n".join(lines)


def latest_or(argv):
    """The run folder named on the command line, or the newest one."""
    runs = sorted(os.listdir(RUNS)) if os.path.isdir(RUNS) else []
    if len(argv) < 2 and not runs:
        sys.exit("No runs yet. Start one with ./run.py")
    return argv[1] if len(argv) > 1 else os.path.join(RUNS, runs[-1])


if __name__ == "__main__":
    print(text(load(latest_or(sys.argv))))
