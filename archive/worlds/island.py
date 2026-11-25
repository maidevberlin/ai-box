"""Island: the plain world. The core and the usual features, and nothing else.

The smallest example of a world: the blocks it is made of, its settings, and make().
"""
import random

from .core import Kind, World
from .features import Carrying, Clock, Jumping, Looking, Throwing, Walking, Writing


class Island(Looking, Clock, Writing, Walking, Jumping, Carrying, Throwing, World):
    TITLE = "Island"
    ABOUT = """\
A flat, square island surrounded by water. The agent starts in the middle. A few grey
blocks lie scattered around at random. The agent stands on top of whatever is in its cell.

This is the plain world: only the core and the usual features, with no tricks of its own.
Other worlds are built from the same parts.

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
  the ground or on a stack. It never makes a stack higher.
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
        "loose": 10,   # how many blocks lie around at the start
        "view": 3,     # how far an agent sees from the ground
        "jump_height": 2,  # the strongest jump, in levels
        "seed": None,  # the same seed gives the same starting world
    }
    KINDS = {
        "ground": Kind(colour="#4f8f34", ground=True),
        "grey": Kind(colour="#8a919c", called="block"),
    }

    def make(self):
        """A square of ground, with (0, 0) at its south-west corner, and blocks lying around."""
        self.HOME = (self.size // 2, self.size // 2)
        for x, y in self.square(self.size, middle=self.HOME):
            self.put_block(x, y, -1, "ground")
        rng = random.Random(self.seed)
        for _ in range(self.loose):
            cell = (rng.randrange(self.size), rng.randrange(self.size))
            self.put_block(*cell, self.height(cell), "grey")
