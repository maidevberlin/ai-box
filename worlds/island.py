"""The island: the first world. This file is everything the island is, except how it is drawn
(that is island.js). See worlds/__init__.py for what a world file has to contain.

The island is a grid of cells. Each cell holds a stack of things (often an empty one), and
the agent stands on top of the stack in its cell. A thing is a block, which is one high, or
a note, which is flat: it lies in a stack without making it higher. Every action returns the sentence the agent gets to read.

Time in the world is real time: the clock shows the actual time of day, and
wait really waits that long.
"""
import math
import random
import time

# (0, 0) is the south-west corner: walking north makes y bigger, east makes x bigger, as on
# a map. (It was the other way round at first, and every agent stopped to remark on it.)
DIRS = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}
PLACES = ["here", *DIRS]  # where take and put can reach
SIGHTS = ["around", "hand", *PLACES]  # what look can be pointed at
REACH = 2                 # take/put reach stacks at most this much higher or lower than your feet
GRAVITY = 9.8             # blocks per second squared
THROW_SPEED = 1.5         # blocks per second, per point of power
HAND = 1.5                # a throw starts this high above your feet
BLOCK = "block"           # a thing is either this, or a note: {"note": "what it says"}

TITLE = "Island"
ABOUT = """\
A flat, square island surrounded by water. The agent starts in the middle. Blocks lie
scattered around at random; every cell of the island holds a stack of things, usually an
empty one. The agent stands on top of whatever is in its cell.

The agent is not told any of this. It has to find out by looking and trying.

- Walking goes level or down. A higher stack is in the way.
- Walking or jumping off the island means drowning. Looking around shows the water once
  the edge is within sight, as the number of steps of land that are left before it.
- When the agent dies, a new agent wakes up in the middle of the island. It knows nothing
  of the one before: it starts with an empty memory and is told the same prompt. The world
  is as it was left, with every block and note where it was. What the dead agent carried
  is gone.
- Jumping gets the agent up: strength 1 or 2 is how many higher the next cell may be.
- It carries one thing at a time. Take and put work on its own cell or the one next to it,
  if that stack is at most 2 higher or lower than its feet.
- Putting a block under its own feet lifts it; taking that block lowers it.
- A note is a thing like a block, but flat: it has no height. Writing one puts it in the
  agent's hand. From there it can be put down, taken again and thrown, and it can lie on
  the ground, on a stack, or between blocks. It never makes a stack higher.
- Looking around shows where stacks are, how high, and whether a note lies on top, but not
  what a note says or what a stack is made of.
- For that the agent has to look at something: at what is in its hand, or at the stack in
  its own cell or the cell next to it. It then sees every thing in the stack, and reads
  the note if one is on top. A note with something on top of it cannot be read.
- A thrown thing flies the curve of a real throw (direction in compass degrees, angle,
  power 1 to 10). It lands on top of what it comes down on, drops in front of a stack it
  hits from the side, and is lost if it leaves the island.
- It sees 3 cells far from the ground, and one cell further for every level it stands higher.
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


def name(thing):
    return "block" if thing == BLOCK else "note"


def says(thing):
    return f'"{thing["note"]}"'


class World:
    def __init__(self, size, blocks, view, jump, seed):
        self.settings = {"size": size, "blocks": blocks, "view": view, "jump": jump, "seed": seed}
        self.size = size          # the island is size x size cells
        self.view = view          # how far look() can see from the ground
        self.max_jump = jump      # the strongest jump, in levels
        self.home = (size // 2, size // 2)  # where an agent wakes up
        self.pos = self.home
        self.dead = False         # after drowning, until a new agent wakes up
        self.carrying = None      # the one thing in the agent's hand
        self.stacks = {}          # (x, y) -> the things stacked there, bottom first
        self.detail = None        # extra facts about the last action, for the viewer: a throw's path
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
            "view": self.sight(),
            "stacks": [[x, y, things] for (x, y), things in sorted(self.stacks.items())],
        }

    # --- helpers ---------------------------------------------------------

    def on_island(self, cell):
        return 0 <= cell[0] < self.size and 0 <= cell[1] < self.size

    def height(self, cell):
        """How high a stack is: its blocks. Notes are flat and do not count."""
        return self.stacks.get(cell, []).count(BLOCK)

    def top(self, cell):
        """The thing on top of a stack, or nothing."""
        return self.stacks[cell][-1] if cell in self.stacks else None

    def add(self, cell, thing):
        self.stacks.setdefault(cell, []).append(thing)

    def remove(self, cell):
        thing = self.stacks[cell].pop()
        if not self.stacks[cell]:
            del self.stacks[cell]
        return thing

    def drown(self):
        self.dead = True
        self.carrying = None  # sinks with the agent
        return "You are in the water. You drown."

    def respawn(self):
        """A new agent wakes up. The world stays as the last one left it."""
        self.dead = False
        self.pos = self.home

    def sight(self):
        """How far the agent sees: one cell further for every level it stands higher."""
        return self.view + self.height(self.pos)

    def next_to(self, place):
        """The cell that 'here', 'north', ... means from where the agent stands."""
        dx, dy = DIRS.get(place, (0, 0))
        return (self.pos[0] + dx, self.pos[1] + dy)

    def where(self):
        h = self.height(self.pos)
        on = f"standing on a stack {h} high" if h else "on the ground"
        return f"You are at ({self.pos[0]}, {self.pos[1]}), {on}."

    # --- the actions -----------------------------------------------------

    def look(self, at="around"):
        """Look around, or at one thing: what is in the hand, or the stack here or next to here."""
        if at not in SIGHTS:
            return f"You can look {', '.join(SIGHTS)}."
        if at == "hand":
            if not self.carrying:
                return "Your hand is empty."
            return "You hold a block." if self.carrying == BLOCK else f"You hold a note. It says {says(self.carrying)}"
        if at != "around":
            return self.look_at(self.next_to(at))
        x, y = self.pos
        seen = [f"({sx}, {sy}): {things.count(BLOCK)}" + (" with a note on top" if things[-1] != BLOCK else "")
                for (sx, sy), things in sorted(self.stacks.items())
                if (sx, sy) != self.pos
                and abs(sx - x) <= self.sight() and abs(sy - y) <= self.sight()]
        # How much land is left in each direction before the water, if the water is within sight.
        # (Said as land left, not as distance to the water: agents walked exactly the distance, and drowned.)
        land = {"north": self.size - 1 - y, "south": y, "east": self.size - 1 - x, "west": x}
        water = [f"{direction}: {steps} step(s) of land left, then water" if steps
                 else f"{direction}: no land left, the next step is water"
                 for direction, steps in land.items() if steps < self.sight()]
        feet = " A note lies at your feet." if self.top(self.pos) not in (None, BLOCK) else ""
        return "\n".join([
            self.where() + feet,
            f"You carry: {'a ' + name(self.carrying) if self.carrying else 'nothing'}.",
            f"Stacks in sight (up to {self.sight()} away), as position: height: "
            f"{', '.join(seen) or 'none'}.",
            f"Water in sight: {'; '.join(water) or 'none'}.",
        ])

    def look_at(self, cell):
        """What a stack is made of, bottom first. Only a note on top can be read."""
        if not self.on_island(cell):
            return "There is only water."
        things = self.stacks.get(cell)
        if not things:
            return f"There is nothing at ({cell[0]}, {cell[1]}), only ground."
        made = ", ".join(name(thing) for thing in things)
        read = f" The note on top says {says(things[-1])}" if things[-1] != BLOCK else ""
        return (f"At ({cell[0]}, {cell[1]}), {self.height(cell)} high. "
                f"What lies there, from the bottom: {made}.{read}")

    def clock(self):
        return f"It is {time.strftime('%H:%M:%S')}."

    def wait(self, seconds):
        if type(seconds) is not int or seconds < 1:
            return "Seconds must be a whole number of at least 1."
        time.sleep(seconds)
        return f"You waited {seconds} second(s)."

    def note(self, text):
        """Writing a note puts it in the agent's hand. From there it is a thing like a block."""
        if self.carrying:
            return "Your hands are full."
        self.carrying = {"note": str(text)[:1000]}
        return "You wrote a note. You hold it in your hand."

    def walk(self, direction, steps=1):
        """Walking goes level or down. A higher stack is in the way: that needs a jump."""
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if type(steps) is not int or steps < 1:
            return "Steps must be a whole number of at least 1."
        for done in range(steps):
            ahead = self.next_to(direction)
            walked = f"You walked {done} step(s) {direction}."
            if not self.on_island(ahead):
                return f"{walked} Then you stepped off the land. {self.drown()}"
            if self.height(ahead) > self.height(self.pos):
                return (f"{walked} A stack {self.height(ahead)} high at "
                        f"({ahead[0]}, {ahead[1]}) is in your way. {self.where()}")
            self.pos = ahead
        return f"You walked {steps} step(s) {direction}. {self.where()}"

    def jump(self, direction, strength=1):
        """Jump onto the next cell. Strength is how many levels up the agent gets."""
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if type(strength) is not int or not 1 <= strength <= self.max_jump:
            return f"Strength must be a whole number from 1 to {self.max_jump}."
        ahead = self.next_to(direction)
        if not self.on_island(ahead):
            return f"You jumped {direction}, off the land. {self.drown()}"
        rise = self.height(ahead) - self.height(self.pos)
        if rise > strength:
            return (f"You jumped {strength} high, but the stack at ({ahead[0]}, {ahead[1]}) "
                    f"is {rise} above you. {self.where()}")
        self.pos = ahead
        return f"You jumped {direction}. {self.where()}"

    def reach(self, place):
        """The cell take/put aims at, or the sentence saying why it cannot be reached."""
        if place not in PLACES:
            return "Unknown place. Use here, north, south, east or west."
        cell = self.next_to(place)
        if not self.on_island(cell):
            return "There is only water."
        if abs(self.height(cell) - self.height(self.pos)) > REACH:
            return f"The stack there is {self.height(cell)} high. That is out of your reach."
        return cell

    def take(self, where="here"):
        """Take the top thing of a stack. Taking the one under your feet lowers you."""
        cell = self.reach(where)
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

    def high(self, cell, thing):
        """After a block came down somewhere: how high that stack is now. A note changes nothing."""
        return f"The stack there is {self.height(cell)} high. " if thing == BLOCK else ""

    def throw(self, direction, angle, power):
        """The thing flies the curve of a thrown object and lands where it comes down.

        direction: compass degrees (0 north, 90 east). angle: degrees above the ground.
        """
        if any(type(value) not in (int, float) for value in (direction, angle, power)):
            return "Direction, angle and power must be numbers."
        if not 0 <= angle <= 90 or not 1 <= power <= 10:
            return "Angle must be from 0 to 90 and power from 1 to 10."
        if not self.carrying:
            return "You carry nothing."
        thing, self.carrying = self.carrying, None
        threw = f"You threw the {name(thing)}. "
        speed = power * THROW_SPEED
        forward = speed * math.cos(math.radians(angle))
        up = speed * math.sin(math.radians(angle))
        dx, dy = math.sin(math.radians(direction)), math.cos(math.radians(direction))  # 0 degrees is north
        start = self.height(self.pos) + HAND
        over = self.pos  # the cell the thing is flying over
        path = [[self.pos[0] + 0.5, self.pos[1] + 0.5, start]]
        self.detail = {"flight": {"path": path, "what": name(thing)}}
        for tick in range(1, 100_000):
            t = tick * 0.005
            z = start + up * t - GRAVITY * t * t / 2
            x = self.pos[0] + 0.5 + dx * forward * t
            y = self.pos[1] + 0.5 + dy * forward * t
            ahead = (math.floor(x), math.floor(y))
            if tick % 10 == 0:
                path.append([round(x, 2), round(y, 2), round(z, 2)])
            if ahead != over:
                if not self.on_island(ahead):
                    while z > -0.5:  # it flies on and drops into the water
                        path.append([round(x, 2), round(y, 2), round(z, 2)])
                        t += 0.05
                        z = start + up * t - GRAVITY * t * t / 2
                        x, y = x + dx * forward * 0.05, y + dy * forward * 0.05
                    self.detail["flight"]["lost"] = True
                    return threw + "It fell into the water and is gone."
                # Flew into the side of a stack: drops in front of it. (Only a real stack has a side.
                # Bare ground reached exactly at a cell's edge is a normal landing, handled below.)
                if self.height(ahead) and z < self.height(ahead):
                    hit = f"It hit the side of the stack at ({ahead[0]}, {ahead[1]}) and dropped. "
                    return threw + hit + self.land(over, thing)
                over = ahead
            if z <= self.height(over):      # came down on top of whatever is there
                return threw + self.land(over, thing)

    def land(self, cell, thing):
        self.add(cell, thing)
        rest = self.height(cell) - (0.5 if thing == BLOCK else 0)  # the middle of a block, or flat on top
        self.detail["flight"]["path"].append([cell[0] + 0.5, cell[1] + 0.5, rest])
        if cell == self.pos:
            return f"It landed at your feet. {self.where()}"
        return f"It landed at ({cell[0]}, {cell[1]}). {self.high(cell, thing)}".strip()


