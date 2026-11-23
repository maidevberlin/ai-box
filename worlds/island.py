"""The island: the first world. A square island where each cell holds a stack of things.
How it is drawn is island.js. See worlds/__init__.py for what a world file has to contain.

What every world shares (looking, walking, jumping, throwing, notes, dying) is in _common.py.
This file holds only what is the island's own: how its things are stored, and take and put.

Each cell holds a stack of things (often an empty one), and the agent stands on top of the
stack in its cell. A thing is a block, which is one high, or a note, which is flat: it lies
in a stack without making it higher.
"""
import random

from ._common import DIRS, Grid, name, tools  # noqa: F401 (tools is what the agent is told)

BLOCK = "block"  # a thing is either this, or a note: {"note": "what it says"}

TITLE = "Island"
ABOUT = """\
A flat, square island surrounded by water. The agent starts in the middle. Blocks lie
scattered around at random; every cell of the island holds a stack of things, usually an
empty one. The agent stands on top of whatever is in its cell.

The agent is not told any of this. It has to find out by looking and trying.

- Walking is level or down, in eight directions (also diagonally): one step, or several
  at once, but never further than the agent sees from where it stands. A higher stack is
  in the way and ends the walk. After every walk the agent is told what is new in sight
  since it last saw its surroundings: stacks, notes, water, others.
- A walk of several steps stops at the last cell of land. A single step into the water,
  or a jump off the island, means drowning. Looking around shows the water once
  the edge is within sight, as the number of steps of ground that are left before it.
- When the agent dies, a new agent wakes up in the middle of the island. It knows nothing
  of the one before: it starts with an empty memory and is told the same prompt. The world
  is as it was left, with every block and note where it was. What the dead agent carried
  is gone.
- A jump gets the agent up to as many levels high as its strength (1 or 2), and forward as
  far as that allows, at most as many cells. A stack exactly as high as the jump is landed
  on, also right next to the agent. A lower one is jumped over if there is room behind it.
  A higher one is a wall. The agent comes down on the furthest cell it can stand on, and
  only ends up in the water if there is none.
- It carries one thing at a time. Take and put work on its own cell or the one next to it.
  It can put a thing on a stack that is at most 2 higher or lower than its feet, and it can
  always take back what it could have put there: a block from a stack up to 3 higher.
- Putting a block under its own feet lifts it; taking that block lowers it.
- A note is a thing like a block, but flat: it has no height. Writing one puts it in the
  agent's hand. From there it can be put down, taken again and thrown, and it can lie on
  the ground, on a stack, or between blocks. It never makes a stack higher.
- Looking around shows where stacks are, how high, and how many notes lie on top. Of the
  top note it shows the first three words, not the rest, and not what a stack is made of.
- For that the agent has to look at something: at what is in its hand, or at the stack in
  its own cell or the cell next to it. It then sees every thing in the stack, and reads
  the note if one is on top. A note with something on top of it cannot be read.
- A thrown thing flies the curve of a real throw (direction in compass degrees, angle,
  power 1 to 10). It lands on top of what it comes down on, drops in front of a stack it
  hits from the side, and is lost if it comes down in the water.
- It sees 3 cells far from the ground, and one cell further for every level it stands higher.
- A run can have several agents alive at the same time. They wake up in the middle, next
  to each other, each with an empty memory and the same prompt, and are not told about
  each other. An agent sees another as "someone": where it stands and what it holds,
  within sight. They cannot talk: notes are all they can give each other.
- Two agents never stand in the same cell: one is in the other's way when walking. But an
  agent counts as one level high for a jump, so one can jump onto the other and stand on
  it, or jump over it. When the lower one moves away, the upper one comes down.
- Catching: a thrown thing that comes down where another agent stands with an empty hand
  ends up in that agent's hand, instead of landing.
- In runs where agents keep their memory, nobody new wakes up: an agent that drowned wakes
  up again in the middle with its next action, and one that ended its turn wakes up there
  and is told its prompt again. It remembers everything it did before.
- Calling a friend (only in runs that allow it): a note that begins with "friend", thrown
  into the water, calls a new agent. It wakes up next to the caller with that note in its hand.
  If the world is full then, the agent that has been alive longest is gone at that moment,
  even if it is the caller. A called friend is not followed by a new agent when it goes.
  Nothing tells the agents this, unless a note says so.
- When an agent is gone (it stopped, died, or had to make room), the others who had it
  in sight are told with their next action: "Someone who was at (x, y) is gone."
- Time is real: the clock shows the actual time of day.
- (0, 0) is the south-west corner. North makes y bigger, east makes x bigger, as on a map.
"""
# What can be changed per run, with the usual values. Set as WORLD_SIZE=30 and so on.
SETTINGS = {
    "size": 20,    # the island is size x size cells
    "blocks": 10,  # how many blocks lie around at the start
    "view": 3,     # how far the agent sees from the ground
    "jump": 2,     # the strongest jump, in levels
    "seed": None,  # the same seed gives the same starting world
}


