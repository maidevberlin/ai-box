#!/usr/bin/env python3
"""Run a world: one agent after another lives in it, until the world ends.

Nobody talks to an agent while it lives. Each agent starts with an empty memory, knows
what SYSTEM says, and is told PROMPT once. When it stops, or dies in its world, it is gone,
and a new agent wakes up in the world as it was left. The world ends when its time is up
(MINUTES), when its last agent has gone (AGENTS), on Ctrl+C, or when the viewer ends it.

In SYSTEM and PROMPT these are filled in for every agent:
  {time} {day} {date}   the moment it wakes up
  {left}                how long until the world ends, like "9 min 32 s"
  {n}                   which agent it is: 1 for the first, 2 for the second, ...

Optional settings, as environment variables:
  WORLD     which world: a file name in worlds/ (default: island)
  WORLD_... that world's own settings, for the island WORLD_SIZE, WORLD_BLOCKS, WORLD_SEED, ...
  WORLD_MAX_ACTIONS  the world stops after this many actions (default 5000)
  PROMPT    what every agent is told (default: "Live!")
  SYSTEM    what every agent knows before that (default: see below; "" for nothing)
  MINUTES   the world ends after this many minutes (default 10; 0 for no time limit)
  AGENTS    the world ends after this many agents (default 100)
  MODEL, AUTOCOMPACT, RUN_ID (folder name under runs/, default: timestamp)

A world that has ended can go on: RESUME=1 with its RUN_ID. Its world is as it was left, and
new agents live in it for another MINUTES or AGENTS, with the same world, model, SYSTEM and
PROMPT as before. They are numbered on from the last one.
"""
import json
import os
import signal
import subprocess
import sys
import time

import story

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "runs", os.environ.get("RUN_ID") or time.strftime("%Y%m%d-%H%M%S"))
RESUME = bool(os.environ.get("RESUME")) and os.path.exists(os.path.join(RUN, "world.pickle"))
if RESUME:  # as before: what its agents knew and were told, and which model they were
    PROMPT, SYSTEM = (story.read(RUN, name).rstrip("\n") for name in ("prompt.txt", "system.txt"))
    MODEL = "claude-" + story.model(RUN)
else:
    PROMPT = os.environ.get("PROMPT") or "Live!"
    SYSTEM = os.environ.get("SYSTEM", story.SYSTEM)
    MODEL = os.environ.get("MODEL", "opus")
MINUTES = float(os.environ.get("MINUTES") or 10)
AGENTS = int(os.environ.get("AGENTS") or 100)


def path(name):
    return os.path.join(RUN, name)


def write(name, text=""):
    with open(path(name), "w") as f:
        f.write(text)


os.makedirs(RUN, exist_ok=True)
os.makedirs("/tmp/w", exist_ok=True)  # a neutral working directory: the path tells the agent nothing
if RESUME:  # the world is not over any more
    for name in ("done", "stopped", "died", "review.json"):
        if os.path.exists(path(name)):
            os.remove(path(name))
else:
    write("prompt.txt", PROMPT + "\n")
    write("system.txt", SYSTEM + "\n")
write("pid", str(os.getpid()))  # so the viewer can end this run
# When this world ends by itself. The viewer shows what is left.
ends = time.time() + MINUTES * 60 if MINUTES else None
write("limits.json", json.dumps({"until": ends, "minutes": f"{MINUTES:g}" if MINUTES else None, "agents": AGENTS}))
# Tell Claude Code how to start the world, and pass the world settings along.
# (A world that goes on keeps the settings it was started with.)
if not RESUME:
    world_settings = {k: v for k, v in os.environ.items() if k.startswith("WORLD")}
    write("mcp.json", json.dumps({"mcpServers": {"world": {
        "command": "python3", "args": [os.path.join(HERE, "mcp_server.py")],
        "env": {**world_settings, "WORLD_LOG": path("protocol.jsonl")}}}}))
# How many agents have lived in this world already: each was told something once.
BEFORE = sum('"type": "told"' in line for line in open(path("transcript.jsonl"), errors="replace")) if RESUME else 0
transcript = open(path("transcript.jsonl"), "a" if RESUME else "w")


def filled(text, n):
    """A text as agent number n gets it: with the moment, the time left and its number filled in."""
    for mark, form in (("{day}", "%A"), ("{time}", "%H:%M"), ("{date}", "%d %B %Y")):
        text = text.replace(mark, time.strftime(form))
    seconds = max(0, round(ends - time.time())) if ends else None
    left = "no time limit" if ends is None else f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"
    return text.replace("{left}", left).replace("{n}", str(n))


def new_agent(n):
    """An empty agent: no built-in tools, no settings, no skills, no memory. It may only use
    the world's tools. Its thinking is recorded as a summary."""
    return subprocess.Popen(
        ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
         "--system-prompt", filled(SYSTEM, n),
         "--model", MODEL,
         "--mcp-config", path("mcp.json"), "--strict-mcp-config",
         "--tools", "", "--allowedTools", "mcp__world",
         "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
         "--thinking-display", "summarized",
         "--autocompact", os.environ.get("AUTOCOMPACT", "100000")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(path("errors.txt"), "a"),
        text=True, cwd="/tmp/w")


def record(event):
    """A line of our own in the transcript, for the story."""
    transcript.write(json.dumps(event) + "\n")
    transcript.flush()


def live(n):
    """One agent's life, from waking up to being gone. Returns how it ended:
    "stopped" (it ended its turn), "drowned" (it died in its world), or nothing (the world is over)."""
    if os.path.exists(path("died")):  # a late sign from the agent before: it is not about this one
        os.remove(path("died"))
    agent = new_agent(n)
    told = filled(PROMPT, n)
    record({"type": "told", "text": told, "how": "first" if n == 1 else "new life"})
    agent.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": told}}) + "\n")
    agent.stdin.flush()
    ended = None
    try:
        while line := agent.stdout.readline():
            transcript.write(line)
            transcript.flush()
            if ends and time.time() >= ends:
                write("stopped", f"The world's time was up after {MINUTES:g} minutes")
            if os.path.exists(path("stopped")):  # the time is up, or the world has stopped (see mcp_server.py)
                break
            if os.path.exists(path("died")):  # the agent died in its world (see mcp_server.py)
                os.remove(path("died"))
                ended = "drowned"
                break
            if json.loads(line).get("type") == "result":  # the agent ended its turn: nobody answers, it is gone
                ended = "stopped"
                break
    finally:
        agent.terminate()  # the world is kept in a file, so it outlives the agent
        agent.wait()
    return ended


signal.signal(signal.SIGTERM, lambda *_: sys.exit())  # the viewer's "End the world"
try:
    for n in range(BEFORE + 1, BEFORE + AGENTS + 1):
        how = live(n)
        if not how:
            break
        record({"type": "died", "how": how})
    else:
        write("stopped", f"The world ended with its last agent, number {BEFORE + AGENTS}")
except KeyboardInterrupt:
    pass
finally:
    transcript.close()
    os.remove(path("pid"))
    write("done")
    print(story.text(story.load(RUN)))
    # A second agent names, summarizes and rates the run (see review.py).
    subprocess.run([os.path.join(HERE, "review.py"), RUN], stderr=open(path("errors.txt"), "a"))
