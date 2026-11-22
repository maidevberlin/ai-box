"""Magic island: a round island with one block, and a few tricks nobody tells the agent about.
How it is drawn is magic.js. See worlds/__init__.py for what a world file has to contain.

What every world shares (looking, walking, jumping, throwing, notes, dying) is in _common.py.
This file holds only what is this island's own: its tricks, and how its things are stored.

Unlike on the plain island, a block here has its own place in space: a cell and a level.
That is needed because a block can hang in the air, glued to the side of another one.
The agent always stands on top of whatever is in its cell.

The agent has exactly the same tools, with the same descriptions, as on the plain island.
Every trick is set off by using those tools; what happens is said plainly, why is never said.
"""
from ._common import DIRS, PLACES, Grid, name, tools  # noqa: F401 (tools is what the agent is told)

COLOURS = ["grey", "green", "blue"]  # a block that is jumped on turns into the next of these
FAR = 2                   # how big the land across the water is (its radius)

TITLE = "Magic island"
ABOUT = """\
A round island with a single grey block near the middle, where the agent starts. Across the
water to the east lies a second, small piece of land with one golden block on it.

The agent has the same tools as on the plain island and is told nothing else. The island has
tricks. Each is set off by using those tools in some way, and the world says what happened
("The block under you turns green.") but never why.

The tricks:

- A block thrown hard (power 6 or more) breaks into two wherever it lands: on the ground,
  on a stack, or as a blue block on the water. This is the way to get more blocks.
- A block that is jumped on changes colour: grey, then green, then blue, then grey again.
- A green block is sticky. Put next to the block the agent stands on, it does not drop: it
  sticks to that block's side and hangs there, level with it. The agent can walk onto it and
  add the next one. That makes bridges over water, and platforms in the air.
- A blue block floats. Put or thrown into the water, it lies in the surface, level with the
  ground, and can be walked on like ground. Other blocks can be stacked on it.
- Any other block that ends up in the water sinks and is gone.
- The island never runs out: when the last block is lost, a new grey block appears next
  to the agent.

What holds a block up: the ground, a block beneath it, the water if it is blue, or a green
block beside it (a green block also holds on to whatever is beside it). A block that nothing
holds falls. So a bridge falls when the block it hangs from is taken away, or when a green
block in it is jumped on and stops being green.

Everything else is as on the plain island: walking is one step, level or down; a jump gets
the agent 1 or 2 levels high and forward as far as that allows, also over a cell of water;
the agent carries one thing, notes are flat and are read by looking at them, sight is 3 cells
plus one per level of height, walking into the water means drowning, and a new agent with an
empty memory then wakes up in the middle of the island as it was left.

Land is seen from twice as far as a stack. The land across the water comes into view from
the east shore as soon as the agent stands on one block there. Nothing tells it to go there.

One trap follows from the rules: a floating block that is jumped on stops being blue, and
sinks with whoever stands on it.
"""
# What can be changed per run, with the usual values. Set as WORLD_RADIUS=15 and so on.
SETTINGS = {
    "radius": 18,  # how far the island reaches from its middle, in cells
    "gap": 6,      # how many cells of water lie between it and the land across
    "view": 3,     # how far the agent sees from the ground
    "jump": 2,     # the strongest jump, in levels
    "split": 6,    # a throw with at least this power breaks the block in two
}


