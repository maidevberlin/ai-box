#!/usr/bin/env python3
"""Run a world: one agent after another lives in it, until the world ends.

Nobody talks to an agent while it lives. Each agent starts with an empty memory, knows
what SYSTEM says, and is told PROMPT once. When it stops, or dies in its world, it is gone,
and a new agent wakes up in the world as it was left. The world ends when its time is up
(MINUTES), when its last agent has gone (AGENTS), on Ctrl+C, or when the viewer ends it.

Several agents can live at the same time (TOGETHER). The world then has that many places.
In each place one agent lives after another, as above; the agents in different places live
side by side, can see each other, and know nothing of each other beforehand.

Friends can be called (ROOM): an agent that throws a note beginning with "friend" into the
water calls a new agent, which wakes up next to the caller with that note in its hand. The world has room for
ROOM agents at the same time. If it is full when a friend is called, the agent that has been
alive longest is gone at that moment, and the friend wakes up in its place. A called friend
is not followed by a new agent when it goes, unless it took the place of one that would be.

Agents can keep their memory (MEMORY=keep). Then an agent that dies, or ends its turn, is not
replaced: the same agent wakes up again in the middle, and remembers everything. If it drowned,
it wakes up with its next action; if it ended its turn, it is told PROMPT again. AGENTS then
counts how often agents wake up again: an agent that only ends its turn would otherwise be
woken up again and again, as fast as it can answer.

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
  TOGETHER  how many agents live at the same time (default 1)
  ROOM      friends can be called, up to this many agents alive (default 0: no calling)
  MEMORY    "keep": an agent keeps its memory when it wakes up again (default: a new agent)
  WORLD_NOTE  a note that lies in the world from the start, where agents wake up
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
import threading
import time

import kept
import story

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "runs", os.environ.get("RUN_ID") or time.strftime("%Y%m%d-%H%M%S"))
RESUME = bool(os.environ.get("RESUME")) and os.path.exists(os.path.join(RUN, "world.pickle"))
if RESUME:  # as before: what its agents knew and were told, and which model they were
    PROMPT, SYSTEM = (story.read(RUN, name).rstrip("\n") for name in ("prompt.txt", "system.txt"))
    MODEL = "claude-" + story.model(RUN)
    TOGETHER = (story.limits(RUN) or {}).get("together") or 1
    ROOM = (story.limits(RUN) or {}).get("room") or 0
    KEEP = bool((story.limits(RUN) or {}).get("keep"))
else:
    KEEP = os.environ.get("MEMORY") == "keep"
    TOGETHER = max(1, int(os.environ.get("TOGETHER") or 1))
    ROOM = int(os.environ.get("ROOM") or 0)
    PROMPT = os.environ.get("PROMPT") or "Live!"
    SYSTEM = os.environ.get("SYSTEM", story.SYSTEM)
    MODEL = os.environ.get("MODEL", "opus")
MINUTES = float(os.environ.get("MINUTES") or 10)
AGENTS = int(os.environ.get("AGENTS") or 100)
ROOM = max(ROOM, TOGETHER) if ROOM else 0


def path(name):
    return os.path.join(RUN, name)


def write(name, text=""):
    with open(path(name), "w") as f:
        f.write(text)


os.makedirs(RUN, exist_ok=True)
os.makedirs("/tmp/w", exist_ok=True)  # a neutral working directory: the path tells the agent nothing
if RESUME:  # the world is not over any more
    for name in ("done", "stopped", "review.json"):
        if os.path.exists(path(name)):
            os.remove(path(name))
else:
    write("prompt.txt", PROMPT + "\n")
    write("system.txt", SYSTEM + "\n")
write("pid", str(os.getpid()))  # so the viewer can end this run
# When this world ends by itself. The viewer shows what is left.
ends = time.time() + MINUTES * 60 if MINUTES else None
write("limits.json", json.dumps({"until": ends, "minutes": f"{MINUTES:g}" if MINUTES else None, "agents": AGENTS,
                                 "together": TOGETHER, "room": ROOM, "keep": KEEP}))
# Tell Claude Code how to start the world, and pass the world settings along.
# (A world that goes on keeps the settings it was started with.)
if not RESUME:
    world_settings = {k: v for k, v in os.environ.items() if k.startswith("WORLD")}
    if KEEP:  # the world wakes a drowned agent up again itself (see mcp_server.py)
        world_settings["WORLD_KEEP"] = "1"
    write("mcp.1.json", json.dumps({"mcpServers": {"world": {
        "command": "python3", "args": [os.path.join(HERE, "mcp_server.py")],
        "env": {**world_settings, "WORLD_LOG": path("protocol.jsonl"), "WORLD_AGENT": "1"}}}}))


def way_in(place):
    """The file that tells Claude Code how to start the world for the agent in this place.
    Each place has its own. (A world from before there were places has only one, for place 1.)"""
    own, first = path(f"mcp.{place}.json"), path("mcp.1.json")
    if not os.path.exists(own):
        with open(first if os.path.exists(first) else path("mcp.json")) as f:
            config = json.load(f)
        config["mcpServers"]["world"]["env"]["WORLD_AGENT"] = str(place)
        write(f"mcp.{place}.json", json.dumps(config))
    return own


if RESUME:  # friends that were alive when the world ended are gone: nobody takes their place
    with kept.world_of(RUN) as box:
        for place in [who for who in box[0].agents if who > TOGETHER]:
            box[0].leave(box[0].enter(place))
calls = open(path("calls.jsonl"), "a+")  # where the world writes who called a friend; read from here on
# How many agents have lived in this world already: each was told something once.
BEFORE = sum(line.startswith(('{"type": "told"', '{"type":"told"')) for line in open(path("transcript.jsonl"), errors="replace")) if RESUME else 0
transcript = open(path("transcript.jsonl"), "a" if RESUME else "w")


def filled(text, n):
    """A text as agent number n gets it: with the moment, the time left and its number filled in."""
    for mark, form in (("{day}", "%A"), ("{time}", "%H:%M"), ("{date}", "%d %B %Y")):
        text = text.replace(mark, time.strftime(form))
    seconds = max(0, round(ends - time.time())) if ends else None
    left = "no time limit" if ends is None else f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"
    return text.replace("{left}", left).replace("{n}", str(n))


def new_agent(n, place):
    """An empty agent: no built-in tools, no settings, no skills, no memory. It may only use
    the world's tools. Its thinking is recorded as a summary."""
    return subprocess.Popen(
        ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
         "--system-prompt", filled(SYSTEM, n),
         "--model", MODEL,
         "--mcp-config", way_in(place), "--strict-mcp-config",
         "--tools", "", "--allowedTools", "mcp__world",
         "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
         "--thinking-display", "summarized",
         "--autocompact", os.environ.get("AUTOCOMPACT", "100000")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(path("errors.txt"), "a"),
        text=True, cwd="/tmp/w")


