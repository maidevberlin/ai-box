"""What agents can do, feature by feature. A world takes the ones it wants:

    class MyWorld(Looking, Clock, Writing, Walking, Jumping, Carrying, Throwing, World): ...

Each feature brings its tools and the few methods they use. A world changes how a feature
works by overriding one of its methods, and calling the original with super() if the usual
thing should still happen. The methods marked "to change" are there for exactly that.
"""
from typing import Literal

from .core import DIRS, Direction, Place, Way, World, clock, math, name, tool

Sight = Literal["around", "hand", "here", "north", "south", "east", "west"]

BEGINNING = 3      # how many words of a note can be made out without looking at it
REACH = 2          # put reaches stacks at most this much higher or lower than your feet
GRAVITY = 9.8      # blocks per second squared
THROW_SPEED = 1.5  # blocks per second, per point of power
HAND = 1.5         # a throw starts this high above your feet


def beginning(text):
    """The first words of a note, as they can be read from a distance."""
    words = text.split()
    return " ".join(words[:BEGINNING]) + ("…" if len(words) > BEGINNING else "")


class Notes(World):
    """Notes lie in the world like flat things: they make nothing higher. Used by the features
    that show, carry and throw notes."""

    def notes_on(self, cell):
        """The texts of the notes lying on top of a cell, the topmost last."""
        return [note[3] for note in self.notes if (note[0], note[1]) == cell and note[2] == self.height(cell)]

    def pile(self, cell):
        """The notes on top of a cell as they look from a distance: how many, and how the top one begins."""
        notes = self.notes_on(cell)
        if len(notes) == 1:
            return f'a note ("{beginning(notes[0])}")'
        return f'{len(notes)} notes (the top one: "{beginning(notes[-1])}")'


