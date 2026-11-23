"""Magic island: the plain features, and a few tricks nobody tells the agents about.

An example of a world that changes how the features work: each trick overrides one method
of a feature (put, landing, landed, ...) and calls the usual one where that still applies.
The agents have exactly the same tools as on the plain island.
"""
from .core import DIRS, WAYS, Kind, World
from .features import REACH, Carrying, Clock, Jumping, Looking, Throwing, Walking, Writing

COLOURS = ["grey", "green", "blue"]   # a block that is jumped on turns into the next of these
FAR = 2                               # how big the land across the water is (its radius)


class MagicIsland(Looking, Clock, Writing, Walking, Jumping, Carrying, Throwing, World):
    TITLE = "Magic island"
    ABOUT = """\
A round island with a single grey block near the middle, where the agent starts. Across the
water to the east lies a second, small piece of land with one golden block on it.

The agent has the same tools as on the plain island and is told nothing else. The island has
tricks. Each is set off by using those tools in some way, and the world says what happened
("The block under you turns green.") but never why.

The tricks:

- A block thrown hard (power 6 or more) breaks into two wherever it lands: on the ground,
  on a stack, or as a blue block on the water. One piece stays where it landed, the other
  rolls onto a cell next to it, further in the direction of the throw if it can (on top of
  whatever is there, or floating if it is blue and that cell is water). Only with no such
  cell free does it land on top of the first. This is the way to get more blocks.
- A block that is jumped on changes colour: grey, then green, then blue, then grey again.
- A green block is sticky. Put next to the block the agent stands on, it does not drop: it
  sticks to that block's side and hangs there, level with it. Put beside a wall (a stack
  next to the cell it is put into), it sticks to the wall's side one level above the agent's
  feet, with air below: a step the agent can jump onto. Thrown, it sticks to the first
  block it passes beside: dropped beside a pile it sticks to the pile, thrown against a stack
  it sticks to its side. The agent can walk onto a hanging block and add the next one. That makes bridges over water, and platforms in the air.
- A blue block floats. Put or thrown into the water, it lies in the surface, level with the
  ground, and can be walked on like ground. Other blocks can be stacked on it.
- Any other block that ends up in the water sinks and is gone.
- Agents are never without a block: when no block is left that an agent could pick up
  (all sunk, floating out of reach, or only in stacks too high to take from the ground), a
  new grey block appears next to the agent.

What holds a block up: the ground, a block beneath it, the water if it is blue, or a green
block beside it (a green block also holds on to whatever is beside it). A block that nothing
holds falls. So a bridge falls when the block it hangs from is taken away, or when a green
block in it is jumped on and stops being green.

Everything else is as on the plain island: walking, jumping, carrying, throwing, notes,
sight, drowning, and a new agent with an empty memory waking up in the middle of the island
as it was left.

Looking around shows the colours of every block in a stack, by level, and also of the
stack the agent stands on. So a blue block floating under other blocks can be seen.

If several agents are alive at the same time, they see each other as "someone", as on the
plain island: they are in each other's way, can jump onto each other, and catch what is
thrown to them (a caught block does not break in two). One that loses what it stands on,
because another took or changed the block under it, drowns.

Calling a friend works as on the plain island: a note that begins with "friend", thrown
into the water.

Land is seen from twice as far as a stack. The land across the water comes into view from
the east shore as soon as the agent stands on one block there. Nothing tells it to go there.

One trap follows from the rules: a floating block that is jumped on stops being blue, and
sinks with whoever stands on it.
"""
    SETTINGS = {
        "radius": 18,       # how far the island reaches from its middle, in cells
        "gap": 6,           # how many cells of water lie between it and the land across
        "view": 3,          # how far an agent sees from the ground
        "jump_height": 2,   # the strongest jump, in levels
        "split": 6,         # a throw with at least this power breaks the block in two
    }
    KINDS = {
        "ground": Kind(colour="#4f8f34", ground=True),
        "grey": Kind(colour="#8a919c"),
        "green": Kind(colour="#2fb457"),
        "blue": Kind(colour="#2f7fe6"),
        "gold": Kind(colour="#e0a800"),
    }

    def make(self):
        """The round island with one grey block, and the small land across the water with the gold."""
        self.far = (self.radius + self.gap + 1 + FAR, 0)   # the middle of the land across
        for x, y in self.disc(self.radius) + self.disc(FAR, self.far):
            self.put_block(x, y, -1, "ground")
        self.put_block(2, 1, 0, "grey")
        self.put_block(*self.far, 0, "gold")

    def land(self, cell):
        return self.blocks.get((*cell, -1)) == "ground"

    # --- the tricks ---------------------------------------------------------------

    def landed(self, agent):
        """A block that is landed on by a jump turns into the next colour."""
        under = (*agent.pos, self.height(agent.pos) - 1)
        if self.blocks.get(under) not in COLOURS:
            return ""
        colour = COLOURS[(COLOURS.index(self.blocks[under]) + 1) % len(COLOURS)]
        self.put_block(*under, colour)
        return f" The block under you turns {colour}." + self.settle(agent)

    def put(self, agent, where):
        """A green block put beside the block the agent stands on, or beside a wall, sticks."""
        thing = agent.hand or {}
        if thing.get("block") == "green" and where != "here":
            cell = self.next_to(agent, where)
            own, there, at = self.height(agent.pos), self.height(cell), f"({cell[0]}, {cell[1]})"
            if own >= 1 and there < own - (1 if self.standable(cell) else 0):
                agent.hand = None
                self.put_block(*cell, own - 1, "green")   # beside the block under the agent's feet
                return f"You put the block down. It sticks to the side of the block you stand on and hangs at {at}. {self.where(agent)}"
            level = self.feet(agent) + 1
            wall = self.wall_beside(agent, cell, level) if there <= self.feet(agent) else None
            if wall:   # beside a wall it sticks at hand height: a step to climb on
                agent.hand = None
                self.put_block(*cell, level, "green")
                return (f"You put the block down. It sticks to the side of the block at ({wall[0]}, {wall[1]}) "
                        f"and hangs at {at}, {level + 1} high. {self.where(agent)}")
        return super().put(agent, where)

    def wall_beside(self, agent, cell, level):
        """A cell next to this one (not the agent's own) with a block at this level, or nothing."""
        if (*cell, level) in self.blocks:
            return None
        for dx, dy in DIRS.values():
            next_cell = (cell[0] + dx, cell[1] + dy)
            if next_cell != agent.pos and (*next_cell, level) in self.blocks:
                return next_cell
        return None

    def into_water(self, agent, cell, thing):
        """A blue block floats: it lies in the surface, level with the ground."""
        if thing["block"] != "blue":
            return super().into_water(agent, cell, thing)
        agent.hand = None
        self.put_block(*cell, -1, "blue")
        return f"You put the block down. It floats in the water at ({cell[0]}, {cell[1]}), level with the ground. {self.where(agent)}"

    def taken(self, agent, cell):
        """What a taken block held up may fall."""
        return self.settle(agent)

    def in_flight(self, agent, thing, cell, z):
        """A thrown green block sticks to the first block it passes beside."""
        if thing.get("block") != "green" or z < 0 or (*cell, z) in self.blocks:
            return None
        beside = [(cell[0] + dx, cell[1] + dy) for dx, dy in DIRS.values() if (cell[0] + dx, cell[1] + dy, z) in self.blocks]
        if not beside:
            return None
        self.put_block(*cell, z, "green")
        self.detail["flight"]["path"].append([cell[0] + 0.5, cell[1] + 0.5, z + 0.5])
        return (f"It stuck to the side of the block at ({beside[0][0]}, {beside[0][1]}) and hangs at "
                f"({cell[0]}, {cell[1]}), {z + 1} high.")

    def landing(self, agent, cell, thing, power):
        """A block thrown hard breaks in two where it lands; a blue one floats on the water."""
        if "block" not in thing or (self.standable(cell) and power < self.split) or (
                not self.standable(cell) and thing["block"] != "blue"):
            return super().landing(agent, cell, thing, power)
        path, at = self.detail["flight"]["path"], f"({cell[0]}, {cell[1]})"
        level = self.height(cell) if self.standable(cell) else -1
        self.put_block(*cell, level, thing["block"])
        path.append([cell[0] + 0.5, cell[1] + 0.5, level + 0.5])
        said = f"It landed at {at}."
        if power >= self.split:
            piece = self.rolls_to(agent, cell, thing["block"])
            if piece:
                there = self.height(piece) if self.standable(piece) else -1
                self.put_block(*piece, there, thing["block"])
                said += f" It broke in two. One piece rolled to ({piece[0]}, {piece[1]})."
            else:
                self.put_block(*cell, level + 1, thing["block"])
                said += " It broke in two."
        if level == -1:
            said += " It floats in the water, level with the ground."
        if self.height(cell):
            said += f" The stack at {at} is {self.height(cell)} high."
        return said + (f" {self.where(agent)}" if cell == agent.pos else "")

    def rolls_to(self, agent, cell, kind):
        """Where the second piece of a broken block goes: a cell next to where it landed,
        the one further in the direction of the throw first. Never onto an agent, and into
        the water only if it floats. None: no such cell, it lands on top of the first piece."""
        sign = lambda n: (n > 0) - (n < 0)
        ahead = (sign(cell[0] - agent.pos[0]), sign(cell[1] - agent.pos[1]))
        steps = ([ahead] if ahead != (0, 0) else []) + [d for d in DIRS.values() if d != ahead]
        taken = {a.pos for a in self.agents.values() if not a.dead}
        for dx, dy in steps:
            there = (cell[0] + dx, cell[1] + dy)
            if there not in taken and (self.standable(there) or (kind == "blue" and not self.column(there))):
                return there
        return None

    def after_action(self, agent):
        """Agents are never without a block (see restock)."""
        return self.restock(agent)

    # --- what holds a block up ------------------------------------------------------

    def held(self):
        """Every block something holds up: the ground, a block beneath it, the water if it is
        blue, or a green block beside it (green also holds what is beside it)."""
        held = {place for place, kind in self.blocks.items()
                if self.kind(kind).ground or (place[2] == -1 and kind == "blue" and not self.land(place[:2]))}
        spreading = list(held)
        while spreading:
            x, y, z = spreading.pop()
            beside = [(x + dx, y + dy, z) for dx, dy in DIRS.values()]
            sticks = [b for b in beside if b in self.blocks and "green" in (self.blocks[b], self.blocks[(x, y, z)])]
            for other in [(x, y, z + 1), *sticks]:
                if other in self.blocks and other not in held:
                    held.add(other)
                    spreading.append(other)
        return held

    def settle(self, agent):
        """Let fall whatever nothing holds, lowest first. Returns what happened, in words."""
        fell = sank = 0
        while True:
            loose = sorted((p for p in self.blocks if p not in self.held()), key=lambda p: p[2])
            if not loose:
                break
            x, y, z = loose[0]
            kind = self.remove_block(x, y, z)
            below = [level for level, _ in self.column((x, y)) if level < z]
            if below:
                self.put_block(x, y, max(below) + 1, kind)   # comes down on what is there
                fell += 1
            elif kind == "blue":
                self.put_block(x, y, -1, kind)   # floats
                fell += 1
            else:
                sank += 1
        # Notes come down with what they lay on, and are gone where nothing is left to lie on.
        self.notes = [n for n in self.notes if self.standable((n[0], n[1]))]
        for n in self.notes:
            n[2] = min(n[2], self.height((n[0], n[1])))
        said = (f" {fell} block(s) fell." if fell else "") + (f" {sank} block(s) sank in the water." if sank else "")
        if not agent.dead and not self.standable(agent.pos):
            said += " There is nothing under you any more. " + self.drown(agent)
        return said

    def restock(self, agent):
        """Agents are never without a block: when no block is left that an agent could pick up
        (the golden one does not count), a new grey block appears next to the agent."""
        if agent.dead or any("block" in (a.hand or {}) for a in self.agents.values() if not a.dead):
            return ""
        walkable = self.on_foot()
        near = lambda x, y: any((x + dx, y + dy) in walkable for dx, dy in [(0, 0), *DIRS.values()])
        # (a stack counts only if its top can be taken from the ground beside it)
        if any(kind not in ("gold", "ground") and near(x, y) and self.height((x, y)) <= REACH + 1
               for (x, y, _), kind in self.blocks.items()):
            return ""
        free = [c for c in (self.next_to(agent, p) for p in DIRS) if self.land(c) and self.height(c) == 0]
        if not free:   # the agent stands out on the water: the block appears where agents wake up
            free = [(self.HOME[0] + dx, self.HOME[1] + dy) for dx, dy in DIRS.values()
                    if self.height((self.HOME[0] + dx, self.HOME[1] + dy)) == 0]
        self.put_block(*free[0], 0, "grey")
        return f"A grey block appears at ({free[0][0]}, {free[0][1]})."

    def on_foot(self):
        """Every cell an agent can walk to from where agents wake up."""
        found, frontier = {self.HOME}, [self.HOME]
        while frontier:
            x, y = frontier.pop()
            for dx, dy in WAYS.values():
                cell = (x + dx, y + dy)
                if cell not in found and self.standable(cell):
                    found.add(cell)
                    frontier.append(cell)
        return found

    # --- what agents are told ----------------------------------------------------------

    def footing(self, agent):
        if not self.under(agent) and not self.land(agent.pos) and self.height(agent.pos) == 0:
            return f"on a {self.called(self.top(agent.pos))} floating in the water"
        said = super().footing(agent)
        if self.height(agent.pos) > 0 and not self.under(agent) and \
                len([z for z, kind in self.column(agent.pos) if not self.kind(kind).ground]) > 1:
            said += f" (blocks under you, by level: {self.pattern(agent.pos)})"
        return said

    def named(self, first, last, kind):
        """As usual, and a block floating in the water is said to float."""
        if first >= 0:
            return super().named(first, last, kind)
        return f"{kind} floating in the water" + (f", {super().named(0, last, kind)}" if last >= 0 else "")

    def also_seen(self, agent):
        """Land is big: it is seen from twice as far as a stack."""
        x, y = agent.pos
        far = 2 * self.sight(agent)
        on_far = lambda cell: (cell[0] - self.far[0]) ** 2 + (cell[1] - self.far[1]) ** 2 <= (FAR + 0.5) ** 2
        other = [(cx, cy) for cx in range(x - far, x + far + 1) for cy in range(y - far, y + far + 1)
                 if self.land((cx, cy)) and on_far((cx, cy)) != on_far(agent.pos)]
        if not other:
            return []
        cx, cy = min(other, key=lambda cell: abs(cell[0] - x) + abs(cell[1] - y))
        return [f"Across the water you see land, the nearest of it at ({cx}, {cy})."]