writing = threading.Lock()  # the agents that live side by side write into one transcript
born = BEFORE               # how many agents have woken up so far
woken = 0                   # how often an agent that keeps its memory has woken up again
living = {}                 # place -> (the agent's process, its number), for the agents that are alive
places = {}                 # place -> the thread in which its agents live
called = {}                 # place -> the call ({"note", "at"}) of the friend that wakes up there next


def record(event):
    """A line in the transcript, for the story."""
    with writing:
        transcript.write(json.dumps(event, separators=(",", ":")) + "\n")
        transcript.flush()


def live(n, place, call=None):
    """One agent's life, from waking up to being gone. A friend that was called wakes up with
    the note that called it in its hand. Returns how the life ended: "stopped" (it ended its
    turn), "drowned" (it died in its world), "replaced" (a friend was called and the world was
    full), or nothing (the world is over)."""
    died = path(f"died.{place}")
    if os.path.exists(died):  # a late sign from the agent before: it is not about this one
        os.remove(died)
    if call:  # the world wakes the friend near its caller, with the note in its hand (see mcp_server.py)
        write(f"hand.{place}", json.dumps(call))
    agent = new_agent(n, place)
    living[place] = (agent, n)
    told = filled(PROMPT, n)
    how = "first" if n == 1 else "called" if call else "new life"
    record({"type": "told", "text": told, "how": how, "place": place, "n": n})
    agent.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": told}}) + "\n")
    agent.stdin.flush()
    ended = None
    try:
        while line := agent.stdout.readline():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            record({**event, "place": place, "n": n})  # whose line this is
            if ends and time.time() >= ends:
                write("stopped", f"The world's time was up after {MINUTES:g} minutes")
            if os.path.exists(path("stopped")):  # the time is up, or the world has stopped (see mcp_server.py)
                break
            if os.path.exists(died):  # the agent died in its world (see mcp_server.py)
                os.remove(died)
                if KEEP and may_wake():  # it is not gone: the world wakes it up again with its next action
                    record({"type": "died", "how": "drowned", "place": place, "n": n})
                    record({"type": "told", "how": "woke", "place": place, "n": n,
                            "text": "It wakes up again in the middle, and remembers everything."})
                    continue
                ended = "drowned"
                break
            if event.get("type") == "result":  # the agent ended its turn: nobody answers, it is gone
                if KEEP and may_wake():  # ... unless it keeps its memory: then it wakes up again, and is told again
                    record({"type": "died", "how": "slept", "place": place, "n": n})
                    wake_again(place)
                    told = filled(PROMPT, n)
                    record({"type": "told", "text": told, "how": "again", "place": place, "n": n})
                    agent.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": told}}) + "\n")
                    agent.stdin.flush()
                    continue
                ended = "stopped"
                break
        if not ended and place in called and not os.path.exists(path("stopped")):
            ended = "replaced"  # ended from outside (see friend): the one called takes this place
    finally:
        agent.terminate()  # the world is kept in a file, so it outlives the agent
        agent.wait()
        living.pop(place, None)
    return ended


