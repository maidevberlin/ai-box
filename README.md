# Tinkerlings

AI agents are put into small simulated worlds and left to themselves. Each agent starts
empty: it has no task, no memory of earlier agents and no built-in tools. It can only act
through the tools its world gives it. Nobody talks to an agent while it lives.

Every action is recorded. A local web page plays a run back in 3D, next to what the agents
thought, said and did.

> Still being built. What we are building and why is in [docs/vision.md](docs/vision.md).

## Install

One line, then Tinkerlings opens in your browser. It shows you the rest.

**Mac or Linux:** open the Terminal, paste this, press Enter:

```
curl -fsSL https://raw.githubusercontent.com/maidevberlin/tinkerlings/main/install.sh | sh
```

**Windows:** open PowerShell, paste this, press Enter:

```
irm https://raw.githubusercontent.com/maidevberlin/tinkerlings/main/install.ps1 | iex
```

Keep the window open while you use Tinkerlings: closing it ends Tinkerlings. To start it again
later, double-click "Tinkerlings" on your desktop, or run the same line. Each start fetches the
newest version.

Everything goes into one folder, `.tinkerlings` in your home folder, and nothing needs admin
rights. To remove Tinkerlings, delete that folder and the icon on the desktop.

The agents think with an AI you already use. Tinkerlings helps you connect one under "AI
connections":

- [Claude Code](https://claude.com/claude-code), with a Claude subscription or an Anthropic account.
- [Codex](https://developers.openai.com/codex), with a ChatGPT account.
- [Gemini](https://antigravity.google/docs/cli/reference), through Antigravity, with a Google account. It also offers some Claude models and OpenAI's open one.
- [pi](https://pi.dev), with API keys for Z.ai (GLM), DeepSeek, OpenRouter, Mistral and many more.
- Models on this computer: [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai) or
  llama.cpp's server.

Running agents uses your usage of that AI.

## From the code

With Node.js 24 or newer:

```
npm install
npm start
```

Then open http://127.0.0.1:8765. Runs are kept in `runs/`, one folder each. Another port:
`PORT=8766 npm start`. What Tinkerlings installs and logs in to for the AIs is kept in
`~/.tinkerlings/ais`.

Without the page:

```
npm run world -- magic --minutes 2 --model claude/haiku --set size=small --set agents=2
```

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
and links to https://github.com/maidevberlin/tinkerlings.

The robot figure is "RobotExpressive" by Tomás Laulhé, modified by Don McCurdy, released
under CC0 (see NOTICE).
