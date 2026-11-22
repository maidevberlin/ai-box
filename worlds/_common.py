"""What the worlds share: an agent on a grid of cells, with one hand, that looks, walks,
jumps, throws, writes notes, can drown, and is followed by a new agent.

A world is a class built on Grid. It decides how its things are stored and what its own
rules are; everything that is the same in every world is here, so that it is changed once.
(This file is not a world itself: its name starts with "_".)

A world built on Grid has to provide:
  height(cell)       how high the cell is: where something on it stands
  standable(cell)    can something rest there (False: open water)
  note_on(cell)      the text of the note lying on top there, or nothing
  occupied()         the cells that hold anything at all
  describe(cell)     what looking around shows of a cell, after "(x, y): "
  look_at(cell)      what looking straight at a cell shows
  land_thrown(cell, thing, power)
                     a thrown thing has come down on this cell: put it there (or lose it),
                     add where it rests to self.detail["flight"]["path"], and say what happened
  take(where), put(where)
and may change:
  footing()          how the agent stands, for "You are at (x, y), ..."
  landed()           what else happens when the agent lands from a jump
  also_seen()        more lines for looking around
"""
import math
import time

# North makes y bigger and east makes x bigger, as on a map.
DIRS = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}
PLACES = ["here", *DIRS]  # where take and put can reach
SIGHTS = ["around", "hand", *PLACES]  # what look can be pointed at
REACH = 2                 # put reaches stacks at most this much higher or lower than your feet
GRAVITY = 9.8             # blocks per second squared
THROW_SPEED = 1.5         # blocks per second, per point of power
HAND = 1.5                # a throw starts this high above your feet
BEGINNING = 3             # how many words of a note can be made out without looking at it


def name(thing):
    """What a thing is called: "note", "block", or "green block" where blocks have colours."""
    if isinstance(thing, dict) and "note" in thing:
        return "note"
    return f"{thing['block']} block" if isinstance(thing, dict) else "block"


def beginning(text):
    """The first words of a note, as they can be read from a distance."""
    words = text.split()
    return " ".join(words[:BEGINNING]) + ("…" if len(words) > BEGINNING else "")