class Looking(Notes):
    """look: around, at what is in the hand, or at the cell here or next to here. Looking around
    shows stacks, notes on top, the water once it is in sight, and others; to see what a stack is
    made of, or to read a note, the agent has to look at it."""

    @tool("Look around, or at something.")
    def look(self, agent, at: Sight = "around"):
        if at == "hand":
            if not agent.hand:
                return "Your hand is empty."
            read = f' It says "{agent.hand["note"]}"' if "note" in agent.hand else ""
            return f"You hold a {name(agent.hand, self)}.{read}"
        if at != "around":
            cell = self.next_to(agent, at)
            return self.look_at(agent, cell) + self.someone(agent, cell)
        seen = self.around(agent)
        agent.seen = seen
        return "\n".join([
            self.where(agent) + self.someone(agent, agent.pos) + seen["feet"],
            f"You carry: {'a ' + name(agent.hand, self) if agent.hand else 'nothing'}.",
            f"Stacks in sight (up to {self.sight(agent)} away), as position: height: "
            f"{', '.join(f'({x}, {y}): {text}' for (x, y), text in seen['stacks'].items()) or 'none'}.",
            f"Water in sight: {'; '.join(f'{d}: {text}' for d, text in seen['water'].items()) or 'none'}.",
            *seen["beings"],
            *seen["also"],
        ])

    # to change ----------------------------------------------------------------

    def pattern(self, cell):
        """What a column is made of, by level, lowest first: "1-4 green, 5 blue". The ground is
        left out. Blocks of one kind lying directly on each other are said together."""
        runs = []   # [first level, last level, kind]
        for z, kind in self.column(cell):
            if self.kind(kind).ground:
                continue
            if runs and runs[-1][2] == kind and runs[-1][1] == z - 1:
                runs[-1][1] = z
            else:
                runs.append([z, z, kind])
        return ", ".join(self.named(first, last, kind) for first, last, kind in runs)

    def named(self, first, last, kind):
        """To change: how blocks of one kind from level first to level last are said."""
        return f"{first + 1} {kind}" if first == last else f"{first + 1}-{last + 1} {kind}"

    def describe(self, cell):
        """What looking around shows of a cell, after "(x, y): "."""
        h = self.height(cell)
        if h < 0:
            return f"a hole {-h} deep"
        made = self.pattern(cell)
        single = [z for z, kind in self.column(cell) if not self.kind(kind).ground]
        if len(single) == 1 and single[0] <= 0:
            return f"{h} ({made.removeprefix('1 ')})"
        return f"{h} (by level: {made})" if made else f"{h}"

    def look_at(self, agent, cell):
        """What looking straight at a cell shows."""
        column = self.column(cell)
        under = "water" if not any(self.kind(kind).ground for _, kind in column) else "ground"
        made = self.pattern(cell)
        notes = [n for n in self.notes if (n[0], n[1]) == cell]
        if not made and not notes:
            return "There is only water." if under == "water" else f"There is nothing at ({cell[0]}, {cell[1]}), only ground."
        said = f"At ({cell[0]}, {cell[1]}), {self.height(cell)} high, over {under}."
        if made:
            said += f" Blocks there, by level: {made}."
        if notes:
            said += f" {len(notes)} note(s) lie there."
        top = self.notes_on(cell)
        return said + (f' The note on top says "{top[-1]}"' if top else "")

    def occupied(self):
        """The cells worth mentioning when looking around: with blocks on the ground, notes, or holes."""
        cells = {(x, y) for (x, y, z), kind in self.blocks.items() if not self.kind(kind).ground}
        cells |= {(n[0], n[1]) for n in self.notes}
        cells |= {(x, y) for (x, y, z) in self.blocks if self.height((x, y)) < 0}
        return cells

    def also_seen(self, agent):
        """More lines for looking around. None, unless a world has something else to show."""
        return []

    # the rest -------------------------------------------------------------------

    def someone(self, agent, cell):
        """A sentence about the others in a cell, or nothing."""
        holds = lambda other: f", holding a {name(other.hand, self)}" if other.hand else ""
        if cell != agent.pos:
            there = self.at(cell, agent)
            return " " + " ".join(f"Someone stands there{holds(o)}." if not i else
                                  f"Someone stands on top of them{holds(o)}." for i, o in enumerate(there)) if there else ""
        mine = self.under(agent)
        return "".join(f" Someone stands on you{holds(o)}." for o in self.at(cell, agent) if self.under(o) > mine)

    def around(self, agent):
        """What is in sight from where the agent stands, in parts, so that it can be compared
        with what it saw the last time (see news)."""
        x, y = agent.pos
        reach = self.sight(agent)
        near = lambda cell: abs(cell[0] - x) <= reach and abs(cell[1] - y) <= reach
        stacks = {cell: self.describe(cell) + (f" with {self.pile(cell)} on top" if self.notes_on(cell) else "")
                  for cell in sorted(self.occupied()) if cell != agent.pos and near(cell)}
        # How much there is to stand on in each direction before the water, if the water is in sight.
        # (Said as ground left, not as distance to the water: agents walked exactly the distance, and drowned.)
        water = {}
        for direction, (dx, dy) in DIRS.items():
            steps = next(n for n in range(reach + 1)
                         if n == reach or not self.standable((x + dx * (n + 1), y + dy * (n + 1))))
            if steps < reach:
                water[direction] = (f"{steps} step(s) of ground left, then water" if steps
                                    else "no ground left, the next step is water")
        # The others in sight. (Nothing is said if nobody is: an agent is not told it has company.)
        beings = [f"Someone is at ({o.pos[0]}, {o.pos[1]})"
                  + (", standing on someone else" if self.under(o) else f", {self.height(o.pos)} high" if self.height(o.pos) else "")
                  + (f", holding a {name(o.hand, self)}" if o.hand else "") + "."
                  for o in self.others(agent) if o.pos != agent.pos and near(o.pos)]
        notes = self.notes_on(agent.pos)
        feet = ""
        if notes:
            pile = self.pile(agent.pos)   # (only its first letter is made big: the note's own words stay)
            feet = f" {pile[0].upper() + pile[1:]} {'lies' if len(notes) == 1 else 'lie'} at your feet."
        return {"stacks": stacks, "water": water, "beings": beings, "also": self.also_seen(agent), "feet": feet,
                "at": agent.pos, "reach": reach}

    def news(self, agent):
        """What is in sight now that was not when the agent last saw its surroundings: so a walk
        tells it what it walks into, without telling it everything again."""
        before = agent.seen or {"stacks": {}, "water": {}, "beings": [], "also": []}
        now = self.around(agent)
        x, y, reach = *now["at"], now["reach"]
        new = [f"({cx}, {cy}): {text}" for (cx, cy), text in now["stacks"].items() if before["stacks"].get((cx, cy)) != text]
        gone = [f"({cx}, {cy})" for (cx, cy) in before["stacks"]
                if (cx, cy) not in now["stacks"] and (cx, cy) != agent.pos and abs(cx - x) <= reach and abs(cy - y) <= reach]
        water = [f"{d}: {text}" for d, text in now["water"].items() if before["water"].get(d) != text]
        lines = ([f"New in sight: {', '.join(new)}."] if new else []) \
            + ([f"Nothing is at {', '.join(gone)} any more."] if gone else []) \
            + ([f"Water: {'; '.join(water)}."] if water else []) \
            + [line for line in now["beings"] + now["also"] if line not in before["beings"] + before["also"]]
        agent.seen = now
        return self.where(agent) + self.someone(agent, agent.pos) + now["feet"] + "\n" + ("\n".join(lines) or "Nothing new in sight.")


