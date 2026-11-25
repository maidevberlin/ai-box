"""The file a world is kept in, so that it outlives the agents and can be shared by them.

Several processes work on one world: one per agent that is alive (mcp_server.py), and
run.py. Whoever wants to look at the world or change it locks the file, reads the world,
does its thing, and writes the world back.
"""
import contextlib
import fcntl
import os
import pickle


@contextlib.contextmanager
def world_of(run, make=None):
    """The world of a run, for this process alone: gives [world, actions so far], and keeps
    what is in that list afterwards. If there is no world yet, make() makes it; without
    make it gives nothing."""
    path = os.path.join(run, "world.pickle")
    with open(path + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if os.path.exists(path):
            with open(path, "rb") as f:
                box = list(pickle.load(f))
        elif make:
            box = [make(), 0]
        else:
            yield None
            return
        yield box
        with open(path + ".part", "wb") as f:
            pickle.dump(tuple(box), f)
        os.replace(path + ".part", path)
