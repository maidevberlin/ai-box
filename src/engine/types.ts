// The engine: everything that is the same for every world, whatever the world is made of.
// Nothing in this folder knows about blocks.
//
// The engine starts the agents, hands them their tools, keeps the time, wakes agents up
// again, records what happens and ends the world.

// ---------------------------------------------------------------- settings

/** What a world lets a person set before it starts. The form is drawn from these. */
export type Setting =
  | { type: 'number'; title: string; usual: number; min?: number; max?: number }
  | { type: 'switch'; title: string; usual: boolean }
  | { type: 'choice'; title: string; usual: string; options: readonly string[] }
  | { type: 'choices'; title: string; usual: readonly string[]; options: readonly string[] }
  | { type: 'text'; title: string; usual: string };

export type Settings = Record<string, Setting>;

/** The values a person chose, typed from the settings the world declared. (Code that works
 *  for any world, like a reaction of a block kind, gets them untyped.) */
export type Chosen<S extends Settings> = 0 extends 1 & S ? Record<string, any> : {
  [K in keyof S]: S[K] extends { type: 'number' } ? number
    : S[K] extends { type: 'switch' } ? boolean
    : S[K] extends { type: 'choices' } ? string[]
    : string;
};

// ---------------------------------------------------------------- agents

/** A kind of agent in a world. The world's code declares its roles; a person starting a
 *  run can change the model, how many there are, and what they know and are told. */
export interface Role {
  title: string;
  /** How many of them are alive at the same time. */
  count: number;
  model: string;
  /** What it knows before it is told anything (the system prompt). */
  knows: string;
  /** What it is told once, when it wakes up. */
  told: string;
  /** When it dies or ends its turn: a new agent with an empty memory takes its place, the
   *  same agent wakes up again and remembers, or nobody follows. */
  afterDeath: 'new agent' | 'same agent' | 'nobody';
  /** How often its place is filled again. Left out: as long as the world lasts. */
  lives?: number;
  /** Tools switched off for this role only (only tools the world does not need). */
  without?: readonly string[];
}

/** One agent that is alive, as the world sees it. */
export interface Agent {
  /** Its place in the world: stays the same when a new agent follows a dead one. */
  place: number;
  /** Which agent of the world it is: 1 for the first that woke up, 2 for the next... */
  number: number;
  role: string;
  /** Woken up again after dying, with its memory. */
  again: boolean;
}

// ---------------------------------------------------------------- tools

export type Arg =
  | { type: 'number'; about?: string; min?: number; max?: number; whole?: true; optional?: true }
  | { type: 'text'; about?: string; optional?: true }
  | { type: 'one of'; options: readonly string[]; about?: string; optional?: true };

export type Args = Record<string, Arg>;

type GivenOne<A extends Arg> = A extends { type: 'number' } ? number
  : A extends { type: 'one of'; options: readonly (infer O)[] } ? O
  : string;

/** What an agent gave for a tool's arguments. An optional one may be missing. */
export type Given<A extends Args> =
  { [K in keyof A as A[K] extends { optional: true } ? never : K]: GivenOne<A[K]> }
  & { [K in keyof A as A[K] extends { optional: true } ? K : never]?: GivenOne<A[K]> };

/** Something an agent can do. `about` is all the agent is told about it. The answer is
 *  what the agent reads. It may come later: a tool can wait for something to happen. */
export interface Tool<W, B, A extends Args = Args> {
  about: string;
  args: A;
  /** The world does not work without it: it cannot be switched off. */
  needed?: true;
  run(world: W, me: B, args: Given<A>): string | Promise<string>;
}

// ---------------------------------------------------------------- what the engine gives a world

export interface Host {
  /** Something an agent notices without having asked: it is added to the answer of its
   *  next action, and it ends a `wait`. (Something said nearby, a block that fell.)
   *  The text may be worked out only when the agent is told: then it says how things are at
   *  that moment. Of several notices `about` the same thing, the agent is told once. */
  notice(place: number, text: string | (() => string), about?: string): void;
  /** An agent died in the world. The engine does what its role says comes after. */
  died(place: number, why: string): void;
  /** The world ends by itself, for this reason. */
  over(why: string): void;
  /** Chance: the same again for the same seed. From 0 up to, not including, 1. */
  random(): number;
  /** Seconds since the world started. */
  now(): number;
  /** Do something later. Returns how to call it off. This is all the time a world has:
   *  nothing happens by itself unless somebody asked for it this way. */
  after(seconds: number, what: () => void): () => void;
  /** Something for the record besides the picture: the path of a throw for the viewer, or
   *  a fact to count later ("both stayed silent"). */
  record(what: string, data: unknown): void;
}

// ---------------------------------------------------------------- a world, as the engine sees it

export interface World {
  /** An agent wakes up in its place (the first time, or again). */
  wake(agent: Agent): void;
  /** Nobody follows in this place: its body leaves the world. */
  leave(place: number): void;
  /** What this agent can do. */
  tools(agent: Agent): Record<string, Tool<any, any, any>>;
  /** An agent uses a tool. The arguments have been checked against the tool's `args`. */
  act(agent: Agent, tool: string, args: Record<string, unknown>): string | Promise<string>;
  /** Everything the viewer needs to draw the world as it is now. Its form belongs to the
   *  base the world is built on; the engine only stores it. */
  picture(): unknown;
  /** What changed in the picture since this was last asked, or nothing. */
  changes(): unknown;
}

export interface WorldDefinition<S extends Settings = Settings> {
  name: string;
  title: string;
  /** For people: shown on the start screen. Agents never see it. */
  about: string;
  settings: S;
  /** Which drawing the viewer uses for the pictures of this world: "blocks". */
  drawnBy: string;
  /** How long it lasts unless a person says otherwise. */
  minutes: number;
  roles(chosen: Chosen<S>): Record<string, Role>;
  create(chosen: Chosen<S>, host: Host): World;
}

/** The usual value of every setting. */
export function usual<S extends Settings>(settings: S): Chosen<S> {
  return Object.fromEntries(Object.entries(settings).map(([name, setting]) =>
    [name, Array.isArray(setting.usual) ? [...setting.usual] : setting.usual])) as Chosen<S>;
}
