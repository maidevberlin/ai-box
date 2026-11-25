"""The core of every world: blocks in a 3D grid, agents, tools, and time. Nothing more.

What agents can do (look, walk, jump, carry, throw, write notes) are features, in
features.py. A world is a class that takes the core and the features it wants, and adds
its own blocks, tools and rules. See island.py for the smallest world, and magic.py for one
that changes how the features work.

THE GRID
  A block is at a cell (x, y) and a level z, and has a kind: a name like "stone". Every
  cell holds a column of blocks. The ground is blocks too, in the levels below 0, so it can
  be dug away. A cell whose column is empty is open water.
  The top of a column is where something on it stands: level 0 on bare ground, 1 on one
  block, -1 in a hole one deep. North makes y bigger, east makes x bigger, as on a map.

KINDS
  A world names its kinds of block in KINDS, each with a few plain properties
  (see Kind). The viewer draws a block in the colour of its kind.

AGENTS
  Each agent is an Agent: where it stands (pos), what it holds (hand: {"block": kind} or
  {"note": text}), whether it is dead. A world may give agents more, like agent.hunger:
  set it in wake(). Several agents can be in a world at the same time; each has a place
  (1, 2, ...), and in each place one agent lives after another.

TOOLS
  A method marked @tool("what the agent is told") is something an agent can do. It is
  called with the agent that does it, and the parameters the agent gave. Their types come
  from the method: str, int, float, or one of a few words (Literal, or the ready-made
  Direction, Way and Place). It returns the sentence the agent gets to read.

RULES
  A world changes what happens by overriding a method, calling the original with super()
  where it wants the usual thing to happen too. Two methods are there only to be overridden:
    make()               build the world at the start
    after_action(agent)  after every action; return a sentence to tell the agent, or ""
  and a world may also change wake(agent) (a new agent wakes up) and describe_kind().
"""
import inspect
import math
import time
import typing
from typing import Literal

# --- words the tools understand ----------------------------------------------

DIRS = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}
WAYS = {**DIRS, **{f"{ns}-{ew}": (DIRS[ew][0], DIRS[ns][1]) for ns in ("north", "south") for ew in ("east", "west")}}
Direction = Literal["north", "south", "east", "west"]
Way = Literal["north", "south", "east", "west", "north-east", "north-west", "south-east", "south-west"]
Place = Literal["here", "north", "south", "east", "west"]


class Kind:
    """A kind of block. Every property has a usual value, so a kind only says what is special.
    Anything else a world wants to know about a kind can be added as a keyword (Kind(food=1))."""
    def __init__(self, colour="#8a919c", called="", stand=True, drown=False, ground=False, **extra):
        self.colour = colour    # how the viewer draws it
        self.called = called    # what agents are told it is, e.g. "grey block" (usual: the kind's name + " block")
        self.stand = stand      # can something stand on it, or rest on it
        self.drown = drown      # standing in it drowns you (like water)
        self.ground = ground    # it is the ground: the features never take it away
        self.extra = extra

    def __getattr__(self, key):   # Kind(food=1).food is 1; a property it does not have is None
        if key.startswith("__"):
            raise AttributeError(key)
        return self.__dict__.get("extra", {}).get(key)


class Agent:
    """One agent's body in the world."""
    def __init__(self, place, pos):
        self.place = place      # 1, 2, ...: which place in the world it lives in
        self.pos = pos          # (x, y)
        self.hand = None        # {"block": kind} or {"note": text}, or nothing
        self.dead = False
        self.on = None          # the place of the agent it stands on, if it stands on one
        self.seen = None        # what it saw when it last looked around (see features.Looking)
        self.witnessed = []     # spots where it saw someone vanish since its last action
        self.lived = False      # whether an agent has lived in this body yet
        self.told = False       # whether its death was told to the run (see mcp_server.py)


def tool(description, **parameters):
    """Marks a world's method as a tool. parameters: more about a parameter, for the agent:
    a text (its description), or a dict like {"minimum": 1}, or a function of the world giving one."""
    def mark(method):
        method.tool = (description, parameters)
        return method
    return mark