class Grid:
    def __init__(self, view, jump, home):
        self.view = view          # how far look() can see from the ground
        self.max_jump = jump      # the strongest jump, in levels
        self.home = home          # where an agent wakes up
        self.pos = home
        self.dead = False         # after drowning, until a new agent wakes up
        self.carrying = None      # the one thing in the agent's hand
        self.detail = None        # extra facts about the last action, for the viewer: a throw's path

    # --- what is the same everywhere ---------------------------------------

    def drown(self):
        self.dead = True
        self.carrying = None  # sinks with the agent
        return "You are in the water. You drown."

    def respawn(self):
        """A new agent wakes up. The world stays as the last one left it: what an agent held
        when it simply stopped lies where it stood (what a drowned one held went down with it)."""
        if self.carrying:
            self.put("here")
            self.carrying = None
        self.dead = False
        self.pos = self.home

    def sight(self):
        """How far the agent sees: one cell further for every level it stands higher."""
        return self.view + self.height(self.pos)

    def next_to(self, place):
        """The cell that 'here', 'north', ... means from where the agent stands."""
        dx, dy = DIRS.get(place, (0, 0))
        return (self.pos[0] + dx, self.pos[1] + dy)

    def footing(self):
        h = self.height(self.pos)
        return f"standing on a stack {h} high" if h else "on the ground"

    def where(self):
        return f"You are at ({self.pos[0]}, {self.pos[1]}), {self.footing()}."

    def landed(self):
        """What else happens when the agent lands from a jump. Nothing, unless a world says so."""
        return ""

    def also_seen(self):
        """More lines for looking around. None, unless a world has something else to show."""
        return []

    def out_of_reach(self, cell, taking_block=False):
        """Nothing if the top of a cell can be reached, else the sentence saying why not.

        Whatever can be put somewhere can be taken back from there: a block put on a stack
        2 above the feet makes it 3 high, so taking a block reaches one level higher than putting.
        """
        above = self.height(cell) - self.height(self.pos)
        if not -REACH <= above <= REACH + (1 if taking_block else 0):
            return f"The stack there is {self.height(cell)} high. That is out of your reach."

    # --- the actions that are the same everywhere --------------------------

    def look(self, at="around"):
        """Look around, or at one thing: what is in the hand, or the cell here or next to here.

        Looking around shows that a note lies somewhere and how it begins. To read it, or to
        see what a stack is made of, the agent has to look at it.
        """
        if at not in SIGHTS:
            return f"You can look {', '.join(SIGHTS)}."
        if at == "hand":
            if not self.carrying:
                return "Your hand is empty."
            read = f' It says "{self.carrying["note"]}"' if name(self.carrying) == "note" else ""
            return f"You hold a {name(self.carrying)}.{read}"
        if at != "around":
            return self.look_at(self.next_to(at))
        x, y = self.pos
        reach = self.sight()
        begins = lambda cell: f' ("{beginning(self.note_on(cell))}")' if self.note_on(cell) else ""
        seen = [f"({cx}, {cy}): {self.describe((cx, cy))}"
                + (f" with a note on top{begins((cx, cy))}" if self.note_on((cx, cy)) else "")
                for cx, cy in sorted(self.occupied())
                if (cx, cy) != self.pos and abs(cx - x) <= reach and abs(cy - y) <= reach]
        # How much there is to stand on in each direction before the water, if the water is in sight.
        # (Said as ground left, not as distance to the water: agents walked exactly the distance, and drowned.)
        water = []
        for direction, (dx, dy) in DIRS.items():
            steps = next(n for n in range(reach + 1)
                         if n == reach or not self.standable((x + dx * (n + 1), y + dy * (n + 1))))
            if steps < reach:
                water.append(f"{direction}: {steps} step(s) of ground left, then water" if steps
                             else f"{direction}: no ground left, the next step is water")
        feet = f" A note lies at your feet{begins(self.pos)}." if self.note_on(self.pos) else ""
        return "\n".join([
            self.where() + feet,
            f"You carry: {'a ' + name(self.carrying) if self.carrying else 'nothing'}.",
            f"Stacks in sight (up to {reach} away), as position: height: {', '.join(seen) or 'none'}.",
            f"Water in sight: {'; '.join(water) or 'none'}.",
            *self.also_seen(),
        ])

    def clock(self):
        """Time in the world is real time: the clock shows the actual time of day."""
        return f"It is {time.strftime('%H:%M:%S')}."

    def wait(self, seconds):
        """Really waits that long. (Not offered to the agent at the moment, see tools().)"""
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

    def walk(self, direction):
        """One step, level or down. A higher stack is in the way: that needs a jump.
        (Only one step at a time: agents that could walk many steps at once walked blind into the water.)"""
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        ahead = self.next_to(direction)
        if not self.standable(ahead):
            return f"You stepped {direction}, off the land. {self.drown()}"
        if self.height(ahead) > self.height(self.pos):
            return (f"A stack {self.height(ahead)} high at ({ahead[0]}, {ahead[1]}) is in your way. {self.where()}")
        self.pos = ahead
        return f"You walked a step {direction}. {self.where()}"

    def jump(self, direction, strength=1):
        """A jump gets the agent up to `strength` levels high, and forward as far as that lets it,
        at most `strength` cells.

        So a stack that is exactly as high as the jump is landed on, also right next to the
        agent; a lower one is jumped over if there is room behind it; a higher one is a wall.
        The agent comes down on the furthest cell it can stand on. Only if there is none does
        it end up in the water.
        """
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if type(strength) is not int or not 1 <= strength <= self.max_jump:
            return f"Strength must be a whole number from 1 to {self.max_jump}."
        dx, dy = DIRS[direction]
        own, landing, wall = self.height(self.pos), None, None
        for cells in range(1, strength + 1):
            cell = (self.pos[0] + dx * cells, self.pos[1] + dy * cells)
            rise = self.height(cell) - own
            if rise > strength:  # too high to get onto or over
                wall = cell
                break
            if self.standable(cell):
                landing = cell
            if rise == strength:  # just reached: comes down on top of it
                break
        if not landing and wall:
            return (f"You jumped {strength} high, but the stack at ({wall[0]}, {wall[1]}) "
                    f"is {self.height(wall) - own} above you. {self.where()}")
        if not landing:
            return f"You jumped {direction}, off the land. {self.drown()}"
        self.pos = landing
        return f"You jumped {direction}.{self.landed()}" + ("" if self.dead else f" {self.where()}")

    def throw(self, direction, angle, power):
        """The thing flies the curve of a thrown object, and the world decides what happens
        where it comes down.

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
                # Flew into the side of a stack: drops in front of it. (Only a real stack has a side.
                # Bare ground reached exactly at a cell's edge is a normal landing, handled below.)
                if self.height(ahead) and z < self.height(ahead):
                    hit = f"It hit the side of the stack at ({ahead[0]}, {ahead[1]}) and dropped. "
                    return threw + hit + self.land_thrown(over, thing, power)
                over = ahead
            if z <= self.height(over):  # came down on top of whatever is there
                return threw + self.land_thrown(over, thing, power)


def tools(world):
    """Exactly what the agent gets to see about each tool: name -> (description, parameters, required).
    The same in every world, so the tools never give away what is special about one."""
    direction = {"type": "string", "enum": list(DIRS)}
    place = {"type": "string", "enum": PLACES}
    return {
        "look": ("Look around, or at something.", {"at": {"type": "string", "enum": SIGHTS}}, []),
        "clock": ("Look at your watch.", {}, []),
        # hidden from the agent for now; remove the "#" to bring it back
        # "wait": ("Wait.", {"seconds": {"type": "integer", "minimum": 1}}, ["seconds"]),
        "note": ("Write a note.", {"text": {"type": "string"}}, ["text"]),
        "walk": ("Walk a step in a direction.", {"direction": direction}, ["direction"]),
        "jump": ("Jump in a direction. More strength gets you further and higher.",
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
