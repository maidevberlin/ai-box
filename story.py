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
    path = os.path.join(run, "transcript.jsonl")
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            for _, line in zip(range(30), f):  # it is among the first lines
                if '"subtype":"init"' in line:
                    return json.loads(line).get("model", "").removeprefix("claude-")
    return ""


def seconds(run):
    """How long a run went on, or has been going. Its folder name is its start time."""
    began = time.mktime(time.strptime(os.path.basename(run), "%Y%m%d-%H%M%S"))
    done = os.path.join(run, "done")
    return round((os.path.getmtime(done) if os.path.exists(done) else time.time()) - began)


def world(run):
    """Which world the run took place in. Runs from before there was a choice were on the island."""
    return first_line(run, "protocol.jsonl").get("world", "island")


def usage(events):
    """What a run has used so far: tokens, their price, and the subscription limits.

    Claude Code reports totals after every round, per agent process (they add up within one).
    Rounds still going, or cut off by a death, are added from the single messages.
    """
    totals, since, limits = {}, {}, []
    for event in events:
        kind, session = event.get("type"), event.get("session_id")
        if kind == "result":
            totals[session] = event
            since.pop(session, None)
        elif kind == "assistant" and event["message"].get("usage"):
            since.setdefault(session, {})[event["message"].get("id")] = event["message"]["usage"]
        elif kind == "rate_limit_event":
            limits.append(event["rate_limit_info"].get("unifiedWindows") or {})
    tokens = dict.fromkeys(("fresh", "cached", "stored", "output"), 0)  # input read new / from cache / put into the cache
    def add(u, fresh, cached, stored, output):
        for key, name in (("fresh", fresh), ("cached", cached), ("stored", stored), ("output", output)):
            tokens[key] += u.get(name) or 0
    for total in totals.values():
        for per_model in (total.get("modelUsage") or {}).values():
            add(per_model, "inputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "outputTokens")
    for messages in since.values():
        for u in messages.values():
            add(u, "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")
    def limit(name):  # how full that limit was at the start and at the end, as a share of 1
        seen = [w[name]["utilization"] for w in limits if w.get(name, {}).get("utilization") is not None]
        return [seen[0], seen[-1]] if seen else None
    return {"tokens": tokens, "five_hour": limit("five_hour"), "seven_day": limit("seven_day"),
            # what the finished rounds would have cost through the API, at list prices
            "cost": round(sum(total.get("total_cost_usd") or 0 for total in totals.values()), 2)}


# What every agent knows before it is told anything, unless a run says otherwise.
SYSTEM = ("This session is not interactive. Nobody reads what you say, and nobody will answer. "
          "When you end your turn, you are gone.")


def read(run, name):
    """The text of one of a run's files, or nothing if it is not there."""
    path = os.path.join(run, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().strip()


def limits(run):
    """When a world ends by itself: {"until", "minutes", "agents"}. Nothing for older runs."""
    try:
        return json.loads(read(run, "limits.json") or "null")
    except ValueError:
        return None


def old_keep(run):
    """Older runs had one agent that was told something whenever it stopped. This is what."""
    try:
        return json.loads(read(run, "auto") or "{}").get("text")
    except ValueError:
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
    # (Later "start" entries are not actions: the world was picked up again by a new agent.)
    story = {
        "id": os.path.basename(run),
        "world": start.get("world", "island") if start else None,
        "setup": (start.get("setup") or old_setup(start)) if start else None,
        "review": review(run),
        "model": model(run),
        "done": os.path.exists(os.path.join(run, "done")),
        "system": read(run, "system.txt"),   # what every agent knows before it is told anything
        "limits": limits(run),               # when the world ends by itself
        "resumable": os.path.exists(os.path.join(run, "world.pickle")),  # its world was kept, so it can go on
        "keep": old_keep(run),               # older runs: what kept their one agent going
        "steps": [],
    }
    if not start:  # the world has not started yet
        return story

    def after(entry):
        """The moment after a protocol entry: the time and the world's state."""
        return {"time": entry.get("time"), "state": entry.get("state") or old_state(entry, start)}

    # Several agents can live side by side, each in its own place in the world (older runs:
    # one place). What happens in one place is in order; the places are told as they were recorded.
    place_of = lambda entry: entry.get("place") or entry.get("agent") or 1
    # Per place: the actions of each life there, one life after another. A life begins where the
    # world was picked up ("start"). An agent that was ended from outside may have asked for
    # something the world never did: that must not be taken for the next agent's first action.
    lives, wakings = {}, {}
    for entry in protocol:
        if entry["tool"] == "start":
            lives.setdefault(place_of(entry), []).append([])
            if entry is not start:
                wakings.setdefault(place_of(entry), []).append(entry)
        else:
            lives.setdefault(place_of(entry), [[]])[-1].append(entry)
    waiting = {}  # per place: the actions of the agent living there now that are not told yet
    now = after(start)
    memory = {}   # per place: how many tokens its agent's conversation holds at this point
    number = {}   # per place: which agent lives there (1 for the world's first, 2 for the second, ...)
    born = 0
    story["steps"].append({"kind": "prompt", "text": read(run, "prompt.txt") or "", "agent": 1, "place": 1, **now})

    events = read_jsonl(os.path.join(run, "transcript.jsonl"))
    story["usage"] = usage(events)
    for event in events:
        place = place_of(event)
        who = {"agent": number.get(place, 1), "place": place}
        if "compact" in str(event.get("subtype")):  # Claude Code shortened the agent's memory
            story["steps"].append({"kind": "memory", "text": "The agent's memory was full and has been shortened to a summary.", **who, **now})
        elif event.get("type") == "died":  # the agent died; a new one wakes up
            gone = {"stopped": "The agent ended its turn. It is gone.", "drowned": "The agent drowned.",
                    "replaced": "The agent is gone: a friend was called, the world was full, and it had been alive longest."}
            story["steps"].append({"kind": "death", "how": event.get("how", "drowned"), **who, **now,
                                   "text": gone.get(event.get("how"), "The agent died.")})
            memory[place] = 0
            if wakings.get(place):  # from here on the world is shown as the new agent finds it
                now = after(wakings[place].pop(0))
        elif event.get("type") == "told":  # run.py told it something
            if event["how"] in ("first", "new life", "called"):  # a new agent ("called": as a friend, by a note)
                born += 1
                number[place] = event.get("n") or born
                waiting[place] = lives[place].pop(0) if lives.get(place) else []
                who["agent"] = number[place]
            if event["how"] == "first":  # the very first message, as the agent got it (with the time filled in)
                story["steps"][0]["text"] = event["text"]
            else:
                story["steps"].append({"kind": "prompt", "text": event["text"], "how": event["how"], **who, **now})
        if event.get("type") != "assistant":
            continue
        used = event["message"].get("usage") or {}  # everything the agent read to produce this message
        memory[place] = sum(used.get(key) or 0 for key in
                            ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) or memory.get(place, 0)
        mine = {"memory": memory[place], **who}
        for part in event["message"]["content"]:
            if part["type"] == "thinking" and part["thinking"].strip():
                story["steps"].append({"kind": "think", "text": part["thinking"].strip(), **mine, **now})
            elif part["type"] == "text" and part["text"].strip():
                story["steps"].append({"kind": "say", "text": part["text"].strip(), **mine, **now})
            # Only calls to the world's tools reach the protocol.
            elif part["type"] == "tool_use" and part["name"].startswith("mcp__world__"):
                if place not in waiting:  # (runs from before every agent was told something by run.py)
                    waiting[place] = lives[place].pop(0) if lives.get(place) else []
                if not waiting[place] and len(lives.get(place, [])) > born_later(events, event, place):
                    waiting[place] = lives[place].pop(0)  # the world was started again within this life
                if not waiting[place]:  # called, but not finished yet (or never done)
                    story["steps"].append({
                        "kind": "act", "tool": part["name"].removeprefix("mcp__world__"),
                        "args": part["input"], "pending": True, **mine, **now,
                        "result": "… stopped" if story["done"] else "… in progress"})
                    continue
                action = waiting[place].pop(0)
                now = after(action)
                # Extra facts about this action for the viewer, such as the path of a throw.
                detail = action.get("detail") or ({"flight": action["flight"]} if action.get("flight") else {})
                story["steps"].append({"kind": "act", "tool": action["tool"], "args": action["args"],
                                       "result": action["result"], **detail, **mine, **now})
    story["together"] = len({step["place"] for step in story["steps"]})
    return stopped(run, story)


def born_later(events, event, place):
    """How many agents wake up in a place after this event."""
    later = events[events.index(event):]
    return sum(1 for e in later if e.get("type") == "told" and e.get("how") in ("first", "new life", "called")
               and (e.get("place") or e.get("agent") or 1) == place)


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


def told(steps, numbered=False, first=0, together=False):
    """Some steps of a run as readable text. Numbered: each starts with its number, like [12]."""
    lines = []
    for i, step in enumerate(steps, first):
        number = f"[{i}] " if numbered else ""
        if together and step["kind"] != "stop":  # several agents live side by side: say whose step this is
            number += f"AGENT {step.get('agent', 1)} "
        if step["kind"] == "act":
            args = ", ".join(f"{k}={v!r}" for k, v in step["args"].items())
            lines.append(f"{number}DOES  {step['tool']}({args})")
            lines.append("      " + step["result"].replace("\n", "\n      ") + "\n")
        else:
            label = {"prompt": "TOLD ", "think": "THINKS", "say": "SAYS ", "stop": "STOP ", "death": "DIES ", "memory": "MEMORY"}[step["kind"]]
            lines.append(f"{number}{label} {step['text']}\n")
    return "\n".join(lines)


def text(story, numbered=False):
    """The whole run as readable text."""
    lines = [f"Run {story['id']}  (world: {story['world']}, agent: {story['model']})", "",
             told(story["steps"], numbered, together=story.get("together", 1) > 1)]
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
