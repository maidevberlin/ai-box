# AI Box: what we want to build

> Working notes for the new version (TypeScript). The Python version is in `archive/`.
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
- **Tricks belong to kinds of block,** not to tools: a block is sticky, floats, or reacts to
  being put down, jumped on or thrown. So a kind can be used in any world.
- **A world says which tools it needs.** Only the others can be switched off.
- **Time is real time.** There are no ticks and no rounds: whoever wants something to happen
  later asks the world for it (`world.after`, `world.every`). A block's requests are called
  off when the block is gone. A world that asks for nothing has no time of its own.
- **What an agent did not ask for** (something said nearby) reaches it with the answer to its
  next action. A tool `wait` returns as soon as there is something to notice.
- **After a death** the usual is: the world goes on, and a new agent or the same agent
  (with its memory) wakes up. A world can also say that nobody follows; then it ends when
  its last agent has died.
- **Roles are declared in the world's code.**
- **Everything carried is an item.** A block that is taken becomes an item, and a block
  again when it is put down.

## Put off

- **Sharing worlds.** Worlds are shared through git for now.
- **Evaluation.** For now one reviewer sums up what happened in a run. What a world wants
  measured or judged comes later.

## Where it is built

- `src/engine/`: the engine. `types.ts` says what a world is to the engine.
- `src/blocks/`: the block base. `types.ts` says what a block world's code can use.
- `src/worlds/`: the worlds, one file each.
- `src/viewer/`: the web page for watching and starting worlds.
- `test/`: the worlds tried without any AI.
