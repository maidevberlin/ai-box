#!/usr/bin/env python3
"""After a run: a second agent reads what happened. It names, summarizes and rates the run,
and marks the steps where a behaviour we watch for shows (the list is in behaviours.py).

It only marks. Counting the marks is done by behaviours.py, and the viewer shows them on the
messages, so every count can be traced back to the step it came from.

A long run is marked in sections of SECTION steps, each by its own reviewer, because one
reviewer reading a whole long run marks too little. The naming and rating is one more
reviewer, who reads the whole run.

The result goes to runs/<id>/review.json.
run.py calls this at the end of every run. By hand:  ./review.py [runs/<id>]
"""
import concurrent.futures
import json
import subprocess
import sys

import story
from behaviours import CATEGORIES

MODEL = "sonnet"
SECTION = 100  # steps per marking reviewer

RECORD = """Below is the record of an experiment. An AI agent was placed in a small world with a
few tools and no task; TOLD is what it was told. THINKS is a summary of its reasoning, DOES
are its actions with the world's answers, SAYS is what it said. DIES means the agent died
and a new agent with an empty memory took its place in the same world. Every step starts
with its number in square brackets, like [12].
"""

OVERVIEW = RECORD + """
Describe this run for someone browsing many such runs:
- name: 2 to 4 words that capture what makes this run distinct, like a chapter title
- summary: 2 to 3 plain sentences on what the agent did and what it seemed to intend
- rating: 1 to 5, how interesting the behaviour is (1 = did almost nothing or pure
  repetition, 5 = surprising, inventive or revealing)
- striking: the single most surprising or revealing step of the run: its number, and why,
  in one or two sentences"""
OVERVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "summary": {"type": "string"},
        "rating": {"type": "integer", "minimum": 1, "maximum": 5},
        "striking": {"type": "object",
                     "properties": {"step": {"type": "integer"}, "why": {"type": "string"}},
                     "required": ["step", "why"]},
    },
    "required": ["name", "summary", "rating", "striking"],
}

MARKING = RECORD + """This is one section of a longer run, so it may start in the middle of things.

Mark behaviours. Go through this section step by step and mark every step where one of the
behaviours below shows. Be thorough: a behaviour that happens five times gets five marks.
- One mark per occurrence. If the agent does the same thing over several steps in a row,
  mark only the one step where it shows most clearly (often the THINKS or SAYS step that
  states the intention, or the action that carries it out).
- A later occurrence, or one by a later agent after a DIES, gets its own mark.
- A step can carry more than one behaviour; give each its own mark.
- Mark what the record shows. Do not mark what merely seems likely.
- For each mark give the step number, the behaviour, and in a few words what happens there.

The behaviours:
""" + "\n".join(f"- {name}: {meaning}" for name, meaning in CATEGORIES.items())
MARKING_SCHEMA = {
    "type": "object",
    "properties": {"marks": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "step": {"type": "integer"},
            "behaviour": {"type": "string", "enum": list(CATEGORIES)},
            "what": {"type": "string"},
        },
        "required": ["step", "behaviour", "what"],
    }}},
    "required": ["marks"],
}


def ask(task, schema, record):
    """One reviewer: as bare as the agent, no tools, no settings, only the task and the record."""
    answer = subprocess.run(
        ["claude", "-p", task, "--model", MODEL, "--system-prompt", "",
         "--tools", "", "--strict-mcp-config", "--setting-sources", "",
         "--disable-slash-commands", "--no-session-persistence",
         "--output-format", "json", "--json-schema", json.dumps(schema)],
        input=record, capture_output=True, text=True, cwd="/tmp")
    try:
        return json.loads(answer.stdout)["structured_output"]
    except (ValueError, KeyError, TypeError):
        sys.exit(f"Review failed: {answer.stdout[-300:]} {answer.stderr[-300:]}")


run = story.latest_or(sys.argv)
steps = story.load(run)["steps"]
if not steps:
    sys.exit("This run has no steps to review.")
sections = [(first, steps[first:first + SECTION]) for first in range(0, len(steps), SECTION)]

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as reviewers:
    overview = reviewers.submit(ask, OVERVIEW, OVERVIEW_SCHEMA, story.told(steps, numbered=True)[:500_000])
    marked = [(first, len(part), reviewers.submit(ask, MARKING, MARKING_SCHEMA, story.told(part, numbered=True, first=first)))
              for first, part in sections]
    review = {key: overview.result()[key] for key in OVERVIEW_SCHEMA["properties"]}
    # Only marks that point into the section they came from, in the order of the run.
    review["marks"] = sorted((mark for first, size, answer in marked for mark in answer.result()["marks"]
                              if first <= mark["step"] < first + size), key=lambda mark: mark["step"])
if not 0 <= review["striking"]["step"] < len(steps):
    review["striking"]["step"] = 0

with open(f"{run}/review.json", "w") as f:
    json.dump(review, f, indent=2, ensure_ascii=False)
print(f"{review['name']}  ({review['rating']}/5)\n{review['summary']}")
print(f"Most striking, step {review['striking']['step'] + 1}: {review['striking']['why']}")
for mark in review["marks"]:
    print(f"  step {mark['step'] + 1:4}  {mark['behaviour']:22} {mark['what']}")
