#!/usr/bin/env python3
"""Hands a world to the agent as tools, and writes the protocol.

Speaks MCP over stdin/stdout (JSON-RPC, one message per line), no dependencies.
Claude Code starts this process together with the agent. The world itself is kept in a
file next to the protocol, so it outlives the agent: when an agent dies and a new one
is started, the new one wakes up in the world as it was left.

Which world is the environment variable WORLD (a file name in worlds/, default: island).
The world's own settings come as WORLD_<SETTING>. This file knows nothing about any
particular world; what a world file has to contain is described in worlds/__init__.py.

Several agents can live in one world at the same time. Each has its own process like this
one, and a place in the world (WORLD_AGENT: 1, 2, ...). They share the world through its
file: for every action a process locks the file, reads the world, acts, and writes it back
(see kept.py).
"""
import contextlib
import json
import os
import sys
import time

import kept
import worlds

NAME = os.environ.get("WORLD", "island")
LOG = os.path.abspath(os.environ.get("WORLD_LOG", "protocol.jsonl"))
RUN = os.path.dirname(LOG)
AGENT = int(os.environ.get("WORLD_AGENT") or 1)  # which place in the world this process's agent has
MAX_ACTIONS = int(os.environ.get("WORLD_MAX_ACTIONS", 5000))  # safety stop: then the world and the run end


def setting(key, usual):
    """A world setting: from the environment if given there, else the world's usual value."""
    given = os.environ.get(f"WORLD_{key.upper()}")
    if not given:
        return usual
    return given if usual is None else type(usual)(given)


module = worlds.load(NAME)
world, actions = None, 0


def new_world():
    made = module.World(**{key: setting(key, usual) for key, usual in module.SETTINGS.items()})
    # A note that lies in the world from the start, where agents wake up (a setting of the run).
    if os.environ.get("WORLD_NOTE") and hasattr(made, "leave_note"):
        made.leave_note(made.home, os.environ["WORLD_NOTE"])
    return made


@contextlib.contextmanager
def the_world():
    """The world, for this process alone while it acts in it: read before, written back after."""
    global world, actions
    with kept.world_of(RUN, new_world) as box:
        world, actions = box
        if hasattr(world, "enter"):
            world.enter(AGENT)
        yield
        box[1] = actions


def log(entry):
    with open(LOG, "a") as f:
        f.write(json.dumps({"time": time.strftime("%H:%M:%S"), "agent": AGENT, **entry, "state": world.state()}) + "\n")


def tell_of_deaths():
    """Tell run.py who has died: it ends that agent and starts a new one in its place. Each
    death is told once. (Not again for what a dead agent still tries: that second sign
    killed the next agent before it had done anything.)"""
    for who, body in getattr(world, "bodies", {1: {"dead": getattr(world, "dead", False)}}).items():
        if body["dead"] and not body.get("told"):
            body["told"] = True
            open(os.path.join(RUN, f"died.{who}"), "w").close()


def call(name, args):
    global actions
    with the_world():
        actions += 1
        world.detail = None
        if not isinstance(name, str) or name not in TOOLS:
            result = "There is no such tool."
        elif actions > MAX_ACTIONS:
            result = "The world has stopped."
            # Tell run.py to end the run. (This process must stay: if it left, Claude Code would
            # start it again and the agent would find itself in a brand new world.)
            with open(os.path.join(RUN, "stopped"), "w") as f:
                f.write(f"The world stopped after {MAX_ACTIONS} actions")
        elif getattr(world, "dead", False):  # it asked for several things at once, and an earlier one killed it
            result = "You are dead."
        else:
            try:
                result = getattr(world, name)(**args)
            except TypeError:  # wrong or missing arguments
                result = "That did not work. Check the arguments."
            if hasattr(world, "lose_footing"):
                world.lose_footing()
            if hasattr(world, "noticed") and not world.dead:
                result += world.noticed()  # what it saw happen meanwhile: someone vanishing
        detail = {"detail": world.detail} if world.detail else {}  # for example the path of a throw
        log({"n": actions, "tool": name, "args": args, "result": result, **detail})
        tell_of_deaths()
        # A friend was called (see Grid.come_down): run.py wakes one up, if this run allows it.
        for made in getattr(world, "calls", []):
            with open(os.path.join(RUN, "calls.jsonl"), "a") as f:
                f.write(json.dumps({"time": time.strftime("%H:%M:%S"), "by": AGENT, **made}) + "\n")
        world.calls = []
    return result


def handle(method, params):
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "world", "version": "0"}}
    if method == "tools/list":
        return {"tools": [
            {"name": name, "description": description,
             "inputSchema": {"type": "object", "properties": properties, "required": required}}
            for name, (description, properties, required) in TOOLS.items()]}
    if method == "tools/call":
        text = call(params.get("name"), params.get("arguments") or {})
        return {"content": [{"type": "text", "text": text}]}
    if method == "ping":
        return {}
    raise LookupError(method)


# A new agent wakes up in its place: in a new world, or in the world as it was left.
# Entry 0 of the protocol says which world, and how it is before this agent did anything.
with the_world():
    # A friend that was called wakes up next to where it was called from, with the note that
    # called it in its hand (see run.py).
    hand, friend = os.path.join(RUN, f"hand.{AGENT}"), None
    if os.path.exists(hand):
        with open(hand) as f:
            friend = json.load(f)
        os.remove(hand)
    if hasattr(world, "respawn"):  # the agent that was in this place before is gone, however it went
        if friend and friend.get("at"):
            world.respawn(near=tuple(friend["at"]))
        else:
            world.respawn()
    if hasattr(world, "bodies"):
        world.bodies[AGENT].pop("told", None)
    if friend:
        world.carrying = {"note": friend["note"]}
    TOOLS = module.tools(world)  # exactly what the agent gets to see about each tool
    log({"n": 0, "tool": "start", "world": NAME, "setup": world.setup()})

for line in sys.stdin:
    if not line.strip():
        continue
    message = json.loads(line)
    if "id" not in message:  # a notification: nothing to answer
        continue
    try:
        reply = {"result": handle(message.get("method"), message.get("params") or {})}
    except LookupError:
        reply = {"error": {"code": -32601, "message": "Method not found"}}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message["id"], **reply}) + "\n")
    sys.stdout.flush()
