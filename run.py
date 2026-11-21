#!/usr/bin/env python3
"""Start one empty agent in a fresh world, and stay with it until the run ends.

The agent is told PROMPT and acts until it stops. Then the run waits for the next
thing to tell it:
  - a message someone wrote (the viewer puts it in runs/<id>/inbox), or
  - by itself, a short message that keeps it going, as long as the file runs/<id>/auto
    exists. Usually that is just the day and the time.
In everything the agent is told, {day}, {time} and {date} are filled in.
A keep-going message can also count down: with {countdown:10} in it, the agent is told
10 the first time it stops, then 9, and so on. When 0 would be next, the run ends.
If the agent dies in its world, it is replaced: a new agent with an empty memory is told
the prompt, in the world as the dead one left it.

The run ends when nobody answers for WAIT seconds, on Ctrl+C, when the viewer ends it,
or when the world stops (after WORLD_MAX_ACTIONS actions).

Optional settings, as environment variables:
  WORLD     which world: a file name in worlds/ (default: island)
  WORLD_... that world's own settings, for the island WORLD_SIZE, WORLD_BLOCKS, WORLD_SEED, ...
  WORLD_MAX_ACTIONS  the world stops after this many actions (default 1000)
  PROMPT, MODEL, SYSTEM_PROMPT, RUN_ID (folder name under runs/, default: timestamp)
  AUTO=1    keep the agent going whenever it stops (at most AUTO_MAX times, default 30)
  AUTO_TEXT     what it is told then (default: "It is {day}, {time}.")
  AUTO_MINUTES  keep it going, and end the run after this many minutes
  WAIT      seconds to wait for a message before the run ends (default 300)
  AUTOCOMPACT  when the agent's memory holds this many tokens, Claude Code shortens it to a
            summary (default and smallest possible value: 100000)
"""
import json
import os
import re
import signal
import subprocess
import sys
import time

import story

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "runs", os.environ.get("RUN_ID") or time.strftime("%Y%m%d-%H%M%S"))
PROMPT = os.environ.get("PROMPT") or "Live! You have 1 hour. If you stop, you die."
WAIT = int(os.environ.get("WAIT", 300))
AUTO_MAX = int(os.environ.get("AUTO_MAX", story.AUTO_MAX))
KEEP = "It is {day}, {time}."  # what keeps the agent going, unless something else is chosen


def path(name):
    return os.path.join(RUN, name)


def write(name, text=""):
    with open(path(name), "w") as f:
        f.write(text)


os.makedirs(RUN, exist_ok=True)
os.makedirs("/tmp/w", exist_ok=True)  # a neutral working directory: the path tells the agent nothing
write("prompt.txt", PROMPT + "\n")
write("pid", str(os.getpid()))  # so the viewer can end this run
if os.environ.get("AUTO") or os.environ.get("AUTO_MINUTES"):
    write("auto", story.auto_text(float(os.environ.get("AUTO_MINUTES") or 0), os.environ.get("AUTO_TEXT") or KEEP))
# Tell Claude Code how to start the world, and pass the world settings along.
world_settings = {k: v for k, v in os.environ.items() if k.startswith("WORLD")}
write("mcp.json", json.dumps({"mcpServers": {"world": {
    "command": "python3", "args": [os.path.join(HERE, "mcp_server.py")],
    "env": {**world_settings, "WORLD_LOG": path("protocol.jsonl")}}}}))

# The empty agent: no built-in tools, no settings, no skills, no memory. It may only
# use the world's tools. Its thinking is recorded as a summary. It reads what it is
# told from its input, one message per line, so it can be told more after it stops.
def new_agent():
    return subprocess.Popen(
        ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
         "--system-prompt", os.environ.get("SYSTEM_PROMPT", ""),
         "--model", os.environ.get("MODEL", "opus"),
         "--mcp-config", path("mcp.json"), "--strict-mcp-config",
         "--tools", "", "--allowedTools", "mcp__world",
         "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
         "--thinking-display", "summarized",
         "--autocompact", os.environ.get("AUTOCOMPACT", "100000")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(path("errors.txt"), "a"),
        text=True, cwd="/tmp/w")


agent = new_agent()
transcript = open(path("transcript.jsonl"), "w")
repeats = 0


def filled(text):
    """A message with the day, time and date of this moment filled in."""
    for mark, form in (("{day}", "%A"), ("{time}", "%H:%M"), ("{date}", "%d %B %Y")):
        text = text.replace(mark, time.strftime(form))
    return text


def tell(text):
    agent.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")
    agent.stdin.flush()


def record(event):
    """A line of our own in the transcript, for the story."""
    transcript.write(json.dumps(event) + "\n")
    transcript.flush()


def time_is_up():
    """Has a run with a time limit reached it? Then leave the reason for the story."""
    limit = story.limit(RUN)
    if limit and time.time() >= limit[0]:
        write("stopped", f"The time was up after {limit[1]} minutes")
        return True


def next_message():
    """Wait for the next thing to tell the agent. Returns nothing when the run is over."""
    global repeats
    deadline = time.time() + WAIT
    while time.time() < deadline and not time_is_up():
        if os.path.exists(path("inbox")):  # someone wrote a message; an empty one means "repeat"
            with open(path("inbox")) as f:
                text = f.read().strip()
            os.remove(path("inbox"))
            return {"text": filled(text or KEEP), "how": "by hand"}
        # Kept going by itself. Without a time limit, how often is capped instead.
        going = story.auto(RUN)
        text = going and (going["text"] or KEEP)
        count = going and re.search(r"\{countdown:(\d+)\}", text)
        if count:  # one less every time; the run ends instead of saying 0
            left = int(count[1]) - repeats
            if left <= 0:
                write("stopped", "The countdown reached 0")
                return None
            text = text.replace(count[0], str(left))
        if going and (going["until"] or count or repeats < AUTO_MAX):
            repeats += 1
            return {"text": filled(text), "how": "auto"}
        time.sleep(0.3)


signal.signal(signal.SIGTERM, lambda *_: sys.exit())  # the viewer's "End run"
try:
    tell(filled(PROMPT))
    while line := agent.stdout.readline():
        transcript.write(line)
        transcript.flush()
        if os.path.exists(path("died")):  # the agent died in its world (see mcp_server.py)
            os.remove(path("died"))
            agent.terminate()
            agent.wait()
            agent = new_agent()  # a new one, with an empty memory, in the world as it was left
            record({"type": "died"})
            record({"type": "told", "text": filled(PROMPT), "how": "new life"})
            tell(filled(PROMPT))
            continue
        if time_is_up() or os.path.exists(path("stopped")):  # ... or the world has stopped (see mcp_server.py)
            break
        if json.loads(line).get("type") == "result":  # the agent has stopped
            message = next_message()
            if not message:
                break
            record({"type": "told", **message})
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