class Clock(World):
    """clock: the real time of day."""

    @tool("Look at your watch.")
    def clock(self, agent):
        return f"It is {clock()}."


class Writing(Notes):
    """note: writing a note puts it in the agent's hand. From there it is a thing like a block."""

    @tool("Write a note.")
    def note(self, agent, text: str):
        if agent.hand:
            return "Your hands are full."
        agent.hand = {"note": str(text)[:1000]}
        return "You wrote a note. You hold it in your hand."


class Walking(World):
    """walk: level or down, in eight directions, up to as far as the agent sees. A higher stack
    or someone else is in the way; a walk of several steps stops at the water."""

    @tool("Walk in a direction: one step, or more, up to as far as you see. Tells what is new in sight then.",
          steps={"minimum": 1})
    def walk(self, agent, direction: Way, steps: int = 1):
        far = self.sight(agent)
        if steps < 1:
            return "Steps must be a whole number, 1 or more."
        if steps > far:
            return f"You can only walk as far as you see: {far} steps from here. {self.where(agent)}"
        around = lambda: " " + self.news(agent) if hasattr(self, "news") else " " + self.where(agent)
        walked = lambda n: "a step" if n == 1 else f"{n} steps"
        for done in range(steps):
            ahead = self.next_to(agent, direction)
            if not self.standable(ahead):
                # Several steps at once stop at the edge: agents walked on without looking again
                # and drowned. Only a single step, asked for as such, goes into the water.
                if steps > 1:
                    before = f"You walked {walked(done)} {direction} and stopped" if done else "You did not move"
                    return f"{before}: the next step {direction} is water.{around()}"
                return f"You stepped {direction}, off the land. {self.drown(agent)}"
            if self.at(ahead, agent):   # two never stand in the same cell: one can only jump onto the other
                before = f"You walked {walked(done)} {direction}. Then someone" if done else "Someone"
                return f"{before} at ({ahead[0]}, {ahead[1]}) is in your way.{around()}"
            if self.height(ahead) > self.feet(agent):
                before = f"You walked {walked(done)} {direction}. Then a" if done else "A"
                return f"{before} stack {self.height(ahead)} high at ({ahead[0]}, {ahead[1]}) is in your way.{around()}"
            agent.on = None
            agent.pos = ahead
        return f"You walked {walked(steps)} {direction}.{around()}"


class Jumping(World):
    """jump: up to `strength` levels high, and forward as far as that lets it, at most `strength`
    cells. A stack exactly as high is landed on; a lower one is jumped over if there is room
    behind it; a higher one is a wall. Someone standing in a cell counts as one level."""
    # (How strong the strongest jump is, in levels, is the world's setting "jump_height", usually 2.)

    @tool("Jump in a direction. More strength gets you further and higher.",
          strength=lambda world: {"minimum": 1, "maximum": world.settings.get("jump_height", 2)})
    def jump(self, agent, direction: Direction, strength: int):
        strongest = self.settings.get("jump_height", 2)
        if not 1 <= strength <= strongest:
            return f"Strength must be a whole number from 1 to {strongest}."
        dx, dy = DIRS[direction]
        top = lambda cell: self.height(cell) + len(self.at(cell, agent))
        own, landing, wall = self.feet(agent), None, None
        for cells in range(1, strength + 1):
            cell = (agent.pos[0] + dx * cells, agent.pos[1] + dy * cells)
            rise = top(cell) - own
            if rise > strength:   # too high to get onto or over
                wall = cell
                break
            if self.standable(cell):
                landing = cell
            if rise == strength:   # just reached: comes down on top of it
                break
        if not landing and wall:
            what = "the one standing" if self.at(wall, agent) else "the stack"
            return (f"You jumped {strength} high, but {what} at ({wall[0]}, {wall[1]}) "
                    f"is {top(wall) - own} above you. {self.where(agent)}")
        if not landing:
            return f"You jumped {direction}, off the land. {self.drown(agent)}"
        onto = self.at(landing, agent)
        agent.on = None
        agent.pos = landing
        if onto:   # came down on someone: stands on the topmost one there
            agent.on = onto[-1].place
            return f"You jumped {direction} and landed on someone. {self.where(agent)}"
        said = self.landed(agent)
        return f"You jumped {direction}.{said}" + ("" if agent.dead else f" {self.where(agent)}")

    def landed(self, agent):
        """To change: what else happens when an agent lands from a jump. Return a sentence."""
        return ""


