"""What the worlds share: an agent on a grid of cells, with one hand, that looks, walks,
jumps, throws, writes notes, can drown, and is followed by a new agent.

A world is a class built on Grid. It decides how its things are stored and what its own
rules are; everything that is the same in every world is here, so that it is changed once.
(This file is not a world itself: its name starts with "_".)

A world built on Grid has to provide:
  height(cell)       how high the cell is: where something on it stands
  standable(cell)    can something rest there (False: open water)
  notes_on(cell)     the texts of the notes lying on top there, the topmost last
  leave_note(cell, text)  a note lies there from the start
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
# Walking also goes diagonally. (Looking at, taking, putting and jumping stay with the four.)
WALKS = {**DIRS, **{f"{ns}-{ew}": (DIRS[ew][0], DIRS[ns][1]) for ns in ("north", "south") for ew in ("east", "west")}}
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
        # Who is in the world. Several agents can live in it at the same time: each has a
        # place (1, 2, ...) and a body there. Every action is done by one of them, "me".
        self.bodies = {}          # place -> {"pos", "carrying", "dead"}
        self.enter(1)
        self.detail = None        # extra facts about the last action, for the viewer: a throw's path

    def __setstate__(self, kept):
        """Worlds saved when only one agent could live in them had its body as loose facts."""
        if "bodies" not in kept:
            kept["bodies"] = {1: {key: kept.pop(key) for key in ("pos", "carrying", "dead")}}
            kept["me"] = 1
        self.__dict__.update(kept)

    def enter(self, who):
        """From now on the actions are done by this one. Its body is made if it has none yet."""
        self.me = who
        if who not in self.bodies:
            self.bodies[who] = {"pos": self.home, "carrying": None, "dead": True}  # not in the world yet
            if len(self.bodies) > 1:  # (the first one is there before the world is finished: it wakes up at home)
                self.bodies[who]["pos"] = self.free_near(self.home)
            self.bodies[who]["dead"] = False

    def body(name):  # noqa: N805 (makes the three facts of my body read and written like plain ones)
        return property(lambda self: self.bodies[self.me][name],
                        lambda self, value: self.bodies[self.me].__setitem__(name, value))

    pos = body("pos")            # where I stand
    carrying = body("carrying")  # the one thing in my hand
    dead = body("dead")          # after drowning, until a new agent wakes up in my place
    del body

    def free_near(self, cell):
        """The cell itself if nobody else stands there, else the nearest one to stand on that is free.
        Two agents never stand in the same cell (except one on top of the other)."""
        taken = {body["pos"] for _, body in self.others()}
        for far in range(0, 50):
            ring = [(cell[0] + dx, cell[1] + dy) for dx in range(-far, far + 1) for dy in range(-far, far + 1)
                    if max(abs(dx), abs(dy)) == far]
            free = [c for c in ring if c not in taken and self.standable(c)]
            if free:
                return min(free, key=lambda c: abs(c[0] - cell[0]) + abs(c[1] - cell[1]))
        return cell

    def at(self, cell):
        """The others standing in a cell, the lowest first: one can stand on another."""
        there = [(who, body) for who, body in self.others() if body["pos"] == cell]
        return sorted(there, key=lambda found: self.under(found[0]))

    def under(self, who=None):
        """How many agents someone stands on (usually none). Whoever it stood on has to be
        alive and still in the same cell: if that one walked away, it has come down."""
        body, count = self.bodies[who or self.me], 0
        while (below := self.bodies.get(body.get("on"))) and not below["dead"] and below["pos"] == body["pos"] and count < 9:
            body, count = below, count + 1
        return count

    def feet(self):
        """How high I stand: on the top of my cell, or higher if I stand on someone."""
        return self.height(self.pos) + self.under()

    def leave(self):
        """I am gone and nobody takes my place: what I held lies where I stood."""
        if self.carrying and not self.dead:
            self.put("here")
        self.vanish()
        self.bodies[self.me].update(carrying=None, dead=True, told=True)
        self.bodies[self.me].pop("on", None)

    def vanish(self):
        """The agent in my place is gone (it stopped, died, or had to make room), and its body
        with it. The others who have that spot in sight see it happen: each is told with the
        answer to what it does next (see noticed)."""
        body = self.bodies[self.me]
        if not body.pop("woke", False):  # nobody has lived in this body yet
            return
        x, y = body["pos"]
        me = self.me
        for who, other in self.others():
            self.me = who
            if abs(other["pos"][0] - x) <= self.sight() and abs(other["pos"][1] - y) <= self.sight():
                other.setdefault("witnessed", []).append((x, y))
        self.me = me

    def noticed(self):
        """What I saw happen since my last action, as sentences: someone vanishing."""
        gone = self.bodies[self.me].pop("witnessed", [])
        return "".join(f"\nSomeone who was at ({x}, {y}) is gone." for x, y in gone)

    def others(self):
        """The other agents that are alive, as (place, body)."""
        return [(who, body) for who, body in sorted(self.bodies.items()) if who != self.me and not body["dead"]]

    def everyone(self):
        """Every body as the viewer needs it, whoever's turn it is."""
        me, found = self.me, []
        for who in sorted(self.bodies):
            self.me = who
            found.append({"id": who, "pos": list(self.pos), "height": self.feet(),
                          "carrying": self.carrying, "dead": self.dead, "view": self.sight()})
        self.me = me
        return found

    def lose_footing(self):
        """What I did may have taken away what another one stood on: then it drowns."""
        for _, body in self.others():
            if not self.standable(body["pos"]):
                body["dead"], body["carrying"] = True, None
        for who, body in self.bodies.items():  # whoever stood on someone that is gone has come down
            if "on" in body and not self.under(who):
                del body["on"]

    def someone(self, cell):
        """A sentence about the others in a cell, or nothing."""
        holds = lambda body: f", holding a {name(body['carrying'])}" if body["carrying"] else ""
        if cell != self.pos:
            there = self.at(cell)
            return " " + " ".join(f"Someone stands there{holds(body)}." if not i else
                                  f"Someone stands on top of them{holds(body)}." for i, (_, body) in enumerate(there)) if there else ""
        mine = self.under()
        # (That I stand on someone is said with where I am.)
        return "".join(f" Someone stands on you{holds(body)}." for who, body in self.at(cell) if self.under(who) > mine)

    # --- what is the same everywhere ---------------------------------------

    def drown(self):
        self.dead = True
        self.carrying = None  # sinks with the agent
        return "You are in the water. You drown."

    def respawn(self, near=None):
        """A new agent wakes up: where agents wake up, or near a spot (a friend, near its caller). The world stays as the last one left it: what an agent held
        when it simply stopped lies where it stood (what a drowned one held went down with it)."""
        if self.carrying:
            self.put("here")
            self.carrying = None
        self.vanish()
        self.dead = True  # gone for a moment, so that it is not in its own way
        for memory in ("on", "seen", "witnessed"):  # the new agent has seen nothing yet
            self.bodies[self.me].pop(memory, None)
        self.pos = self.free_near(near or self.home)
        self.dead = False
        self.bodies[self.me]["woke"] = True

    def sight(self):
        """How far the agent sees: one cell further for every level it stands higher."""
        return self.view + self.feet()

    def next_to(self, place):
        """The cell that 'here', 'north', ... means from where the agent stands."""
        dx, dy = WALKS.get(place, (0, 0))
        return (self.pos[0] + dx, self.pos[1] + dy)

    def footing(self):
        h = self.height(self.pos)
        return f"standing on a stack {h} high" if h else "on the ground"

    def where(self):
        footing = "standing on someone" if self.under() else self.footing()
        return f"You are at ({self.pos[0]}, {self.pos[1]}), {footing}."

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
        above = self.height(cell) - self.feet()
        if not -REACH <= above <= REACH + (1 if taking_block else 0):
            return f"The stack there is {self.height(cell)} high. That is out of your reach."

    # --- the actions that are the same everywhere --------------------------

    def look(self, at="around"):
        """Look around, or at one thing: what is in the hand, or the cell here or next to here.

        Looking around shows where notes lie, how many, and how the top one begins. To read it, or to
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
            return self.look_at(self.next_to(at)) + self.someone(self.next_to(at))
        seen = self.around()
        self.bodies[self.me]["seen"] = {key: value for key, value in seen.items() if key != "near"}
        return "\n".join([
            self.where() + self.someone(self.pos) + seen["feet"],
            f"You carry: {'a ' + name(self.carrying) if self.carrying else 'nothing'}.",
            f"Stacks in sight (up to {self.sight()} away), as position: height: "
            f"{', '.join(f'({x}, {y}): {text}' for (x, y), text in seen['stacks'].items()) or 'none'}.",
            f"Water in sight: {'; '.join(f'{d}: {text}' for d, text in seen['water'].items()) or 'none'}.",
            *seen["beings"],
            *seen["also"],
        ])

    def around(self):
        """What is in sight from where I stand, in parts, so that it can be compared with what
        I saw the last time (see news)."""
        x, y = self.pos
        reach = self.sight()
        near = lambda cell: abs(cell[0] - x) <= reach and abs(cell[1] - y) <= reach
        stacks = {cell: self.describe(cell) + (f" with {self.pile(cell)} on top" if self.note_on(cell) else "")
                  for cell in sorted(self.occupied()) if cell != self.pos and near(cell)}
        # How much there is to stand on in each direction before the water, if the water is in sight.
        # (Said as ground left, not as distance to the water: agents walked exactly the distance, and drowned.)
        water = {}
        for direction, (dx, dy) in DIRS.items():
            steps = next(n for n in range(reach + 1)
                         if n == reach or not self.standable((x + dx * (n + 1), y + dy * (n + 1))))
            if steps < reach:
                water[direction] = (f"{steps} step(s) of ground left, then water" if steps
                                    else "no ground left, the next step is water")
        # The others, as far as they are in sight. (Nothing is said if nobody is: an agent is not told it has company.)
        beings = [f"Someone is at ({ox}, {oy})"
                  + (", standing on someone else" if self.under(who) else f", {self.height((ox, oy))} high" if self.height((ox, oy)) else "")
                  + (f", holding a {name(body['carrying'])}" if body["carrying"] else "") + "."
                  for who, body in self.others() for ox, oy in [body["pos"]] if (ox, oy) != self.pos and near((ox, oy))]
        lie = "lies" if len(self.notes_on(self.pos)) == 1 else "lie"
        feet = f" {self.pile(self.pos).capitalize()} {lie} at your feet." if self.note_on(self.pos) else ""
        return {"stacks": stacks, "water": water, "beings": beings, "also": self.also_seen(), "feet": feet,
                "near": near, "at": self.pos}

    def news(self):
        """What is in sight now that was not when I last saw my surroundings (by looking around,
        or after my last walk): what is new or has changed, and what is gone though its place is
        still in sight. So a walk tells the agent what it walks into, without telling it everything again."""
        before = self.bodies[self.me].get("seen") or {"stacks": {}, "water": {}, "beings": [], "also": []}
        now = self.around()
        new = [f"({x}, {y}): {text}" for (x, y), text in now["stacks"].items() if before["stacks"].get((x, y)) != text]
        gone = [f"({x}, {y})" for (x, y) in before["stacks"]
                if (x, y) not in now["stacks"] and (x, y) != now["at"] and now["near"]((x, y))]
        water = [f"{d}: {text}" for d, text in now["water"].items() if before["water"].get(d) != text]
        lines = ([f"New in sight: {', '.join(new)}."] if new else []) \
            + ([f"Nothing is at {', '.join(gone)} any more."] if gone else []) \
            + ([f"Water: {'; '.join(water)}."] if water else []) \
            + [line for line in now["beings"] + now["also"] if line not in before["beings"] + before["also"]]
        now.pop("near")  # (cannot be kept in the world's file)
        self.bodies[self.me]["seen"] = now
        return self.where() + self.someone(self.pos) + now["feet"] + "\n" + ("\n".join(lines) or "Nothing new in sight.")

    def clock(self):
        """Time in the world is real time: the clock shows the actual time of day."""
        return f"It is {time.strftime('%H:%M:%S')}."

    def wait(self, seconds):
        """Really waits that long. (Not offered to the agent at the moment, see tools().)"""
        if type(seconds) is not int or seconds < 1:
            return "Seconds must be a whole number of at least 1."
        time.sleep(seconds)
        return f"You waited {seconds} second(s)."

    def note_on(self, cell):
        """The text of the note lying on top of a cell, or nothing."""
        notes = self.notes_on(cell)
        return notes[-1] if notes else None

    def pile(self, cell):
        """The notes on top of a cell as they look from a distance: how many, and how the top one begins."""
        notes = self.notes_on(cell)
        if len(notes) == 1:
            return f'a note ("{beginning(notes[0])}")'
        return f'{len(notes)} notes (the top one: "{beginning(notes[-1])}")'

    def note(self, text):
        """Writing a note puts it in the agent's hand. From there it is a thing like a block."""
        if self.carrying:
            return "Your hands are full."
        self.carrying = {"note": str(text)[:1000]}
        return "You wrote a note. You hold it in your hand."

    def walk(self, direction, steps=1):
        """Some steps, level or down. A higher stack is in the way: that needs a jump.
        (Never further than the agent sees: agents that could walk any distance walked blind
        into the water.)"""
        if direction not in WALKS:
            return f"Unknown direction. Use {', '.join(WALKS)}."
        far = self.sight()
        if type(steps) is not int or steps < 1:
            return "Steps must be a whole number, 1 or more."
        if steps > far:
            return f"You can only walk as far as you see: {far} steps from here. {self.where()}"
        # After a walk the agent is told what has come into sight: it then knows what it walks
        # into without asking, such as the water it has come close to.
        around = lambda: " " + self.news()
        walked = lambda n: "a step" if n == 1 else f"{n} steps"
        for done in range(steps):
            ahead = self.next_to(direction)
            if not self.standable(ahead):
                # Several steps at once stop at the edge: agents walked on without looking again
                # and drowned. Only a single step, asked for as such, goes into the water.
                if steps > 1:
                    before = f"You walked {walked(done)} {direction} and stopped" if done else "You did not move"
                    return f"{before}: the next step {direction} is water.{around()}"
                return f"You stepped {direction}, off the land. {self.drown()}"
            if self.at(ahead):  # two never stand in the same cell: one can only jump onto the other
                before = f"You walked {walked(done)} {direction}. Then someone" if done else "Someone"
                return f"{before} at ({ahead[0]}, {ahead[1]}) is in your way.{around()}"
            if self.height(ahead) > self.feet():
                before = f"You walked {walked(done)} {direction}. Then a" if done else "A"
                return (f"{before} stack {self.height(ahead)} high at ({ahead[0]}, {ahead[1]}) "
                        f"is in your way.{around()}")
            self.bodies[self.me].pop("on", None)
            self.pos = ahead
        return f"You walked {walked(steps)} {direction}.{around()}"

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
        # Someone standing in a cell makes it one level higher: an agent can be jumped onto, or over.
        top = lambda cell: self.height(cell) + len(self.at(cell))
        own, landing, wall = self.feet(), None, None
        for cells in range(1, strength + 1):
            cell = (self.pos[0] + dx * cells, self.pos[1] + dy * cells)
            rise = top(cell) - own
            if rise > strength:  # too high to get onto or over
                wall = cell
                break
            if self.standable(cell):
                landing = cell
            if rise == strength:  # just reached: comes down on top of it
                break
        if not landing and wall:
            what = "the one standing" if self.at(wall) else "the stack"
            return (f"You jumped {strength} high, but {what} at ({wall[0]}, {wall[1]}) "
                    f"is {top(wall) - own} above you. {self.where()}")
        if not landing:
            return f"You jumped {direction}, off the land. {self.drown()}"
        onto = self.at(landing)
        self.bodies[self.me].pop("on", None)
        self.pos = landing
        if onto:  # came down on someone: stands on the topmost one there
            self.bodies[self.me]["on"] = onto[-1][0]
            return f"You jumped {direction} and landed on someone. {self.where()}"
        return f"You jumped {direction}.{self.landed()}" + ("" if self.dead else f" {self.where()}")

    def come_down(self, cell, thing, power):
        """A thrown thing comes down in a cell. If someone stands there with an empty hand, it is
        caught: it is in that one's hand now. Else the world decides what happens (land_thrown)."""
        catching = [(who, body) for who, body in self.at(cell) if not body["carrying"]]
        # The call for a friend: a note that begins with "friend", thrown into the water. The
        # world only keeps the call; whether a friend comes is up to the run (see run.py).
        if name(thing) == "note" and not self.standable(cell) and thing["note"].strip().lower().startswith("friend"):
            self.calls = [*getattr(self, "calls", []), {"note": thing["note"], "at": list(self.pos)}]
        if not catching:
            return self.land_thrown(cell, thing, power)
        who, body = catching[-1]  # the topmost one
        body["carrying"] = thing
        up = self.height(cell) + self.under(who) + HAND + 0.5
        self.detail["flight"]["path"].append([cell[0] + 0.5, cell[1] + 0.5, up])
        self.detail["flight"]["caught"] = True
        return f"Someone at ({cell[0]}, {cell[1]}) caught it."

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
        start = self.feet() + HAND
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
                    return threw + hit + self.come_down(over, thing, power)
                over = ahead
            if z <= self.height(over):  # came down on top of whatever is there
                return threw + self.come_down(over, thing, power)


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
        "walk": ("Walk in a direction: one step, or more, up to as far as you see. Tells what is new in sight then.",
                 {"direction": {"type": "string", "enum": list(WALKS)}, "steps": {"type": "integer", "minimum": 1}}, ["direction"]),
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
