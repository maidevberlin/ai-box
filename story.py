#!/usr/bin/env python3
"""Turns the files of one run into a single timeline of steps.

A step is the prompt, something the agent thought, said or did, or a stop by hand.
Every step carries the world state after it, so the viewer can draw any step alone.

Run it directly to print a run as text:  ./story.py [runs/<id>]   (default: latest)
"""
import json
import os
import sys
import time

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


def review(run):
    """The name, summary and rating that review.py gave this run, if it has been reviewed."""
    path = os.path.join(run, "review.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)


def model(run):
    """Which model the agent was, as Claude Code reported it at the start of the run."""
    path = os.path.join(run, "transcript.jsonl")
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"subtype":"init"' in line:
                    return json.loads(line).get("model", "").removeprefix("claude-")
                break  # it is always the first line


def load(run):
    protocol = read_jsonl(os.path.join(run, "protocol.jsonl"))
    start = protocol[0] if protocol and protocol[0]["tool"] == "start" else None
    actions = protocol[1:]
    story = {
        "id": os.path.basename(run),
        "size": start["size"] if start else None,
        "view": start["view"] if start else None,
        # which way y runs: -1 = north is smaller y. Runs from before that fix have +1.
        "north": start.get("north", 1) if start else None,
        "review": review(run),
        "model": model(run),
        "done": os.path.exists(os.path.join(run, "done")),
        "steps": [],
    }
    if not start:  # the world has not started yet
        return story

    def state(entry):
        return {key: entry.get(key) for key in ("time", "pos", "carrying", "stones")}

    now = state(start)
    prompt_file = os.path.join(run, "prompt.txt")
    prompt = open(prompt_file).read().strip() if os.path.exists(prompt_file) else ""
    story["steps"].append({"kind": "prompt", "text": prompt, **now})

    done_actions = 0
    for event in read_jsonl(os.path.join(run, "transcript.jsonl")):
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
                now = state(action)
                story["steps"].append({"kind": "act", "tool": action["tool"],
                                       "args": action["args"], "result": action["result"], **now})
    return stopped(run, story)


def stopped(run, story):
    """If the run was stopped by hand (the viewer leaves a 'stopped' file), say so as a last step."""
    marker = os.path.join(run, "stopped")
    if os.path.exists(marker):
        at = time.strftime("%H:%M:%S", time.localtime(os.path.getmtime(marker)))
        last = story["steps"][-1] if story["steps"] else {}
        world = {key: last.get(key) for key in ("pos", "carrying", "stones")}
        story["steps"].append({"kind": "stop", "text": f"Stopped by hand at {at}.", **world, "time": at})
    return story


def draw(story, step):
    """The world as text: digits are stones, @ is the agent, north is up."""
    size = story["size"]
    cells = {(x, y): str(min(n, 9)) for x, y, n in step["stones"]}
    cells[tuple(step["pos"])] = "@"
    rows = range(size) if story["north"] < 0 else reversed(range(size))
    return "\n".join("  " + " ".join(cells.get((x, y), ".") for x in range(size)) for y in rows)


def text(story):
    """The whole run as readable text."""
    lines = [f"Run {story['id']}  (agent: {story['model']})", ""]
    for step in story["steps"]:
        if step["kind"] == "act":
            args = ", ".join(f"{k}={v!r}" for k, v in step["args"].items())
            lines.append(f"DOES  {step['tool']}({args})")
            lines.append("      " + step["result"].replace("\n", "\n      ") + "\n")
        else:
            label = {"prompt": "TOLD ", "think": "THINKS", "say": "SAYS ", "stop": "STOP "}[step["kind"]]
            lines.append(f"{label} {step['text']}\n")
    if story["steps"]:
        lines += ["Final world:", draw(story, story["steps"][-1])]
    return "\n".join(lines)


def latest_or(argv):
    """The run folder named on the command line, or the newest one."""
    runs = sorted(os.listdir(RUNS)) if os.path.isdir(RUNS) else []
    if len(argv) < 2 and not runs:
        sys.exit("No runs yet. Start one with ./run.sh")
    return argv[1] if len(argv) > 1 else os.path.join(RUNS, runs[-1])


if __name__ == "__main__":
    print(text(load(latest_or(sys.argv))))
