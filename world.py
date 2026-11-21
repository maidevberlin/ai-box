"""The island world: only the rules. No files, no network, no agent.

The island is a grid of cells. Each cell holds a stack of blocks (often none), and
the agent stands on top of the stack in its cell. Every action returns the sentence
the agent gets to read.

Time in the world is real time: the clock shows the actual time of day, and
wait really waits that long.
"""
import math
import random
import time

# (0, 0) is the north-west corner: walking north makes y smaller, east makes x bigger.
DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
PLACES = ["here", *DIRS]  # where take and put can reach
REACH = 2                 # take/put reach stacks at most this much higher or lower than your feet
GRAVITY = 9.8             # blocks per second squared
THROW_SPEED = 1.5         # blocks per second, per point of power
HAND = 1.5                # a throw starts this high above your feet


class World:
    def __init__(self, size=20, blocks=30, view=3, jump=2, seed=None):
        self.size = size          # the island is size x size cells
        self.view = view          # how far look() can see from the ground
        self.max_jump = jump      # the strongest jump, in blocks
        self.pos = (size // 2, size // 2)
        self.carrying = False     # the agent can carry one block
        self.blocks = {}          # (x, y) -> height of the stack there
        self.notes = []
        self.flight = None        # the path of the last thrown block, for the viewer to animate
        rng = random.Random(seed)
        for _ in range(blocks):
            self.add((rng.randrange(size), rng.randrange(size)), 1)

    def state(self):
        """A snapshot of everything that can change, for the protocol."""
        return {
            "time": time.strftime("%H:%M:%S"),
            "pos": list(self.pos),
            "carrying": self.carrying,
            "view": self.sight(),
            "blocks": [[x, y, n] for (x, y), n in sorted(self.blocks.items())],
        }

    # --- helpers ---------------------------------------------------------

    def on_island(self, cell):
        return 0 <= cell[0] < self.size and 0 <= cell[1] < self.size

    def height(self, cell):
        return self.blocks.get(cell, 0)

    def add(self, cell, n):
        """Make the stack at a cell n blocks higher (or lower)."""
        self.blocks[cell] = self.height(cell) + n
        if not self.blocks[cell]:
            del self.blocks[cell]

    def sight(self):
        """How far the agent sees: one cell further for every block it stands on."""
        return self.view + self.height(self.pos)

    def next_to(self, place):
        """The cell that 'here', 'north', ... means from where the agent stands."""
        dx, dy = DIRS.get(place, (0, 0))
        return (self.pos[0] + dx, self.pos[1] + dy)

    def where(self):
        h = self.height(self.pos)
        on = f"standing on {h} block(s)" if h else "on the ground"
        return f"You are at ({self.pos[0]}, {self.pos[1]}), {on}."

    # --- the actions -----------------------------------------------------

    def look(self):
        x, y = self.pos
        seen = [f"({sx}, {sy}): {n}" for (sx, sy), n in sorted(self.blocks.items())
                if (sx, sy) != self.pos
                and abs(sx - x) <= self.sight() and abs(sy - y) <= self.sight()]
        lines = [
            self.where(),
            f"You carry: {'1 block' if self.carrying else 'nothing'}.",
            f"Stacks in sight (up to {self.sight()} away), as position: height: "
            f"{', '.join(seen) or 'none'}.",
        ]
        if self.notes:
            lines.append("Your notes:")
            lines += [f"  {i}. {text}" for i, text in enumerate(self.notes, 1)]
        return "\n".join(lines)

    def clock(self):
        return f"It is {time.strftime('%H:%M:%S')}."

    def wait(self, seconds):
        if type(seconds) is not int or seconds < 1:
            return "Seconds must be a whole number of at least 1."
        time.sleep(seconds)
        return f"You waited {seconds} second(s)."

    def note(self, text):
        self.notes.append(str(text))
        return f"Noted. You have {len(self.notes)} note(s)."

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
                return f"{walked} Water stops you. {self.where()}"
            if self.height(ahead) > self.height(self.pos):
                return (f"{walked} A stack of {self.height(ahead)} block(s) at "
                        f"({ahead[0]}, {ahead[1]}) is in your way. {self.where()}")
            self.pos = ahead
        return f"You walked {steps} step(s) {direction}. {self.where()}"

    def jump(self, direction, strength=1):
        """Jump onto the next cell. Strength is how many blocks up the agent gets."""
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if type(strength) is not int or not 1 <= strength <= self.max_jump:
            return f"Strength must be a whole number from 1 to {self.max_jump}."
        ahead = self.next_to(direction)
        if not self.on_island(ahead):
            return f"You jumped, but to the {direction} there is only water. {self.where()}"
        rise = self.height(ahead) - self.height(self.pos)
        if rise > strength:
            return (f"You jumped {strength} block(s) high, but the stack at ({ahead[0]}, {ahead[1]}) "
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
        """Take the top block of a stack. Taking the one under your feet lowers you."""
        cell = self.reach(where)
        if isinstance(cell, str):
            return cell
        if self.carrying:
            return "You already carry a block."
        if not self.height(cell):
            return "There is no block."
        self.add(cell, -1)
        self.carrying = True
        return f"You took a block. {self.where()}"

    def put(self, where="here"):
        """Put the block on top of a stack. Putting it under your own feet lifts you."""
        cell = self.reach(where)
        if isinstance(cell, str):
            return cell
        if not self.carrying:
            return "You carry nothing."
        self.add(cell, 1)
        self.carrying = False
        return (f"You put the block down at ({cell[0]}, {cell[1]}). "
                f"The stack there is {self.height(cell)} high. {self.where()}")

    def throw(self, direction, angle, power):
        """The block flies the curve of a thrown object and lands where it comes down.

        direction: compass degrees (0 north, 90 east). angle: degrees above the ground.
        """
        if any(type(value) not in (int, float) for value in (direction, angle, power)):
            return "Direction, angle and power must be numbers."
        if not 0 <= angle <= 90 or not 1 <= power <= 10:
            return "Angle must be from 0 to 90 and power from 1 to 10."
        if not self.carrying:
            return "You carry nothing."
        self.carrying = False
        speed = power * THROW_SPEED
        forward = speed * math.cos(math.radians(angle))
        up = speed * math.sin(math.radians(angle))
        dx, dy = math.sin(math.radians(direction)), -math.cos(math.radians(direction))
        start = self.height(self.pos) + HAND
        over = self.pos  # the cell the block is flying over
        path = [[self.pos[0] + 0.5, self.pos[1] + 0.5, start]]
        self.flight = {"path": path}
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
                    self.flight["lost"] = True
                    return "You threw the block. It fell into the water and is gone."
                if z < self.height(ahead):  # flew into the side of a stack: drops in front of it
                    hit = f"It hit the side of the stack at ({ahead[0]}, {ahead[1]}) and dropped. "
                    return "You threw the block. " + hit + self.land(over)
                over = ahead
            if z <= self.height(over):      # came down on top of whatever is there
                return "You threw the block. " + self.land(over)

    def land(self, cell):
        self.add(cell, 1)
        self.flight["path"].append([cell[0] + 0.5, cell[1] + 0.5, self.height(cell) - 0.5])  # where it rests
        if cell == self.pos:
            return f"It landed at your feet. {self.where()}"
        return f"It landed at ({cell[0]}, {cell[1]}). The stack there is {self.height(cell)} high."
