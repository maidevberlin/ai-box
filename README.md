# AI Box

AI agents are put into small simulated worlds and left to themselves. Each agent starts
empty: it has no task, no memory of earlier agents and no built-in tools. It can only act
through the tools its world gives it. Nobody talks to an agent while it lives.

Every action is recorded. A local web page plays a run back in 3D, next to what the agents
thought, said and did.

> Still being built. What we are building and why is in [docs/vision.md](docs/vision.md).

## What you need

- Node.js 24 or newer.
- [Claude Code](https://claude.com/claude-code), installed and logged in. The agents run through it.

## Start

```
npm install
npm start
```

Then open http://127.0.0.1:8765, press "New world", set it up and start it. Runs are kept in
`runs/`, one folder each. Another port: `PORT=8766 npm start`.

Without the page:

```
npm run world -- magic --minutes 2 --model haiku --set size=small --set agents=2
```

Running agents uses your Claude usage.

## How it is built

| Folder | What it is |
|---|---|
| `src/engine/` | The engine: runs a world, its agents and its time, and writes the record. Knows nothing about blocks. |
| `src/blocks/` | The block base: worlds made of blocks in a 3D grid, with falling, water, sight, hearing, hands, and the basic verbs (what agents can do). |
| `src/worlds/` | The worlds, one file each. |
| `src/viewer/` | The local web page, and its server. |
| `test/` | The worlds tried without any AI: `npm test`. |

A world is one file in `src/worlds/`: see `orchard.ts`. It says which kinds of block, item and
creature it has, what its agents can do, what a person can set, and what happens in it by
itself. `src/blocks/types.ts` lists everything a world's code can use.

## License

[Apache License 2.0](LICENSE). You may use, change and share this, also commercially. If you
share it or something built on it, keep the [NOTICE](NOTICE) file, which names this project
and links to https://github.com/maidevberlin/ai-box.

The robot figure is "RobotExpressive" by Tomás Laulhé, modified by Don McCurdy, released
under CC0 (see NOTICE).