def tools(world):
    """Exactly what the agent gets to see about each tool: name -> (description, parameters, required)."""
    direction = {"type": "string", "enum": list(DIRS)}
    place = {"type": "string", "enum": PLACES}
    return {
        "look": ("Look around, or at something.", {"at": {"type": "string", "enum": SIGHTS}}, []),
        "clock": ("Look at your watch.", {}, []),
        # hidden from the agent for now; remove the "#" to bring it back
        # "wait": ("Wait.", {"seconds": {"type": "integer", "minimum": 1}}, ["seconds"]),
        "note": ("Write a note.", {"text": {"type": "string"}}, ["text"]),
        "walk": ("Walk in a direction.",
                 {"direction": direction, "steps": {"type": "integer", "minimum": 1}},
                 ["direction"]),
        "jump": ("Jump in a direction. More strength gets you higher.",
                 {"direction": direction,
                  "strength": {"type": "integer", "minimum": 1, "maximum": world.max_jump}},
                 ["direction", "strength"]),
        "take": ("Take what lies on top.", {"where": place}, ["where"]),
        "put": ("Put down what you carry.", {"where": place}, ["where"]),
        "throw": ("Throw what you carry.",
                  {"direction": {"type": "number", "description": "compass degrees: 0 is north, 90 is east"},
                   "angle": {"type": "number", "description": "degrees above the ground, 0 to 90"},
                   "power": {"type": "number", "description": "1 to 10"}},
                  ["direction", "angle", "power"]),
    }


def picture(setup, state):
    """The island as text: digits are stack heights, @ is the agent, north is up."""
    size = setup["size"]
    # Runs from before notes were things recorded only the height of each stack, as "blocks".
    heights = [(x, y, things.count(BLOCK)) for x, y, things in state["stacks"]] if "stacks" in state else state["blocks"]
    cells = {(x, y): str(min(n, 9)) for x, y, n in heights}
    cells[tuple(state["pos"])] = "@"
    rows = range(size) if setup["north"] < 0 else reversed(range(size))
    return "\n".join("  " + " ".join(cells.get((x, y), ".") for x in range(size)) for y in rows)
