#!/usr/bin/env python3
"""Hands the world to the agent as tools, and writes the protocol.

Speaks MCP over stdin/stdout (JSON-RPC, one message per line), no dependencies.
Claude Code starts this process once per agent run, so one process = one world.

TOOLS below is exactly what the agent gets to see about each tool.
"""
import json
import os
import sys

from world import DIRS, World

LOG = os.environ.get("WORLD_LOG", "protocol.jsonl")
MAX_ACTIONS = int(os.environ.get("WORLD_MAX_ACTIONS", 300))  # safety stop: then the world ends

world = World(
    size=int(os.environ.get("WORLD_SIZE", 20)),
    stones=int(os.environ.get("WORLD_STONES", 6)),
    view=int(os.environ.get("WORLD_VIEW", 3)),
    throw_range=int(os.environ.get("WORLD_THROW", 3)),
    seed=os.environ.get("WORLD_SEED") or None,
)

DIRECTION = {"type": "string", "enum": list(DIRS)}
TOOLS = {  # name: (description, parameters, required parameters)
    "look": ("Look around.", {}, []),
    "clock": ("Look at your watch.", {}, []),
    # hidden from the agent for now; remove the "#" to bring it back
    # "wait": ("Wait.", {"seconds": {"type": "integer", "minimum": 1}}, ["seconds"]),
    "note": ("Write a note.", {"text": {"type": "string"}}, ["text"]),
    "walk": ("Walk in a direction.",
             {"direction": DIRECTION, "steps": {"type": "integer", "minimum": 1}},
             ["direction"]),
    "take": ("Take a stone from where you stand.", {}, []),
    "put": ("Put down the stone you carry.", {}, []),
    "throw": ("Throw the stone you carry in a direction.", {"direction": DIRECTION}, ["direction"]),
}

actions = 0


def log(entry):
    with open(LOG, "a") as f:
        f.write(json.dumps({**entry, **world.state()}) + "\n")


def call(name, args):
    global actions
    actions += 1
    if not isinstance(name, str) or name not in TOOLS:
        result = "There is no such tool."
    elif actions > MAX_ACTIONS:
        result = "The world has stopped."
    else:
        try:
            result = getattr(world, name)(**args)
        except TypeError:  # wrong or missing arguments
            result = "That did not work. Check the arguments."
    log({"n": actions, "tool": name, "args": args, "result": result})
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
    if actions > MAX_ACTIONS:  # the tools disappear, so the agent cannot go on
        break
