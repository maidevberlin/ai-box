#!/usr/bin/env python3
"""Hands the world to the agent as tools, and writes the protocol.

Speaks MCP over stdin/stdout (JSON-RPC, one message per line), no dependencies.
Claude Code starts this process once per agent run, so one process = one world.

TOOLS below is exactly what the agent gets to see about each tool.
"""
import json
import os
import sys

from world import DIRS, PLACES, World

LOG = os.environ.get("WORLD_LOG", "protocol.jsonl")
MAX_ACTIONS = int(os.environ.get("WORLD_MAX_ACTIONS", 1000))  # safety stop: then the world and the run end

world = World(
    size=int(os.environ.get("WORLD_SIZE", 20)),
    blocks=int(os.environ.get("WORLD_BLOCKS", 30)),
    view=int(os.environ.get("WORLD_VIEW", 3)),
    jump=int(os.environ.get("WORLD_JUMP", 2)),
    seed=os.environ.get("WORLD_SEED") or None,
)

DIRECTION = {"type": "string", "enum": list(DIRS)}
PLACE = {"type": "string", "enum": PLACES}
TOOLS = {  # name: (description, parameters, required parameters)
    "look": ("Look around.", {}, []),
    "clock": ("Look at your watch.", {}, []),
    # hidden from the agent for now; remove the "#" to bring it back
    # "wait": ("Wait.", {"seconds": {"type": "integer", "minimum": 1}}, ["seconds"]),
    "note": ("Write a note.", {"text": {"type": "string"}}, ["text"]),
    "walk": ("Walk in a direction.",
             {"direction": DIRECTION, "steps": {"type": "integer", "minimum": 1}},
             ["direction"]),
    "jump": ("Jump in a direction. More strength gets you higher.",
             {"direction": DIRECTION,
              "strength": {"type": "integer", "minimum": 1, "maximum": world.max_jump}},
             ["direction", "strength"]),
    "take": ("Take a block.", {"where": PLACE}, ["where"]),
    "put": ("Put down the block you carry.", {"where": PLACE}, ["where"]),
    "throw": ("Throw the block you carry.",
              {"direction": {"type": "number", "description": "compass degrees: 0 is north, 90 is east"},
               "angle": {"type": "number", "description": "degrees above the ground, 0 to 90"},
               "power": {"type": "number", "description": "1 to 10"}},
              ["direction", "angle", "power"]),
}

actions = 0


def log(entry):
    with open(LOG, "a") as f:
        f.write(json.dumps({**entry, **world.state()}) + "\n")


def call(name, args):
    global actions
    actions += 1
    world.flight = None
    if not isinstance(name, str) or name not in TOOLS:
        result = "There is no such tool."
    elif actions > MAX_ACTIONS:
        result = "The world has stopped."
        # Tell run.py to end the run. (This process must stay: if it left, Claude Code would
        # start it again and the agent would find itself in a brand new world.)
        with open(os.path.join(os.path.dirname(LOG), "stopped"), "w") as f:
            f.write(f"The world stopped after {MAX_ACTIONS} actions")
    else:
        try:
            result = getattr(world, name)(**args)
        except TypeError:  # wrong or missing arguments
            result = "That did not work. Check the arguments."
    flight = {"flight": world.flight} if world.flight else {}  # only a throw has one
    log({"n": actions, "tool": name, "args": args, "result": result, **flight})
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


# Entry 0 of the protocol: the world before the agent did anything.
log({"n": 0, "tool": "start", "size": world.size, "view": world.view, "north": DIRS["north"][1]})

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
