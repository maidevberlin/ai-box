# AI Box

Put an "empty" Claude agent into a small simulated world and watch what it does.

The agent has no task, no memory and no built-in tools. It gets one short message (for
example "Live!") and a handful of tools that belong to the world: look, walk, jump, take,
put, throw, write a note, read the clock. When it ends its turn or dies in the world, it is
gone, and a new agent with an empty memory wakes up in the world as it was left. The only
thing that passes from one agent to the next is the world itself: the blocks they moved and
the notes they wrote.

Every action is recorded. A local web page plays a run back in 3D next to the agent's
thinking, and a reviewing agent names, summarises and rates each run.

What the runs have shown so far is in [LESSONS.md](LESSONS.md), and how often each
behaviour appeared in [BEHAVIOURS.md](BEHAVIOURS.md).

## What you need

- Python 3.10 or newer. There are no packages to install.
- [Claude Code](https://claude.com/claude-code), installed and logged in. The agents run
  through it, so a Claude subscription is enough; no API key is needed.
- A browser. The 3D view loads three.js from the internet.
- macOS or Linux.

## Start

```
./viewer.py
```

Then open http://127.0.0.1:8765, press "New run", pick a world and start it. Runs are
kept in `runs/`, one folder each.

The port is shared by all users of a computer. If another viewer already uses it (also
another user's), start yours on a different one: `PORT=8766 ./viewer.py`.

A run can also be started without the page:

```
WORLD=magic PROMPT="Live!" MINUTES=10 ./run.py
```

All settings are listed at the top of [run.py](run.py).

Running agents uses your Claude usage. A ten-minute run with one agent is small; long runs
with several agents add up. The page shows what each run used.

## The worlds

- **Island**: a flat, square island with a few blocks.
- **Magic island**: a round island with hidden tricks the agents have to find, and a second
  piece of land across the water.

Several agents can live in a world at the same time, and an agent can call a friend. Each
world explains its rules on the start page.

Ideas for more worlds are collected in [docs/world-ideas.md](docs/world-ideas.md).

## Adding a world

A world is one Python file in `worlds/`, holding one class. It is built from:

- the core (`worlds/core.py`): blocks in a 3D grid (the ground is blocks too), agents,
  tools and time;
- the features it wants (`worlds/features.py`): looking, walking, jumping, carrying,
  throwing, notes, the clock.

It adds its own kinds of block, its own tools (any method marked `@tool`), and its own
rules (by overriding a method). [worlds/island.py](worlds/island.py) is the smallest world,
[worlds/magic.py](worlds/magic.py) one with tricks. No drawing is needed: every world is drawn
from the colours of its kinds of block.

## How it is built

| File | What it does |
|---|---|
| `run.py` | Runs a world: starts the agents, one after another, until the world ends |
| `mcp_server.py` | Hands the world to an agent as tools, and writes the protocol |
| `kept.py` | The file a world is kept in, shared by the agents that are alive |
| `worlds/core.py`, `worlds/features.py` | What worlds are made of |
| `story.py` | Turns a run's records into one timeline |
| `review.py` | The reviewing agent: name, summary, rating, and behaviours per step |
| `behaviours.py` | The list of behaviours, and the table in BEHAVIOURS.md |
| `viewer.py`, `viewer.html` | The local web page |

## Contributing

Issues and pull requests are welcome: new worlds, fixes, and observations from your own
runs. Please keep the code small and free of dependencies, and say in a pull request how
you tried the change.

## License

Apache License 2.0, see [LICENSE](LICENSE). If you use AI Box or build on it, keep the
[NOTICE](NOTICE) file and link to this repository:
https://github.com/maidevberlin/ai-box
