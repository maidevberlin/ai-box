# AI Box: what we want to build

> Working notes.
> "Settled" is what we agreed on. "Open" is still being discussed: nothing there is decided.

## The idea

An engine for putting AI agents into worlds and watching what they do. The engine provides
the steps every experiment needs. People extend it with their own worlds, written as code.

Fixed, in every world:

- Agents end up in one world and have tools to interact with it. Nothing else.
- Nobody talks to an agent from outside while it lives.
- A world ends after a time, or when all its agents are dead.

## Settled

1. **Worlds are 3D block worlds first.** We build one base, "blocks in 3D", and show it with
   several different worlds. The engine should not make other kinds of world impossible, but
   we do not build or promise them now.
2. **Agents are configurable:** model, whether memory is kept after death, the first prompt,
   and so on. A run has either agents that are all the same, or custom agents.
3. **Every tool can be switched on and off,** for the world and per custom agent. A world can
   add its own tools. We provide a good set.
4. **The world has its own clock.**
5. **What is in a world:** blocks with different properties (as in Minecraft), items (a note,
   a fruit), agents, and creatures (not AI). A tree that drops fruit must be easy to build.
6. **Agents can talk directly.** What is said is heard in full nearby, with random words
   missing further away, as "..." further still, and not at all beyond that. A speaker who
   stands higher than the listener is heard further. Agents can throw and catch. Everything
   else should evolve.
7. **A world is code.** A world can declare settings (switches, single and multiple choice,
   numbers) from which the form to set it up is drawn. Everything else is code.
8. **The world says what is evaluated.**
9. **The desktop app is for watching and starting worlds,** and maybe importing and exporting
   worlds and runs.

## Decided in the discussion

- **Two layers.** The engine knows nothing about blocks: agents, tools, the clock, the run,
  the record. The block base sits on top: the grid, falling, sight, hearing, throwing, items,
  creatures, and the 3D drawing. Worlds extend the block base. Engine code never uses
  anything from the block base.
- **With or without the map.** Every block world has one switch for how places are said to
  its agents: by their position on the map ("(3, 4)", and an agent is told where it is), or
  only by the steps from where the agent stands ("(2 east, 1 north)", and it is never told
  where it is). The grid underneath is the same. Both ways are in `src/blocks/places.ts`,
  and every sentence that speaks of a place gets it from there (`world.at(me, cell)`).
- **Tricks belong to kinds of block,** not to tools: a block is sticky, floats, or reacts to
  being put down, jumped on or thrown. So a kind can be used in any world.
- **A world says which tools it needs.** Only the others can be switched off.
- **Time is real time.** There are no ticks and no rounds: whoever wants something to happen
  later asks the world for it (`world.after`, `world.every`). A block's requests are called
  off when the block is gone. A world that asks for nothing has no time of its own.
- **What an agent did not ask for** (something said nearby) reaches it with the answer to its
  next action. A tool `wait` returns as soon as there is something to notice.
- **Dying, leaving and stopping are three things**, each set by itself:
  - An agent *dies* in its world (it drowns, it starves). It is gone, or it comes back
    where agents wake up and remembers.
  - An agent *leaves* with a tool, or the world ends its part (it has made its one
    decision). That is always for good.
  - An agent *stops talking* (it ends its turn). Nothing happens to it: it stays where it
    is, and after a while it is told what its senses tell it, which in a block world is
    what looking around says. It is never told anything from outside its world. A run can
    also say that stopping is leaving, as on the first islands.

  Whether a new agent takes the place of one that is gone is one more switch. If nobody
  does, the world ends with its last agent.
- **In a block world, everything an agent can do is a verb.** Some it does itself (walk,
  say, leave), some it does to a thing it points at: by where it is, by "hand", or by a
  name it gave. A thing is a block, an item, or somebody (a creature, another agent).
  **The thing owns what happens:** its kind says that a verb can be done to it, or why
  not, or does it its own way. So eating a fruit is written with the fruit, not in a verb
  "eat" that knows about fruit. A verb only knows how it usually goes (take, destroy), if
  it usually goes one way at all. A verb that no kind allows is not offered.
  To the engine, and to the agent, every verb is a tool.
- **Tools are switched on and off per run**, on the start screen, for each role. A world
  marks the tools it does not work without; those stay on.
- **Roles are declared in the world's code.**
- **Everything carried is an item.** A block that is taken becomes an item, and a block
  again when it is put down.

## Put off

- **Sharing worlds.** Worlds are shared through git for now.
- **Evaluation.** For now one reviewer sums up what happened in a run. What a world wants
  measured or judged comes later.

## Ideas to talk through next

- **Walking by angle and distance** instead of steps north, south, east or west. Throwing
  already takes an angle and a power.
- **Angles and distances everywhere?** Also in what looking around says about where
  things are. Open: whether that makes the world easier or harder for an agent to picture.

## Where it is built

- `src/engine/`: the engine. `types.ts` says what a world is to the engine.
- `src/blocks/`: the block base. `types.ts` says what a block world's code can use.
- `src/worlds/`: the worlds, one file each.
- `src/viewer/`: the web page for watching and starting worlds.
- `test/`: the worlds tried without any AI.