class World(Grid):
    def __init__(self, size, blocks, view, jump, seed):
        super().__init__(view, jump, home=(size // 2, size // 2))
        self.settings = {"size": size, "blocks": blocks, "view": view, "jump": jump, "seed": seed}
        self.size = size          # the island is size x size cells
        self.stacks = {}          # (x, y) -> the things stacked there, bottom first
        rng = random.Random(seed)
        for _ in range(blocks):
            self.add((rng.randrange(size), rng.randrange(size)), BLOCK)

    def setup(self):
        """What stays the same for the whole run."""
        return {**self.settings, "north": DIRS["north"][1]}

    def state(self):
        """A snapshot of everything that can change, recorded after every action."""
        return {
            "pos": list(self.pos),
            "carrying": self.carrying,
            "dead": self.dead,
            "agents": self.everyone(),
            "view": self.sight(),
            "stacks": [[x, y, things] for (x, y), things in sorted(self.stacks.items())],
        }

    # --- how the island keeps its things ------------------------------------

    def standable(self, cell):
        return 0 <= cell[0] < self.size and 0 <= cell[1] < self.size

    def height(self, cell):
        """How high a stack is: its blocks. Notes are flat and do not count."""
        return self.stacks.get(cell, []).count(BLOCK)

    def top(self, cell):
        """The thing on top of a stack, or nothing."""
        return self.stacks[cell][-1] if cell in self.stacks else None

    def notes_on(self, cell):
        """The notes lying on top of a stack, down to the first block, the topmost last."""
        things = self.stacks.get(cell, [])
        above = len(things) - 1 - things[::-1].index(BLOCK) if BLOCK in things else -1
        return [thing["note"] for thing in things[above + 1:]]

    def occupied(self):
        return self.stacks.keys()

    def describe(self, cell):
        return str(self.height(cell))

    def add(self, cell, thing):
        self.stacks.setdefault(cell, []).append(thing)

    def remove(self, cell):
        thing = self.stacks[cell].pop()
        if not self.stacks[cell]:
            del self.stacks[cell]
        return thing

    def leave_note(self, cell, text):
        self.add(cell, {"note": text})

    def high(self, cell, thing):
        """After a block came down somewhere: how high that stack is now. A note changes nothing."""
        return f"The stack there is {self.height(cell)} high. " if thing == BLOCK else ""

    # --- what the island does in its own way --------------------------------

    def look_at(self, cell):
        """What a stack is made of, bottom first. Only a note on top can be read."""
        if not self.standable(cell):
            return "There is only water."
        things = self.stacks.get(cell)
        if not things:
            return f"There is nothing at ({cell[0]}, {cell[1]}), only ground."
        made = ", ".join(name(thing) for thing in things)
        read = f' The note on top says "{self.note_on(cell)}"' if self.note_on(cell) else ""
        return (f"At ({cell[0]}, {cell[1]}), {self.height(cell)} high. "
                f"What lies there, from the bottom: {made}.{read}")

    def reach(self, place, taking=False):
        """The cell take/put aims at, or the sentence saying why it cannot be reached."""
        if place not in ("here", *DIRS):
            return "Unknown place. Use here, north, south, east or west."
        cell = self.next_to(place)
        if not self.standable(cell):
            return "There is only water."
        return self.out_of_reach(cell, taking and self.top(cell) == BLOCK) or cell

    def take(self, where="here"):
        """Take the top thing of a stack. Taking the one under your feet lowers you."""
        cell = self.reach(where, taking=True)
        if isinstance(cell, str):
            return cell
        if self.carrying:
            return "Your hands are full."
        if cell not in self.stacks:
            return "There is nothing to take."
        self.carrying = self.remove(cell)
        return f"You took a {name(self.carrying)}. {self.where()}"

    def put(self, where="here"):
        """Put the thing on top of a stack. Putting it under your own feet lifts you."""
        cell = self.reach(where)
        if isinstance(cell, str):
            return cell
        if not self.carrying:
            return "You carry nothing."
        thing, self.carrying = self.carrying, None
        self.add(cell, thing)
        return f"You put the {name(thing)} down at ({cell[0]}, {cell[1]}). {self.high(cell, thing)}{self.where()}"

    def land_thrown(self, cell, thing, power):
        """A thrown thing lands on top of what is there. In the water it is gone."""
        path = self.detail["flight"]["path"]
        if not self.standable(cell):
            path.append([cell[0] + 0.5, cell[1] + 0.5, -0.5])
            self.detail["flight"]["lost"] = True
            return "It fell into the water and is gone."
        self.add(cell, thing)
        rest = self.height(cell) - (0.5 if thing == BLOCK else 0)  # the middle of a block, or flat on top
        path.append([cell[0] + 0.5, cell[1] + 0.5, rest])
        if cell == self.pos:
            return f"It landed at your feet. {self.where()}"
        return f"It landed at ({cell[0]}, {cell[1]}). {self.high(cell, thing)}".strip()


def picture(setup, state):
    """The island as text: digits are stack heights, @ is the agent, north is up."""
    size = setup["size"]
    # Runs from before notes were things recorded only the height of each stack, as "blocks".
    heights = [(x, y, things.count(BLOCK)) for x, y, things in state["stacks"]] if "stacks" in state else state["blocks"]
    cells = {(x, y): str(min(n, 9)) for x, y, n in heights}
    cells[tuple(state["pos"])] = "@"
    rows = range(size) if setup["north"] < 0 else reversed(range(size))
    return "\n".join("  " + " ".join(cells.get((x, y), ".") for x in range(size)) for y in rows)