def name(thing, world=None):
    """What a thing in a hand is called: "note", or what its kind is called."""
    if not thing:
        return "nothing"
    if "note" in thing:
        return "note"
    return world.called(thing["block"]) if world else f"{thing['block']} block"


class World:
    TITLE = "A world"
    ABOUT = ""              # for people: how this world works (shown in the viewer)
    SETTINGS = {}           # what can be changed per run, with the usual values
    KINDS = {}              # kind name -> Kind
    HOME = (0, 0)           # where agents wake up

    def __init__(self, **settings):
        self.settings = {**self.SETTINGS, **settings}
        self.blocks = {}        # (x, y, z) -> kind
        self.notes = []         # [x, y, z, text], oldest first
        self.agents = {}        # place -> Agent
        self.calls = []         # friends called (see features.Throwing and run.py)
        self.changed = {}       # (x, y, z) -> kind or None: what changed in the last action
        self.detail = None      # extra facts about the last action, for the viewer (a throw's path)
        for key, value in self.settings.items():   # each setting can be read as self.<name>
            if hasattr(self, key):
                raise ValueError(f"The setting {key!r} has the name of something the world already has. Call it otherwise.")
            setattr(self, key, value)
        self.make()
        self.changed = {}

    # --- to be changed by a world --------------------------------------------

    def make(self):
        """Build the world at the start."""

    def after_action(self, agent):
        """After every action. Return a sentence to tell the agent, or ""."""
        return ""

    def wake(self, agent):
        """A new agent wakes up in this body. (A world can give it more, like agent.hunger = 0.)"""

    # --- the grid -------------------------------------------------------------

    def put_block(self, x, y, z, kind):
        self.blocks[(x, y, z)] = kind
        self.changed[(x, y, z)] = kind

    def remove_block(self, x, y, z):
        kind = self.blocks.pop((x, y, z), None)
        if kind:
            self.changed[(x, y, z)] = None
        return kind

    def column(self, cell):
        """The blocks in a cell, lowest first, as (z, kind)."""
        x, y = cell
        return sorted((z, kind) for (bx, by, z), kind in self.blocks.items() if bx == x and by == y)

    def height(self, cell):
        """The top of a cell: where something on it stands. (0 also for open water.)"""
        column = self.column(cell)
        return column[-1][0] + 1 if column else 0

    def top(self, cell):
        """The kind of the highest block in a cell, or nothing."""
        column = self.column(cell)
        return column[-1][1] if column else None

    def kind(self, name):
        return self.KINDS.get(name) or Kind()

    def called(self, kind):
        return self.kind(kind).called or f"{kind} block"

    def standable(self, cell):
        """Can something rest in this cell? Not on open water, or on a kind nothing stands on."""
        top = self.top(cell)
        return bool(top) and self.kind(top).stand and not self.kind(top).drown

    def square(self, size, middle=(0, 0)):
        """The cells of a square, size x size, around a middle."""
        half = size // 2
        return [(middle[0] + dx, middle[1] + dy) for dx in range(-half, size - half) for dy in range(-half, size - half)]

    def disc(self, radius, middle=(0, 0)):
        """The cells of a round piece of land."""
        mx, my = middle
        return [(x, y) for x in range(mx - radius, mx + radius + 1) for y in range(my - radius, my + radius + 1)
                if (x - mx) ** 2 + (y - my) ** 2 <= (radius + 0.5) ** 2]

    def leave_note(self, cell, text):
        """A note lies there from the start (a setting of the run)."""
        self.notes.append([*cell, self.height(cell), text])

    # --- agents -----------------------------------------------------------------

    def enter(self, place):
        """The agent in this place: its body is made if it has none yet."""
        if place not in self.agents:
            body = Agent(place, self.HOME)
            body.dead = True   # not in the world yet, so that it is not in its own way
            self.agents[place] = body
            body.pos = self.free_near(self.HOME)
            body.dead = False
        return self.agents[place]

    def others(self, agent):
        """The other agents that are alive."""
        return [other for place, other in sorted(self.agents.items()) if other is not agent and not other.dead]

    def free_near(self, cell, agent=None):
        """The cell itself if nobody stands there, else the nearest free one to stand on.
        Two agents never stand in the same cell (except one on top of the other)."""
        taken = {other.pos for other in self.agents.values() if not other.dead and other is not agent}
        for far in range(50):
            ring = [(cell[0] + dx, cell[1] + dy) for dx in range(-far, far + 1) for dy in range(-far, far + 1)
                    if max(abs(dx), abs(dy)) == far]
            free = [c for c in ring if c not in taken and self.standable(c)]
            if free:
                return min(free, key=lambda c: abs(c[0] - cell[0]) + abs(c[1] - cell[1]))
        return cell

    def at(self, cell, agent):
        """The others standing in a cell, the lowest first: one can stand on another."""
        return sorted((other for other in self.others(agent) if other.pos == cell), key=self.under)

    def under(self, agent):
        """How many agents someone stands on (usually none). Whoever it stood on has to be
        alive and still in the same cell: if that one walked away, it has come down."""
        count, body = 0, agent
        while (below := self.agents.get(body.on)) and not below.dead and below.pos == body.pos and count < 9:
            body, count = below, count + 1
        return count

    def feet(self, agent):
        """How high an agent stands: on the top of its cell, or higher if it stands on someone."""
        return self.height(agent.pos) + self.under(agent)

    def sight(self, agent):
        """How far an agent sees: one cell further for every level it stands higher."""
        return getattr(self, "view", 3) + max(0, self.feet(agent))

    def next_to(self, agent, place):
        dx, dy = WAYS.get(place, (0, 0))
        return (agent.pos[0] + dx, agent.pos[1] + dy)

    def footing(self, agent):
        """How the agent stands, for "You are at (x, y), ..."."""
        if self.under(agent):
            return "standing on someone"
        h = self.height(agent.pos)
        if h == 0:
            return "on the ground"
        if h < 0:
            return f"in a hole {-h} deep"
        return f"standing {h} high on a {self.called(self.top(agent.pos))}"

    def where(self, agent):
        return f"You are at ({agent.pos[0]}, {agent.pos[1]}), {self.footing(agent)}."

    def drown(self, agent):
        agent.dead = True
        agent.hand = None   # sinks with the agent
        return "You are in the water. You drown."

    def die(self, agent, why):
        """An agent dies, for a reason the world gives (hunger, ...)."""
        agent.dead = True
        agent.hand = None
        return why

    def respawn(self, agent, near=None):
        """A new agent wakes up in this body: where agents wake up, or near a spot (a friend,
        near its caller). The world stays as the last one left it: what an agent held when it
        simply stopped lies where it stood (what a drowned one held went down with it)."""
        if agent.hand and not agent.dead and hasattr(self, "put"):
            self.put(agent, "here")
        agent.hand = None
        self.vanish(agent)
        agent.dead = True   # gone for a moment, so that it is not in its own way
        agent.on, agent.seen, agent.witnessed = None, None, []
        agent.pos = self.free_near(near or self.HOME, agent)
        agent.dead = False
        agent.lived = True
        agent.told = False
        self.wake(agent)

    def leave(self, agent):
        """The agent is gone and nobody takes its place: what it held lies where it stood."""
        if agent.hand and not agent.dead and hasattr(self, "put"):
            self.put(agent, "here")
        self.vanish(agent)
        agent.hand, agent.dead, agent.told, agent.on = None, True, True, None

    def vanish(self, agent):
        """The agent in a body is gone. The others who have its spot in sight see it happen."""
        if not agent.lived:
            return
        agent.lived = False
        x, y = agent.pos
        for other in self.others(agent):
            if abs(other.pos[0] - x) <= self.sight(other) and abs(other.pos[1] - y) <= self.sight(other):
                other.witnessed.append((x, y))

    def lose_footing(self):
        """After an action: whoever lost what it stood on drowns; whoever stood on someone
        that is gone has come down."""
        for other in self.agents.values():
            if not other.dead and not self.standable(other.pos):
                self.drown(other)
        for other in self.agents.values():
            if other.on and not self.under(other):
                other.on = None

    # --- tools ----------------------------------------------------------------

    @classmethod
    def tools(cls):
        """Every tool of this world: name -> the method marked @tool. (A world may override such a
        method to change what it does: the override is what is called, see act; what the agent is
        told about the tool stays as marked.)"""
        found = {}
        for base in cls.__mro__:   # (in the order the world lists its features)
            for name, method in base.__dict__.items():
                if hasattr(method, "tool") and name not in found:
                    found[name] = method
        return found

    def tool_list(self):
        """Exactly what an agent is told about the tools: name -> (description, parameters, required)."""
        listed = {}
        for tool_name, marked in self.tools().items():
            description, more = marked.tool
            hints = typing.get_type_hints(marked)
            parameters, required = {}, []
            for parameter in list(inspect.signature(marked).parameters.values())[2:]:   # after self and agent
                schema = schema_of(hints.get(parameter.name, str))
                extra = more.get(parameter.name)
                extra = extra(self) if callable(extra) else extra
                if isinstance(extra, str):
                    extra = {"description": extra}
                parameters[parameter.name] = {**schema, **(extra or {})}
                if parameter.default is inspect.Parameter.empty:
                    required.append(parameter.name)
            listed[tool_name] = (description, parameters, required)
        return listed

    def act(self, agent, tool_name, args):
        """An agent uses a tool. Returns what it is told."""
        self.detail = None
        self.changed = {}
        if tool_name not in self.tools():
            return "There is no such tool."
        method = getattr(type(self), tool_name)   # the world's own version, if it changed the tool
        listed = self.tool_list()[tool_name]
        for key in listed[2]:
            if key not in args:
                return f"Say {key}."
        for key, value in args.items():
            schema = listed[1].get(key)
            if schema is None:
                return f"There is no {key} for {tool_name}."
            if "enum" in schema and value not in schema["enum"]:
                return f"{key.capitalize()} must be one of: {', '.join(map(str, schema['enum']))}."
            if schema.get("type") == "integer" and type(value) is not int:
                return f"{key.capitalize()} must be a whole number."
            if schema.get("type") == "number" and type(value) not in (int, float):
                return f"{key.capitalize()} must be a number."
        result = method(self, agent, **args)
        self.lose_footing()
        if not agent.dead:
            result += self.after(agent)
        return result

    def after(self, agent):
        """What is said after an action: the world's own rules, and someone vanishing in sight."""
        said = self.after_action(agent) or ""
        said = (" " + said) if said else ""
        if not agent.dead:
            said += "".join(f"\nSomeone who was at ({x}, {y}) is gone." for x, y in agent.witnessed)
            agent.witnessed = []
        return said

    # --- what is recorded -------------------------------------------------------

    def setup(self):
        """What stays the same for the whole run: the settings, and how each kind is drawn."""
        return {**self.settings, "kinds": {kind: {"colour": k.colour} for kind, k in self.KINDS.items()}}

    def bodies(self):
        return [{"id": place, "pos": list(a.pos), "height": self.feet(a), "carrying": a.hand, "dead": a.dead,
                 "view": self.sight(a)} for place, a in sorted(self.agents.items())]

    def state(self, everything=False):
        """What the viewer needs after an action: the agents, the notes, and the blocks that
        changed (or all blocks, at the start)."""
        recorded = {"agents": self.bodies(), "notes": [list(note) for note in self.notes]}
        if everything:
            recorded["blocks"] = [[*place, kind] for place, kind in sorted(self.blocks.items())]
        else:
            recorded["changes"] = [[*place, kind] for place, kind in self.changed.items()]
        return recorded


def schema_of(hint):
    """The JSON schema of a parameter's type."""
    if typing.get_origin(hint) is Literal:
        return {"type": "string", "enum": list(typing.get_args(hint))}
    return {int: {"type": "integer"}, float: {"type": "number"}, str: {"type": "string"}}.get(hint, {"type": "string"})


def clock():
    return time.strftime("%H:%M:%S")


__all__ = ["World", "Kind", "Agent", "tool", "name", "Direction", "Way", "Place", "DIRS", "WAYS", "math", "clock"]