class Carrying(Notes):
    """take and put: one thing at a time, on the agent's own cell or the one next to it. A note
    on top is taken first. Putting a block under your own feet lifts you; taking it lowers you."""

    @tool("Take what lies on top.")
    def take(self, agent, where: Place):
        cell = self.next_to(agent, where)
        top_notes = [n for n in self.notes if (n[0], n[1]) == cell and n[2] == self.height(cell)]
        blocks = [(z, kind) for z, kind in self.column(cell) if not self.kind(kind).ground]
        if not top_notes and not blocks:
            return "There is nothing to take." if self.standable(cell) or self.column(cell) else "There is only water."
        out = self.out_of_reach(agent, cell, taking_block=not top_notes)
        if out:
            return out
        if agent.hand:
            return "Your hands are full."
        if top_notes:
            self.notes.remove(top_notes[-1])
            agent.hand = {"note": top_notes[-1][3]}
        else:
            z, kind = blocks[-1]
            self.remove_block(*cell, z)
            agent.hand = {"block": kind}
        said = self.taken(agent, cell)
        return f"You took a {name(agent.hand, self)}.{said}" + ("" if agent.dead else f" {self.where(agent)}")

    @tool("Put down what you carry.")
    def put(self, agent, where: Place):
        if not agent.hand:
            return "You carry nothing."
        cell, thing = self.next_to(agent, where), agent.hand
        at = f"({cell[0]}, {cell[1]})"
        if "note" in thing:
            if not self.standable(cell):
                agent.hand = None
                return "You put the note down. It falls into the water and is gone."
            out = self.out_of_reach(agent, cell)
            if out:
                return out
            agent.hand = None
            self.notes.append([*cell, self.height(cell), thing["note"]])
            return f"You put the note down at {at}. {self.where(agent)}"
        if not self.standable(cell):
            return self.into_water(agent, cell, thing)
        out = self.out_of_reach(agent, cell)
        if out:
            return out
        agent.hand = None
        there = self.height(cell)
        self.put_block(*cell, there, thing["block"])
        return f"You put the block down at {at}. The stack there is {there + 1} high. {self.where(agent)}"

    def out_of_reach(self, agent, cell, taking_block=False):
        """Nothing if the top of a cell can be reached, else the sentence saying why not.
        Whatever can be put somewhere can be taken back: a block put on a stack 2 above the feet
        makes it 3 high, so taking a block reaches one level higher than putting."""
        above = self.height(cell) - self.feet(agent)
        if not -REACH <= above <= REACH + (1 if taking_block else 0):
            return f"The stack there is {self.height(cell)} high. That is out of your reach."
        return None

    def into_water(self, agent, cell, thing):
        """To change: a block put into open water. Usually it sinks."""
        agent.hand = None
        return "You put the block down. It sinks in the water and is gone."

    def taken(self, agent, cell):
        """To change: what else happens after a block or note was taken. Return a sentence."""
        return ""