def may_wake():
    """Whether an agent that keeps its memory may wake up again (see AGENTS). If not, the world ends."""
    global woken
    with writing:
        woken += 1
        if woken <= AGENTS:
            return True
    write("stopped", f"The world ended: agents had woken up again {AGENTS} times")
    return False


def wake_again(place):
    """The agent in a place wakes up again in the middle, the same one (see MEMORY). The world
    records it as a new start, so that the story shows where it woke up."""
    with kept.world_of(RUN) as box:
        world = box[0]
        world.respawn(world.enter(place))
        with open(path("protocol.jsonl"), "a") as f:
            f.write(json.dumps({"time": time.strftime("%H:%M:%S"), "agent": place, "n": 0, "tool": "start",
                                "world": story.world(RUN), "setup": world.setup(), "state": world.state(everything=True)}) + "\n")


def lives(place, lasting=True):
    """One place in the world: an agent lives in it, and when it is gone the next one wakes up.
    A place that was opened for a friend does not last: when the friend is gone, nobody follows,
    unless another friend was called into this place."""
    global born
    while not os.path.exists(path("stopped")):
        call = called.pop(place, None)
        with writing:
            if born >= BEFORE + AGENTS:  # the world's last agent has woken up already
                break
            born += 1
            n = born
        how = live(n, place, call)
        if not how:
            break
        record({"type": "died", "how": how, "place": place, "n": n})
        if not lasting and place not in called:
            with kept.world_of(RUN) as box:  # its body leaves the world
                box[0].leave(box[0].enter(place))
            break
    places.pop(place, None)


def open_place(place, lasting=True):
    places[place] = threading.Thread(target=lives, args=(place, lasting), daemon=True)
    places[place].start()


def friend(call):
    """A friend was called. If the world has room, it wakes up in a new place. If the world is
    full, the agent that has been alive longest is gone, and the friend wakes up in its place."""
    if not ROOM or born >= BEFORE + AGENTS or os.path.exists(path("stopped")):
        return
    if len(living) < ROOM and len(places) < ROOM:
        place = min(set(range(1, ROOM + 1)) - set(places))
        called[place] = call
        open_place(place, lasting=False)
    elif living:
        place, (oldest, _) = min(living.items(), key=lambda found: found[1][1])
        called[place] = call
        oldest.terminate()  # its place sees that it was called into, and goes on with the friend


signal.signal(signal.SIGTERM, lambda *_: sys.exit())  # the viewer's "End the world"
try:
    for place in range(1, TOGETHER + 1):
        open_place(place)
    while places:
        time.sleep(0.2)
        for line in calls.readlines():  # the world says a friend was called
            friend(json.loads(line))
    if not os.path.exists(path("stopped")):
        write("stopped", f"The world ended with its last agent, number {BEFORE + AGENTS}")
except KeyboardInterrupt:
    pass
finally:
    if not os.path.exists(path("stopped")):
        write("stopped")  # ended from outside: the places stop when they see this
    for agent, _ in list(living.values()):
        agent.terminate()
    for place in list(places.values()):
        place.join(5)
    transcript.close()
    os.remove(path("pid"))
    write("done")
    print(story.text(story.load(RUN)))
    # A second agent names, summarizes and rates the run (see review.py).
    subprocess.run([os.path.join(HERE, "review.py"), RUN], stderr=open(path("errors.txt"), "a"))
