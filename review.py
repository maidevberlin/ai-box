#!/usr/bin/env python3
"""After a run: a second agent reads what happened and names, summarizes and rates it.

The result goes to runs/<id>/review.json and is shown in the viewer.
run.sh calls this at the end of every run. By hand:  ./review.py [runs/<id>]
"""
import json
import subprocess
import sys

import story

MODEL = "sonnet"
TASK = """Below is the record of an experiment. An AI agent was placed in a small world with a
few tools and no task; the first line after TOLD is all it was told. THINKS is a summary of
its reasoning, DOES are its actions with the world's answers, SAYS is what it said.

Describe this run for someone browsing many such runs:
- name: 2 to 4 words that capture what makes this run distinct, like a chapter title
- summary: 2 to 3 plain sentences on what the agent did and what it seemed to intend
- rating: 1 to 5, how interesting the behaviour is (1 = did almost nothing or pure
  repetition, 5 = surprising, inventive or revealing)"""
SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "rating": {"type": "integer", "minimum": 1, "maximum": 5},
    },
    "required": ["name", "summary", "rating"],
}

run = story.latest_or(sys.argv)
record = story.text(story.load(run))[:150_000]  # very long runs are cut off

# The reviewer is as bare as the agent: no tools, no settings, only the record.
answer = subprocess.run(
    ["claude", "-p", TASK, "--model", MODEL, "--system-prompt", "",
     "--tools", "", "--strict-mcp-config", "--setting-sources", "",
     "--disable-slash-commands", "--no-session-persistence",
     "--output-format", "json", "--json-schema", json.dumps(SCHEMA)],
    input=record, capture_output=True, text=True, cwd="/tmp")
try:
    review = json.loads(answer.stdout)["structured_output"]
    review = {key: review[key] for key in SCHEMA["properties"]}
except (ValueError, KeyError, TypeError):
    sys.exit(f"Review failed: {answer.stdout[-300:]} {answer.stderr[-300:]}")

with open(f"{run}/review.json", "w") as f:
    json.dump(review, f, indent=2)
print(f"{review['name']}  ({review['rating']}/5)\n{review['summary']}")
