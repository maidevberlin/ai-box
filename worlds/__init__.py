"""The worlds an agent can be put into. One world is one file in this folder.

To invent a world, copy island.py to a new name and change it. A world file has:

  TITLE     its name, for people
  ABOUT     a text for people: what this world is and how it works. Shown in the viewer.
            (Blank lines separate paragraphs; lines starting with "- " become a list.)
  SETTINGS  what can be changed per run, with the usual values.
            Set for a run as WORLD_<NAME>, for example WORLD_SIZE=30.
  World     a class, created with the settings. Every method named in tools() is something
            the agent can do, and returns the sentence the agent gets to read. It also has:
              setup()   what stays the same for the whole run
              state()   everything that can change; recorded after every action
              detail    extra facts about the last action for the viewer, or None
            and, if agents can die in this world:
              dead      True from the moment the agent dies
              respawn() called when a new agent wakes up in the world the dead one left
  tools(world)
            exactly what the agent is told about each tool:
            name -> (description, parameters, required parameters)
  picture(setup, state)
            optional: the world as text

How a world is drawn in the viewer is a file of the same name ending in .js (see island.js).
Without one, the viewer shows the world's state as plain text.
"""
import importlib
import os


def names():
    here = os.path.dirname(os.path.abspath(__file__))
    return sorted(f[:-3] for f in os.listdir(here) if f.endswith(".py") and not f.startswith("_"))


def load(name):
    return importlib.import_module(f"worlds.{name}")


def describe(name):
    """A world, the way the viewer shows it to people."""
    module = load(name)
    tools = module.tools(module.World(**module.SETTINGS))
    return {
        "name": name,
        "title": module.TITLE,
        "about": module.ABOUT,
        "settings": module.SETTINGS,
        "tools": [{"name": tool, "description": description,
                   "parameters": [{"name": p, "required": p in required, **schema}
                                  for p, schema in parameters.items()]}
                  for tool, (description, parameters, required) in tools.items()],
    }