class Throwing(Notes):
    """throw: the thing flies the curve of a real throw (direction in compass degrees, angle,
    power 1 to 10). It lands on top of what it comes down on, drops in front of a stack it
    hits from the side, is caught by someone with an empty hand, and is lost in the water.
    A note that begins with "friend", thrown into the water, calls a friend (see run.py)."""

    @tool("Throw what you carry.",
          direction="compass degrees: 0 is north, 90 is east",
          angle="degrees above the ground, 0 to 90",
          power="1 to 10")
    def throw(self, agent, direction: float, angle: float, power: float):
        if not 0 <= angle <= 90 or not 1 <= power <= 10:
            return "Angle must be from 0 to 90 and power from 1 to 10."
        if not agent.hand:
            return "You carry nothing."
        thing, agent.hand = agent.hand, None
        threw = f"You threw the {name(thing, self)}. "
        speed = power * THROW_SPEED
        forward = speed * math.cos(math.radians(angle))
        up = speed * math.sin(math.radians(angle))
        dx, dy = math.sin(math.radians(direction)), math.cos(math.radians(direction))   # 0 degrees is north
        start = self.feet(agent) + HAND
        over = agent.pos   # the cell the thing is flying over
        path = [[agent.pos[0] + 0.5, agent.pos[1] + 0.5, start]]
        self.detail = {"flight": {"path": path, "what": "note" if "note" in thing else name(thing, self),
                                  "kind": thing.get("block")}}
        for tick in range(1, 100_000):
            t = tick * 0.005
            z = start + up * t - GRAVITY * t * t / 2
            x = agent.pos[0] + 0.5 + dx * forward * t
            y = agent.pos[1] + 0.5 + dy * forward * t
            ahead = (math.floor(x), math.floor(y))
            if tick % 10 == 0:
                path.append([round(x, 2), round(y, 2), round(z, 2)])
            # A world may let a thing stop in the air on its way. (Not over the thrower's own
            # cell: there it is still at the thrower's hand.)
            if over != agent.pos and math.floor(z) >= self.height(over):
                stuck = self.in_flight(agent, thing, over, math.floor(z))
                if stuck:
                    return threw + stuck
            if ahead != over:
                # Flew into the side of a stack: drops in front of it. (Only a real stack has a side.)
                if self.height(ahead) > 0 and z < self.height(ahead) and self.standable(ahead):
                    hit = f"It hit the side of the stack at ({ahead[0]}, {ahead[1]}) and dropped. "
                    return threw + hit + self.come_down(agent, over, thing, power)
                over = ahead
            if z <= self.height(over):   # came down on top of whatever is there
                return threw + self.come_down(agent, over, thing, power)

    def come_down(self, agent, cell, thing, power):
        """A thrown thing comes down in a cell. Someone standing there with an empty hand catches it."""
        if "note" in thing and not self.standable(cell) and thing["note"].strip().lower().startswith("friend"):
            self.calls.append({"note": thing["note"], "at": list(agent.pos)})
        catching = [o for o in self.at(cell, agent) if not o.hand]
        if catching:
            catcher = catching[-1]   # the topmost one
            catcher.hand = thing
            self.detail["flight"]["path"].append([cell[0] + 0.5, cell[1] + 0.5, self.feet(catcher) + HAND + 0.5])
            self.detail["flight"]["caught"] = True
            return f"Someone at ({cell[0]}, {cell[1]}) caught it."
        return self.landing(agent, cell, thing, power)

    def landing(self, agent, cell, thing, power):
        """To change: a thrown thing lands on this cell. Usually: on top, or lost in the water."""
        path, at = self.detail["flight"]["path"], f"({cell[0]}, {cell[1]})"
        if not self.standable(cell):
            path.append([cell[0] + 0.5, cell[1] + 0.5, -0.5])
            self.detail["flight"]["lost"] = True
            return "It fell into the water and is gone."
        there = self.height(cell)
        if "note" in thing:
            self.notes.append([*cell, there, thing["note"]])
            path.append([cell[0] + 0.5, cell[1] + 0.5, there])
            return f"It landed at your feet. {self.where(agent)}" if cell == agent.pos else f"It landed at {at}."
        self.put_block(*cell, there, thing["block"])
        path.append([cell[0] + 0.5, cell[1] + 0.5, there + 0.5])
        said = f"It landed at {at}. The stack there is {there + 1} high."
        return said + (f" {self.where(agent)}" if cell == agent.pos else "")

    def in_flight(self, agent, thing, cell, z):
        """To change: a thrown thing passes a cell at a level. Return a sentence to stop it there."""
        return None
