# AI Box

AI agents are put into small simulated worlds and left to themselves. Each agent starts
empty: it has no task, no memory of earlier agents and no built-in tools. It can only act
through the tools its world gives it. Nobody talks to an agent while it lives.

Every action is recorded. A local web page plays a run back in 3D, next to what the agents
thought, said and did.

> Still being built. What we are building and why is in [docs/vision.md](docs/vision.md).

## What you need

- Node.js 24 or newer.
- At least one AI the agents run through. Any of these, as many as you like:
  - [Claude Code](https://claude.com/claude-code), logged in with a Claude subscription or an Anthropic account.
  - [Codex](https://developers.openai.com/codex), with a ChatGPT account. AI Box keeps its own Codex
    login, apart from yours: log it in once with `CODEX_HOME=~/.ai-box/codex codex login`.
  - [pi](https://pi.dev), with any provider it can log in to: subscriptions, or API keys for Z.ai (GLM),
    DeepSeek, OpenRouter, Mistral and many more. AI Box keeps its own pi login too:
    `PI_CODING_AGENT_DIR=~/.ai-box/pi pi auth login <provider>`.
  - Models on this computer: [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai) or
    llama.cpp's server, running at their usual address.

  The start page asks each of them which models it has, and offers those: first who provides
  the model, then the model.

## Start

```
npm install
npm start
```

Then open http://127.0.0.1:8765. The dashboard shows the way in: connect an AI under "AI
connections", then press "New run", set it up and start it. Runs are kept in `runs/`, one folder
each. "Settings" deletes them again, or starts over as if AI Box had just been installed. Another port: `PORT=8766 npm start`.

Without the page:

```
npm run world -- magic --minutes 2 --model claude/haiku --set size=small --set agents=2
```

Running agents uses your usage of that AI.

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
