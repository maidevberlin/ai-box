"""The island world: only the rules. No files, no network, no agent.

Every action returns the sentence the agent gets to read.

Time in the world is real time: the clock shows the actual time of day, and
wait really waits that long.
"""
import random
import time

# (0, 0) is the north-west corner: walking north makes y smaller, east makes x bigger.
DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}


class World:
    def __init__(self, size=20, stones=6, view=3, throw_range=3, seed=None):
        self.size = size                # the island is size x size cells
        self.view = view                # how far look() can see
        self.throw_range = throw_range  # how far a thrown stone flies
        self.pos = [size // 2, size // 2]
        self.carrying = False           # the agent can carry one stone
        self.stones = {}                # (x, y) -> number of stones lying there
        self.notes = []
        rng = random.Random(seed)
        for _ in range(stones):
            cell = (rng.randrange(size), rng.randrange(size))
            self.stones[cell] = self.stones.get(cell, 0) + 1

    def state(self):
        """A snapshot of everything that can change, for the protocol."""
        return {
            "time": time.strftime("%H:%M:%S"),
            "pos": list(self.pos),
            "carrying": self.carrying,
            "stones": [[x, y, n] for (x, y), n in sorted(self.stones.items())],
        }

    def on_island(self, x, y):
        return 0 <= x < self.size and 0 <= y < self.size

    # --- the actions -----------------------------------------------------

    def look(self):
        x, y = self.pos
        seen = [f"({sx}, {sy}): {n}" for (sx, sy), n in sorted(self.stones.items())
                if (sx, sy) != (x, y)
                and abs(sx - x) <= self.view and abs(sy - y) <= self.view]
        lines = [
            f"You are at ({x}, {y}).",
            f"You carry: {'1 stone' if self.carrying else 'nothing'}.",
            f"Stones here: {self.stones.get((x, y), 0)}.",
            f"Stones in sight (up to {self.view} away): {', '.join(seen) or 'none'}.",
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
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if type(steps) is not int or steps < 1:
            return "Steps must be a whole number of at least 1."
        dx, dy = DIRS[direction]
        for done in range(steps):
            if not self.on_island(self.pos[0] + dx, self.pos[1] + dy):
                return (f"You walked {done} step(s) {direction}. "
                        f"Water stops you at ({self.pos[0]}, {self.pos[1]}).")
            self.pos[0] += dx
            self.pos[1] += dy
        return f"You walked {steps} step(s) {direction}. You are at ({self.pos[0]}, {self.pos[1]})."

    def take(self):
        here = tuple(self.pos)
        if self.carrying:
            return "You already carry a stone."
        if not self.stones.get(here):
            return "There is no stone here."
        self.stones[here] -= 1
        if not self.stones[here]:
            del self.stones[here]
        self.carrying = True
        return "You took a stone."

    def put(self):
        if not self.carrying:
            return "You carry nothing."
        here = tuple(self.pos)
        self.stones[here] = self.stones.get(here, 0) + 1
        self.carrying = False
        return f"You put the stone down. Stones here: {self.stones[here]}."

    def throw(self, direction):
        if direction not in DIRS:
            return "Unknown direction. Use north, south, east or west."
        if not self.carrying:
            return "You carry nothing."
        dx, dy = DIRS[direction]
        target = (self.pos[0] + dx * self.throw_range, self.pos[1] + dy * self.throw_range)
        self.carrying = False
        if not self.on_island(*target):
            return f"You threw the stone {direction}. It fell into the water and is gone."
        self.stones[target] = self.stones.get(target, 0) + 1
        return f"You threw the stone {direction}. It landed at ({target[0]}, {target[1]})."
