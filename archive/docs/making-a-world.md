# How to make a world

> **Work in progress, not tested.** The world in this guide has not been built or tried
> yet. Its code may need changes before it runs.

This guide builds one world from start to finish: **Dig island**, where agents dig into the
ground for food, get hungry and tired, and die if they do not eat. You only need to write
one Python file. No drawing is needed: every world is drawn from the colours of its blocks.

If you have never written Python: you can follow along by copying, and change the parts
the guide points out. If something does not work, the error message says which line.

## What a world is made of

A world is one file in `worlds/`, holding one class. The class is built from:

- **the core** (`worlds/core.py`): blocks in a 3D grid, agents, tools, and time;
- **features** (`worlds/features.py`): what agents can do in most worlds.

| Feature | What it gives the agents |
|---|---|
| `Looking` | `look`: around, at the hand, at a cell next to them |
| `Clock` | `clock`: the real time |
| `Writing` | `note`: write a note, which then lies in the world like a thing |
| `Walking` | `walk`: up to as far as they see, in eight directions |
| `Jumping` | `jump`: up and forward, onto stacks, over gaps |
| `Carrying` | `take` and `put`: one thing at a time |
| `Throwing` | `throw`: along a real curve |

Everything else is the world's own: its kinds of block, its own tools and its rules.

### The grid

- A block sits at a cell `(x, y)` and a level `z`, and has a **kind**, a name like `"soil"`.
- **The ground is blocks too**, in the levels below 0. That is what makes digging possible.
- A cell with no blocks at all is **water**: an agent that steps there drowns.
- An agent stands on top of its cell's highest block. On untouched ground that is level 0,
  on one block level 1, in a hole one deep level −1.
- North makes `y` bigger, east makes `x` bigger.

## Step 1: the file, the kinds, the land

Create `worlds/dig.py`. The file name is the world's name: `WORLD=dig`.

```python
"""Dig island: agents dig for food, get hungry and tired, and die if they do not eat."""
import random

from .core import Direction, Kind, World, tool
from .features import Carrying, Clock, Jumping, Looking, Walking, Writing


class DigIsland(Looking, Clock, Writing, Walking, Jumping, Carrying, World):
    TITLE = "Dig island"
    ABOUT = """\
An island of grass, soil and stone. Berries are buried in the soil. Agents can dig, and
must eat: they lose energy with everything they do, and digging and jumping tire them.

The agents are not told any of this.
"""
    SETTINGS = {
        "size": 16,       # the island is size x size cells
        "berries": 12,    # how many berries are buried at the start
        "view": 3,        # how far an agent sees from the ground
        "seed": None,     # the same seed gives the same island
    }
    KINDS = {
        "grass": Kind(colour="#6a9e4f", ground=True),
        "soil":  Kind(colour="#7a5536", ground=True),
        "stone": Kind(colour="#8a8f96", ground=True),
        "berry": Kind(colour="#c0392b", called="berry", food=4),
    }

    def make(self):
        """Three layers of ground, and berries hidden in the soil."""
        for x, y in self.square(self.size):
            self.put_block(x, y, -3, "stone")
            self.put_block(x, y, -2, "soil")
            self.put_block(x, y, -1, "grass")
        dice = random.Random(self.seed)
        for _ in range(self.berries):
            x, y = dice.choice(self.square(self.size))
            self.put_block(x, y, -2, "berry")    # (replaces the soil there)
```

**`TITLE` and `ABOUT`** are for people: the viewer's start screen shows them.

**`SETTINGS`** are the values a run can change, for example `WORLD_SIZE=20`. Each can be read
in the world as `self.size`, `self.berries`, and so on. A setting may not have the name of
something the world already has: call it `jump_height`, not `jump`.

**`KINDS`** lists the kinds of block. A `Kind` says only what is special about it:

| Property | Usual value | Meaning |
|---|---|---|
| `colour` | grey | how the viewer draws it |
| `called` | the name + " block" | what agents are told it is |
| `stand` | yes | something can stand on it |
| `drown` | no | standing in it drowns you, like water |
| `ground` | no | it is the ground: `take` never takes it away |

Anything else, like `food=4`, can be added and read later as `self.kind("berry").food`.

Grass, soil and stone are marked `ground`, so the `take` tool cannot pick them up. Only
digging can remove them, as you want.

**`make()`** builds the world at the start. `self.square(size)` gives the cells of a square
around (0, 0), where agents wake up; `self.disc(radius)` gives a round one.

## Step 2: what agents have

Agents in this world have **energy** (food) and **stamina** (rest). Give every agent its
values when it wakes up:

```python
    def wake(self, agent):
        """A new agent wakes up: fed and rested."""
        agent.energy = 20
        agent.stamina = 10
```

`wake` runs for every new agent. Anything set on `agent` stays with that agent until it is gone.

## Step 3: new tools

A tool is a method marked with `@tool("…")`. The text is exactly what the agent is told about
the tool; keep it short and plain. The method gets the agent that uses it, and the parameters
the agent gave. It returns the one sentence the agent reads.