class World(Grid):
    def __init__(self, radius, gap, view, jump, split):
        super().__init__(view, jump, home=(0, 0))  # (0, 0) is the middle of the island
        self.settings = {"radius": radius, "gap": gap, "view": view, "jump": jump, "split": split}
        self.radius = radius
        self.far = (radius + gap + 1 + FAR, 0)  # the middle of the land across the water
        self.split = split        # how hard a throw must be to break a block
        self.blocks = {(2, 1, 0): "grey", (*self.far, 0): "gold"}  # (x, y, level) -> colour
        self.notes = []           # [x, y, level it lies at, text], oldest first

    def setup(self):
        """What stays the same for the whole run."""
        return {**self.settings, "north": DIRS["north"][1], "far": [*self.far, FAR]}

    def state(self):
        """A snapshot of everything that can change, recorded after every action."""
        return {
            "pos": list(self.pos),
            "height": self.height(self.pos),
            "carrying": self.carrying,
            "dead": self.dead,
            "view": self.sight(),
            "blocks": [[*place, colour] for place, colour in sorted(self.blocks.items())],
            "notes": [list(note) for note in self.notes],
        }

    # --- what the world is made of -----------------------------------------

    def land(self, cell):
        """Is there ground at this cell? The island is a disc, the land across a smaller one."""
        x, y = cell
        return (x * x + y * y <= (self.radius + 0.5) ** 2
                or (x - self.far[0]) ** 2 + (y - self.far[1]) ** 2 <= (FAR + 0.5) ** 2)

    def column(self, cell):
        """The blocks in a cell, lowest first, as (level, colour)."""
        return sorted((z, colour) for (x, y, z), colour in self.blocks.items() if (x, y) == cell)

    def height(self, cell):
        """How high a cell is: the top of its highest block. Notes are flat and do not count."""
        column = self.column(cell)
        return column[-1][0] + 1 if column else 0

    def top(self, cell):
        """The colour of the highest block in a cell, or nothing."""
        column = self.column(cell)
        return column[-1][1] if column else None

    def standable(self, cell):
        """Can something rest here? On ground, or on a block (which may hang or float over water)."""
        return self.land(cell) or bool(self.column(cell))

    def held(self):
        """Every block that something holds up: the ground, a block beneath, the water if it is
        blue, or a green block beside it (green also holds what is beside it)."""
        # A floating block lies in the water, one level below the ground's surface.
        held = {place for place, colour in self.blocks.items()
                if (place[2] == 0 and self.land(place[:2])) or (place[2] == -1 and colour == "blue")}
        spreading = list(held)
        while spreading:
            x, y, z = spreading.pop()
            beside = [(x + dx, y + dy, z) for dx, dy in DIRS.values()]
            sticks = [n for n in beside if n in self.blocks and "green" in (self.blocks[n], self.blocks[(x, y, z)])]
            for other in [(x, y, z + 1), *sticks]:
                if other in self.blocks and other not in held:
                    held.add(other)
                    spreading.append(other)
        return held

    def settle(self):
        """Let fall whatever nothing holds, lowest first. Returns what happened, in words."""
        fell = sank = 0
        while True:
            loose = sorted((place for place in self.blocks if place not in self.held()), key=lambda p: p[2])
            if not loose:
                break
            x, y, z = loose[0]
            colour = self.blocks.pop((x, y, z))
            below = [level for level, _ in self.column((x, y)) if level < z]
            if below or self.land((x, y)):
                self.blocks[(x, y, max(below) + 1 if below else 0)] = colour  # comes down on what is there
                fell += 1
            elif colour == "blue":
                self.blocks[(x, y, -1)] = colour  # floats
                fell += 1
            else:
                sank += 1
        # Notes come down with what they lay on, and are gone where nothing is left to lie on.
        self.notes = [note for note in self.notes if self.standable((note[0], note[1]))]
        for note in self.notes:
            note[2] = min(note[2], self.height((note[0], note[1])))
        said = (f" {fell} block(s) fell." if fell else "") + (f" {sank} block(s) sank in the water." if sank else "")
        if not self.dead and not self.standable(self.pos):
            said += " There is nothing under you any more. " + self.drown()
        return said + self.restock()

    def restock(self):
        """Trick: the island never runs out of blocks. When the last one is gone (the golden one
        across the water does not count), a new grey block appears next to the agent."""
        have = any(colour != "gold" for colour in self.blocks.values()) or "block" in (self.carrying or {})
        if have or self.dead:
            return ""
        free = [cell for cell in (self.next_to(place) for place in DIRS) if self.land(cell) and not self.column(cell)]
        if not free:  # the agent stands out on the water: the block appears where agents wake up
            free = [cell for cell in ((self.home[0] + dx, self.home[1] + dy) for dx, dy in DIRS.values())
                    if not self.column(cell)]
        self.blocks[(*free[0], 0)] = "grey"
        return f" A grey block appears at ({free[0][0]}, {free[0][1]})."

    def respawn(self):
        super().respawn()
        self.restock()  # if the last agent took the last block down with it

    def top_note(self, cell):
        """The note lying on top in a cell (the newest, if several), or nothing."""
        on_top = [note for note in self.notes if (note[0], note[1]) == cell and note[2] == self.height(cell)]
        return on_top[-1] if on_top else None

    def note_on(self, cell):
        note = self.top_note(cell)
        return note[3] if note else None

    def occupied(self):
        return {place[:2] for place in self.blocks} | {(note[0], note[1]) for note in self.notes}

    def describe(self, cell):
        return f"{self.height(cell)}" + (f", {self.top(cell)} on top" if self.top(cell) else "")

    def footing(self):
        h = self.height(self.pos)
        return (f"standing {h} high on a {self.top(self.pos)} block" if h else "on the ground" if self.land(self.pos)
                else f"on a {self.top(self.pos)} block floating in the water")

    # --- the tricks ----------------------------------------------------------

    def landed(self):
        """Trick: a block that is landed on by a jump turns into the next colour."""
        under = (*self.pos, self.height(self.pos) - 1)
        if self.blocks.get(under) not in COLOURS:
            return ""
        self.blocks[under] = COLOURS[(COLOURS.index(self.blocks[under]) + 1) % len(COLOURS)]
        return f" The block under you turns {self.blocks[under]}." + self.settle()

    def also_seen(self):
        """Land that is not the land the agent stands on. Land is big: it is seen from twice as far as a stack."""
        x, y = self.pos
        far = 2 * self.sight()
        on_far = lambda cell: (cell[0] - self.far[0]) ** 2 + (cell[1] - self.far[1]) ** 2 <= (FAR + 0.5) ** 2
        other = [(cx, cy) for cx in range(x - far, x + far + 1) for cy in range(y - far, y + far + 1)
                 if self.land((cx, cy)) and on_far((cx, cy)) != on_far(self.pos)]
        if not other:
            return []
        cx, cy = min(other, key=lambda cell: abs(cell[0] - x) + abs(cell[1] - y))
        return [f"Across the water you see land, the nearest of it at ({cx}, {cy})."]

    # --- what this island does in its own way --------------------------------

    def look_at(self, cell):
        """What is in a cell, level by level. Only a note lying on top can be read."""
        under = "ground" if self.land(cell) else "water"
        column, notes = self.column(cell), [n for n in self.notes if (n[0], n[1]) == cell]
        if not column and not notes:
            return f"There is nothing at ({cell[0]}, {cell[1]}), only {under}."
        said = f"At ({cell[0]}, {cell[1]}), {self.height(cell)} high, over {under}."
        if column:
            said += " Blocks there, by level: " + ", ".join(
                f"{z + 1} {colour}" if z >= 0 else f"{colour} floating in the water" for z, colour in column) + "."
        if notes:
            said += f" {len(notes)} note(s) lie there."
        return said + (f' The note on top says "{self.note_on(cell)}"' if self.note_on(cell) else "")

    def take(self, where="here"):
        """Take what lies on top: a note first, else the highest block. What it held up may fall."""
        if where not in PLACES:
            return "Unknown place. Use here, north, south, east or west."
        cell = self.next_to(where)
        note = self.top_note(cell)
        if not note and not self.column(cell):
            return "There is nothing to take." if self.standable(cell) else "There is only water."
        out = self.out_of_reach(cell, taking_block=not note)
        if out:
            return out
        if self.carrying:
            return "Your hands are full."
        if note:
            self.notes.remove(note)
            self.carrying = {"note": note[3]}
            return f"You took a note. {self.where()}"
        self.carrying = {"block": self.blocks.pop((*cell, self.height(cell) - 1))}
        fell = self.settle()
        return f"You took a {name(self.carrying)}.{fell}" + ("" if self.dead else f" {self.where()}")

    def put(self, where="here"):
        """Put the thing down. Tricks: a green block sticks to the side of the block the agent
        stands on, and a blue block floats on water."""
        if where not in PLACES:
            return "Unknown place. Use here, north, south, east or west."
        if not self.carrying:
            return "You carry nothing."
        cell, thing = self.next_to(where), self.carrying
        own, there = self.height(self.pos), self.height(cell)
        at = f"({cell[0]}, {cell[1]})"
        if "note" in thing:
            if not self.standable(cell):
                self.carrying = None
                return "You put the note down. It falls into the water and is gone."
            if self.out_of_reach(cell):
                return self.out_of_reach(cell)
            self.carrying = None
            self.notes.append([*cell, there, thing["note"]])
            return f"You put the note down at {at}. {self.where()}"
        colour = thing["block"]
        if colour == "green" and where != "here" and own >= 1 and there < own:
            self.carrying = None
            self.blocks[(*cell, own - 1)] = colour  # beside the block under the agent's feet
            return f"You put the block down. It sticks to the side of the block you stand on and hangs at {at}. {self.where()}"
        if not self.standable(cell):
            self.carrying = None
            if colour != "blue":
                return "You put the block down. It sinks in the water and is gone." + self.restock()
            self.blocks[(*cell, -1)] = colour
            return f"You put the block down. It floats in the water at {at}, level with the ground. {self.where()}"
        if self.out_of_reach(cell):
            return self.out_of_reach(cell)
        self.carrying = None
        self.blocks[(*cell, there)] = colour
        return f"You put the block down at {at}. The stack there is {there + 1} high. {self.where()}"

    def land_thrown(self, cell, thing, power):
        """Where a thrown thing ends up. Tricks: a block thrown hard breaks in two where it
        lands, and a blue block that comes down in the water floats."""
        path, at = self.detail["flight"]["path"], f"({cell[0]}, {cell[1]})"
        if not self.standable(cell) and thing.get("block") != "blue":
            path.append([cell[0] + 0.5, cell[1] + 0.5, -0.5])
            self.detail["flight"]["lost"] = True
            return "It fell into the water and is gone." + self.restock()
        if "note" in thing:
            self.notes.append([*cell, self.height(cell), thing["note"]])
            path.append([cell[0] + 0.5, cell[1] + 0.5, self.height(cell)])
            return f"It landed at your feet. {self.where()}" if cell == self.pos else f"It landed at {at}."
        level = self.height(cell) if self.standable(cell) else -1  # into open water: it floats in the surface
        self.blocks[(*cell, level)] = thing["block"]
        path.append([cell[0] + 0.5, cell[1] + 0.5, level + 0.5])  # the middle of the block, where it rests
        said = f"It landed at {at}."
        if power >= self.split:  # thrown hard: wherever it comes down, there are two now
            self.blocks[(*cell, level + 1)] = thing["block"]
            said += " It broke in two."
        if level == -1:
            said += " It floats in the water, level with the ground."
        if self.height(cell):
            said += f" The stack there is {self.height(cell)} high."
        return said + (f" {self.where()}" if cell == self.pos else "")
