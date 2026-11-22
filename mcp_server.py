#!/usr/bin/env python3
"""Hands a world to the agent as tools, and writes the protocol.

Speaks MCP over stdin/stdout (JSON-RPC, one message per line), no dependencies.
Claude Code starts this process together with the agent. The world itself is kept in a
file next to the protocol, so it outlives the agent: when an agent dies and a new one
is started, the new one wakes up in the world as it was left.

Which world is the environment variable WORLD (a file name in worlds/, default: island).
The world's own settings come as WORLD_<SETTING>. This file knows nothing about any
particular world; what a world file has to contain is described in worlds/__init__.py.
"""
import json
import os
import pickle
import sys
import time

import worlds

NAME = os.environ.get("WORLD", "island")
LOG = os.path.abspath(os.environ.get("WORLD_LOG", "protocol.jsonl"))
RUN = os.path.dirname(LOG)
SAVED = os.path.join(RUN, "world.pickle")  # the world and the number of actions so far
MAX_ACTIONS = int(os.environ.get("WORLD_MAX_ACTIONS", 5000))  # safety stop: then the world and the run end


def setting(key, usual):
    """A world setting: from the environment if given there, else the world's usual value."""
    given = os.environ.get(f"WORLD_{key.upper()}")
    if not given:
        return usual
    return given if usual is None else type(usual)(given)


module = worlds.load(NAME)
if os.path.exists(SAVED):  # an earlier agent was here
    with open(SAVED, "rb") as f:
        world, actions = pickle.load(f)
    if hasattr(world, "respawn"):  # the agent before is gone, however it went: a new one wakes up
        world.respawn()
else:
    world = module.World(**{key: setting(key, usual) for key, usual in module.SETTINGS.items()})
    actions = 0
TOOLS = module.tools(world)  # exactly what the agent gets to see about each tool


def save():
    with open(SAVED + ".part", "wb") as f:
        pickle.dump((world, actions), f)
    os.replace(SAVED + ".part", SAVED)


def log(entry):
    with open(LOG, "a") as f:
        f.write(json.dumps({"time": time.strftime("%H:%M:%S"), **entry, "state": world.state()}) + "\n")


def call(name, args):
    global actions
    actions += 1
    world.detail = None
    alive = not getattr(world, "dead", False)
    if not isinstance(name, str) or name not in TOOLS:
        result = "There is no such tool."
    elif actions > MAX_ACTIONS:
        result = "The world has stopped."
        # Tell run.py to end the run. (This process must stay: if it left, Claude Code would
        # start it again and the agent would find itself in a brand new world.)
        with open(os.path.join(RUN, "stopped"), "w") as f:
            f.write(f"The world stopped after {MAX_ACTIONS} actions")
    elif not alive:  # it asked for several things at once, and an earlier one killed it
        result = "You are dead."
    else:
        try:
            result = getattr(world, name)(**args)
        except TypeError:  # wrong or missing arguments
            result = "That did not work. Check the arguments."
    detail = {"detail": world.detail} if world.detail else {}  # for example the path of a throw
    log({"n": actions, "tool": name, "args": args, "result": result, **detail})
    save()
    # Tell run.py, once: it ends this agent and starts a new one. (Not again for what the dead
    # agent still tries: that second sign killed the next agent before it had done anything.)
    if alive and getattr(world, "dead", False):
        open(os.path.join(RUN, "died"), "w").close()
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


# Entry 0 of the protocol: which world, and how it is before the agent did anything.
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