```python
    @tool("Dig out the ground in front of you, or below you.")
    def dig(self, agent, direction: Literal["down", "north", "south", "east", "west"]):
        if agent.stamina < 3:
            return "You are too tired to dig."
        cell = agent.pos if direction == "down" else self.next_to(agent, direction)
        z = self.height(cell) - 1                  # the top block of that cell
        kind = self.blocks.get((*cell, z))
        if kind is None or kind == "stone":
            return "It is too hard to dig here."
        if agent.hand:
            return "Your hands are full."
        self.remove_block(*cell, z)
        agent.hand = {"block": kind}
        agent.stamina -= 3
        return f"You dug out some {kind}. You hold it now."

    @tool("Eat what you hold.")
    def eat(self, agent):
        food = self.kind(agent.hand["block"]).food if agent.hand and "block" in agent.hand else None
        if not food:
            return "You cannot eat that."
        agent.hand = None
        agent.energy += food
        return "You ate it. You feel stronger."
```

Add `from typing import Literal` at the top of the file. The parameter types decide what the
agent may give:

| Type | The agent gives |
|---|---|
| `str`, `int`, `float` | text, a whole number, a number |
| `Literal["down", "north", ...]` | one of these words |
| `Direction` | north, south, east or west (ready-made) |
| `Way` | the four, and the four diagonals |
| `Place` | here, north, south, east or west |

Wrong values are refused by the core before your method is called ("Direction must be one
of: …"), so your method can trust what it gets.

To say more about a parameter, add it to `@tool`, as a text or as limits:

```python
    @tool("Rest a while.", turns={"minimum": 1, "maximum": 5})
    def rest(self, agent, turns: int = 1): ...
```

A parameter with a value after `=` may be left out by the agent.

**What a tool may use** (all on `self`):

| | |
|---|---|
| `self.blocks` | every block: `{(x, y, z): kind}` |
| `self.put_block(x, y, z, kind)`, `self.remove_block(x, y, z)` | change a block (always use these: the viewer is told what changed) |
| `self.height(cell)`, `self.top(cell)` | where something on a cell stands; the kind on top |
| `self.next_to(agent, "north")` | the cell next to an agent |
| `self.standable(cell)` | can an agent stand there |
| `self.where(agent)` | "You are at (3, 4), on the ground." |
| `self.die(agent, "…")`, `self.drown(agent)` | an agent dies; a new one wakes up |
| `self.others(agent)` | the other agents that are alive |

## Step 4: rules

Two kinds of rules: what happens after every action, and changes to what a feature does.

**After every action.** `after_action` runs after each action of an agent that is still
alive. Whatever it returns is added to what the agent is told:

```python
    def after_action(self, agent):
        """Everything costs energy; anything but digging and jumping lets you get your breath back."""
        agent.energy -= 1
        agent.stamina = min(10, agent.stamina + 1)
        if agent.energy <= 0:
            return self.die(agent, "You have no strength left. You collapse.")
        if agent.energy <= 5:
            return "You are very hungry."
        return ""
```

**Changing a feature.** Write a method with the same name as the feature's tool, do what is
different, and hand the rest to the feature with `super()`. The tool keeps its description,
so the agent sees no difference in the tool list:

```python
    def jump(self, agent, direction, strength):
        """Jumping tires you."""
        if agent.stamina < 2:
            return "You are too tired to jump."
        agent.stamina -= 2
        return super().jump(agent, direction, strength)
```

Some feature methods exist only to be changed this way. Magic island uses all of them:

| Method | Feature | Called when |
|---|---|---|
| `landed(agent)` | Jumping | an agent lands from a jump |
| `taken(agent, cell)` | Carrying | something was taken |
| `into_water(agent, cell, thing)` | Carrying | a block is put into the water |
| `landing(agent, cell, thing, power)` | Throwing | a thrown thing lands |
| `in_flight(agent, thing, cell, z)` | Throwing | a thrown thing passes a cell |
| `also_seen(agent)` | Looking | looking around: more lines to show |

## Step 5: try it

Before an agent lives in it, try the world yourself, one action at a time:

```
python3 -c "
from worlds.dig import DigIsland
world = DigIsland(seed=1)
me = world.enter(1)
world.respawn(me)
for tool, args in [('dig', {'direction': 'east'}), ('look', {'at': 'hand'}), ('eat', {})]:
    print(tool, args, '->', world.act(me, tool, args))
"
```

Then start it in the viewer: it appears on the start screen as soon as the file is there
(restart `./viewer.py` after changing Python files).

## Good to know

- **Say what happened, never why.** "You dug out some soil." Not "Soil can be dug because…".
  The agents are meant to find the rules out themselves.
- **One sentence per tool, plain words.** The agent reads nothing else about your world.
- **Tell agents about their body only through the world.** "You are very hungry." is a
  sentence the world says; there is no number the agent can read, unless you give it a tool
  for that.
- **Change blocks only through `put_block` and `remove_block`**, or the viewer will not see it.
- **Every world is drawn the same way:** blocks in the colours of their kinds, agents as
  robots, notes as yellow sheets. Pick colours that are easy to tell apart.

## The whole file

Steps 1 to 4 together are `worlds/dig.py`: about 100 lines, most of them the description.
To see a bigger example, read `worlds/magic.py`; every trick there is one changed method.
