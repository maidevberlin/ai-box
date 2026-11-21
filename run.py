#!/usr/bin/env python3
"""Start one empty agent in a fresh island world, and stay with it until the run ends.

The agent is told PROMPT and acts until it stops. Then the run waits for the next
thing to tell it:
  - a message someone wrote (the viewer puts it in runs/<id>/inbox), or
  - the prompt again, by itself, as long as the file runs/<id>/auto exists.
The run ends when nobody answers for WAIT seconds, on Ctrl+C, or when the viewer ends it.

Optional settings, as environment variables:
  WORLD_SIZE, WORLD_BLOCKS, WORLD_SEED, WORLD_VIEW, WORLD_JUMP, WORLD_MAX_ACTIONS
  PROMPT, MODEL, SYSTEM_PROMPT, RUN_ID (folder name under runs/, default: timestamp)
  AUTO=1    repeat the prompt whenever the agent stops (at most AUTO_MAX times, default 30)
  WAIT      seconds to wait for a message before the run ends (default 300)
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
PROMPT = os.environ.get("PROMPT") or "Live! You have 1 hour. If you stop, you die."
WAIT = int(os.environ.get("WAIT", 300))
AUTO_MAX = int(os.environ.get("AUTO_MAX", 30))


def path(name):
    return os.path.join(RUN, name)


def write(name, text=""):
    with open(path(name), "w") as f:
        f.write(text)


os.makedirs(RUN, exist_ok=True)
os.makedirs("/tmp/w", exist_ok=True)  # a neutral working directory: the path tells the agent nothing
write("prompt.txt", PROMPT + "\n")
write("pid", str(os.getpid()))  # so the viewer can end this run
if os.environ.get("AUTO"):
    write("auto")
# Tell Claude Code how to start the world, and pass the world settings along.
world_settings = {k: v for k, v in os.environ.items() if k.startswith("WORLD_")}
write("mcp.json", json.dumps({"mcpServers": {"world": {
    "command": "python3", "args": [os.path.join(HERE, "mcp_server.py")],
    "env": {**world_settings, "WORLD_LOG": path("protocol.jsonl")}}}}))

# The empty agent: no built-in tools, no settings, no skills, no memory. It may only
# use the world's tools. Its thinking is recorded as a summary. It reads what it is
# told from its input, one message per line, so it can be told more after it stops.
agent = subprocess.Popen(
    ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
     "--system-prompt", os.environ.get("SYSTEM_PROMPT", ""),
     "--model", os.environ.get("MODEL", "opus"),
     "--mcp-config", path("mcp.json"), "--strict-mcp-config",
     "--tools", "", "--allowedTools", "mcp__world",
     "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
     "--thinking-display", "summarized"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(path("errors.txt"), "w"),
    text=True, cwd="/tmp/w")
transcript = open(path("transcript.jsonl"), "w")
repeats = 0


def tell(text):
    agent.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
    agent.stdin.flush()


def next_message():
    """Wait for the next thing to tell the agent. Returns nothing when the run is over."""
    global repeats
    deadline = time.time() + WAIT
    while time.time() < deadline:
        if os.path.exists(path("inbox")):  # someone wrote a message; an empty one means "repeat"
            with open(path("inbox")) as f:
                text = f.read().strip()
            os.remove(path("inbox"))
            return {"text": text or PROMPT, "how": "by hand"}
        if os.path.exists(path("auto")) and repeats < AUTO_MAX:
            repeats += 1
            return {"text": PROMPT, "how": "repeat"}
        time.sleep(0.3)


signal.signal(signal.SIGTERM, lambda *_: sys.exit())  # the viewer's "End run"
try:
    tell(PROMPT)
    for line in agent.stdout:
        transcript.write(line)
        transcript.flush()
        if json.loads(line).get("type") == "result":  # the agent has stopped
            message = next_message()
            if not message:
                break
            transcript.write(json.dumps({"type": "told", **message}) + "\n")  # our own line, for the story
            transcript.flush()
            tell(message["text"])
except KeyboardInterrupt:
    pass
finally:
    agent.terminate()  # its world ends with it
    agent.wait()
    transcript.close()
    os.remove(path("pid"))
    write("done")
    print(story.text(story.load(RUN)))
    # A second agent names, summarizes and rates the run (see review.py).
    subprocess.run([os.path.join(HERE, "review.py"), RUN], stderr=open(path("errors.txt"), "a"))
