"""The worlds agents can be put into. One world is one file in this folder (core.py and
features.py are not worlds: they are what worlds are made of).

A world file holds one class built from World (core.py) and the features it wants
(features.py). See island.py for the smallest world, and magic.py for one with tricks.
Every world is drawn by the same drawing in the viewer (_draw.js), from the colours of its
kinds of block.
"""
import functools
import importlib
import inspect
import os

from .core import World

HERE = os.path.dirname(os.path.abspath(__file__))
NOT_WORLDS = {"core", "features"}


def names():
    return sorted(f[:-3] for f in os.listdir(HERE)
                  if f.endswith(".py") and not f.startswith("_") and f[:-3] not in NOT_WORLDS)


def load(name):
    """The world class in a world file."""
    module = importlib.import_module(f"worlds.{name}")
    found = [c for c in vars(module).values()
             if inspect.isclass(c) and issubclass(c, World) and c.__module__ == module.__name__]
    if len(found) != 1:
        raise LookupError(f"worlds/{name}.py must hold exactly one world class, it holds {len(found)}")
    return found[0]


@functools.lru_cache(maxsize=None)
def describe(name):
    """A world, the way the viewer shows it to people. (The same while the viewer runs.)"""
    world_class = load(name)
    fresh = world_class()
    fresh.enter(1)
    return {
        "name": name,
        "title": world_class.TITLE,
        "about": world_class.ABOUT,
        "settings": world_class.SETTINGS,
        "start": {"setup": fresh.setup(), "state": fresh.state(everything=True)},   # for a picture of it
        "tools": [{"name": tool, "description": description,
                   "parameters": [{"name": p, "required": p in required, **schema} for p, schema in parameters.items()]}
                  for tool, (description, parameters, required) in fresh.tool_list().items()],
    }
