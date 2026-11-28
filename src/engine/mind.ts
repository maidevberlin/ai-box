// What thinks for an agent: an AI program on this computer that a person is logged in to,
// like Claude Code or Codex. One is started for every agent. It is told texts, acts only by
// using its world's tools, and what goes on in it is heard and recorded.
//
// A mind offers the models of one or more providers: Claude Code those of Anthropic, pi those
// of every provider a person logged in to with it. A role's model names the kind of mind and
// the model as that mind names it: "claude/opus", "codex/gpt-6.2-sol", "pi/zai/glm-5".

import type { Readable } from 'node:stream';

/** One agent waking up: what its mind is given, and how it is heard. */
export interface Waking {
  /** The model, as this kind of mind names it ("opus"). Empty: its own usual one. */
  model: string;
  /** What it knows from the start: the system prompt. */
  knows: string;
  /** The first thing it is told. */
  told: string;
  /** Where it finds its world's tools (MCP over HTTP). None: it has no tools at all. */
  tools?: string;
  /** Where it runs: a folder whose path tells it nothing. */
  folder: string;
  thinks(text: string): void;
  writes(text: string): void;
  /** It ended its turn: it stopped talking. */
  stopped(): void;
  /** A line it said, as it came: for the run's transcript. */
  heard(line: string): void;
  /** Something went wrong: for the run's errors. */
  failed(text: string): void;
}

/** A mind that is running, for one agent. */
export interface Mind {
  /** It is told something after it stopped talking, and goes on. */
  tell(text: string): void;
  /** Its agent is gone. */
  end(): void;
}

/** A model a kind of mind offers, as the mind itself tells it. */
export interface Model {
  /** As the mind names it ("opus", "zai/glm-5"). */
  id: string;
  title: string;
  about: string;
  /** The one it uses when none is chosen. */
  usual: boolean;
}

/** Where a mind's models come from, as a person knows it. */
export interface Provider {
  /** "anthropic", "openai", "zai", "ollama": what the page shows its logo by. */
  id: string;
  /** "Claude", "ChatGPT", "Ollama". */
  title: string;
  models: Model[];
}

/** How far a mind is set up on this computer. */
export interface Setup {
  /** It is installed (for models on this computer: their server is running). */
  there: boolean;
  version?: string;
  /** Who is logged in to it, as a person reads it ("ana@example.com · ChatGPT Plus"). */
  account?: string;
}

export interface MindKind {
  /** As a person knows it: "Claude Code". */
  title: string;
  /** What a person gets with it, in a few words. */
  about: string;
  /** Where a person gets it themselves. */
  site: string;
  /** Installs it, into Tinkerlings' own folder: if Tinkerlings can. */
  install?(): Promise<void>;
  /** Its models run on this computer: no account, nothing leaves it. */
  local?: true;
  setup(): Promise<Setup>;
  /** Starts logging in, in the browser. `url`: the address to open, if it does not open one
   *  itself. `done` settles when the login is over: whether it worked. */
  login?(): Promise<{ url: string | null; done: Promise<boolean> }>;
  logout?(): Promise<void>;
  /** A mind that is given API keys (pi): the providers it takes one for, and keeping one. */
  keys?: {
    providers(): Promise<string[]>;
    /** The providers there is a key for. */
    kept(): Promise<string[]>;
    keep(provider: string, key: string): Promise<void>;
    forget(provider: string): Promise<void>;
  };
  /** The providers it offers models of. Asked every time: they change. Fails if the program
   *  is not there, or nobody is logged in to it. */
  providers(): Promise<Provider[]>;
  wake(waking: Waking): Mind;
}

/** "codex/gpt-6.2-sol": the kind of mind, and its model. */
export function parted(model: string): [kind: string, model: string] {
  const at = model.indexOf('/');
  return at < 0 ? [model, ''] : [model.slice(0, at), model.slice(at + 1)];
}

/** Calls `each` for every line that comes out of a stream. */
export function lines(stream: Readable, each: (line: string) => void): void {
  let rest = '';
  stream.on('data', chunk => {
    const all = (rest + chunk).split('\n');
    rest = all.pop()!;
    for (const line of all) if (line.trim()) each(line);
  });
}
