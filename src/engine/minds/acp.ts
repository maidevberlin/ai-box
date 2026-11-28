// Agents that speak ACP, the Agent Client Protocol (agentclientprotocol.com): the language
// editors like Zed talk to coding agents in. Antigravity (Gemini), Grok Build and others speak
// it, so one driver serves them all. What differs between them is said by each (see Speaker).
//
// JSON-RPC, one message per line on stdin and stdout. One session for the agent, one prompt
// for every text it is told: when the prompt is answered, it has stopped talking. The world's
// tools are handed to the session as an MCP server. The agent asks before it uses a tool: the
// world's tools are allowed, anything else is refused. Tinkerlings offers it no files and no
// terminal of its own.
//
// One agent may offer the models of several makers (Antigravity has Claude's too): they are
// told apart by their names.

import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lines, type MindKind, type Model, type Provider, type Setup, type Waking } from '../mind.ts';
import { start, version } from '../programs.ts';

/** What one agent that speaks ACP is like. */
export interface Speaker {
  title: string;
  about: string;
  site: string;
  /** The program, and how it is started to speak ACP. */
  program: string;
  args: string[];
  /** What it is logged in with: "Google". */
  account: string;
  /** Whose a model it offers is, as a person knows them. */
  maker(model: string): { id: string; title: string };
  install?(): Promise<void>;
  /** What else it is started with, for one agent: how its own tools and settings are switched
   *  off, and how it is told what it knows (ACP has no place for that: `meta` goes with the
   *  new session, as the agent's own addition to the protocol). */
  bare(waking: Pick<Waking, 'knows' | 'folder'>): { args?: string[]; env?: Record<string, string>; meta?: object };
  /** It can open a session it was in before again (ACP's session/load). */
  resumes?: true;
  /** Which of the ways it offers to log in is logging in in the browser. */
  signIn?(methods: { id: string; name: string }[]): string | undefined;
}

type Session = { sessionId: string; models?: { availableModels?: { modelId: string; name?: string; description?: string | null }[]; currentModelId?: string };
                 configOptions?: { id: string; category?: string; currentValue?: string; options?: { value: string; name?: string; description?: string | null }[] }[] };

/** An agent that speaks ACP: asks and is answered, and says what goes on in its session.
 *  `permit`: whether it may use a tool it asks about. */
function speaking(speaker: Speaker, folder: string, extra: { args?: string[]; env?: Record<string, string> },
                  heard: (message: any) => void, failed: (text: string) => void, permit: (call: any) => boolean = () => false) {
  const process: ChildProcess = start(speaker.program, [...speaker.args, ...extra.args ?? []],
                                      { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'], env: { ...globalThis.process.env, ...extra.env } });
  const asked = new Map<number, { answered: (result: any) => void; refused: (error: Error) => void }>();
  let next = 0;
  const write = (message: object) => process.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  process.on('error', error => failed(`${error}\n`));
  process.on('close', () => { for (const { refused } of asked.values()) refused(new Error(`${speaker.title} ended.`)); });
  process.stderr!.on('data', chunk => failed(String(chunk)));
  lines(process.stdout!, line => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    heard(message);
    if (message.id !== undefined && message.method === 'session/request_permission') {
      const { options = [], toolCall } = message.params ?? {};
      const kind = permit(toolCall) ? 'allow' : 'reject';
      const option = options.find((found: any) => found.kind === `${kind}_once`) ?? options.find((found: any) => String(found.kind).startsWith(kind));
      write({ id: message.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } });
    } else if (message.id !== undefined && message.method) {   // files, a terminal: it has none of those here
      write({ id: message.id, error: { code: -32601, message: 'Not offered.' } });
    } else if (message.id !== undefined) {
      const waiting = asked.get(message.id);
      asked.delete(message.id);
      if (message.error) waiting?.refused(Object.assign(new Error(message.error.message ?? 'It refused.'), { code: message.error.code }));
      else waiting?.answered(message.result);
    }
  });
  const ask = (method: string, params: object) => new Promise<any>((answered, refused) => {
    asked.set(++next, { answered, refused });
    write({ id: next, method, params });
  });
  const begun = ask('initialize', {
    protocolVersion: 1, clientInfo: { name: 'tinkerlings', title: 'Tinkerlings', version: '1' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  return { process, begun, ask: (method: string, params: object) => begun.then(() => ask(method, params)) };
}

/** The models a session offers: in its list of models (each as hard as it thinks, if it says
 *  so), or else as its setting "model". */
function offered(session: Session): Model[] {
  const { availableModels = [], currentModelId } = session.models ?? {};
  if (availableModels.length) {
    return availableModels.map(model => ({ id: model.modelId, title: model.name ?? model.modelId, about: model.description ?? '', usual: model.modelId === currentModelId }));
  }
  const setting = session.configOptions?.find(option => option.category === 'model' || option.id === 'model');
  return (setting?.options ?? []).map(option => ({ id: option.value, title: option.name ?? option.value, about: option.description ?? '', usual: option.value === setting!.currentValue }));
}

/** Chooses a session's model: in the way it offers them. */
function choose(ask: (method: string, params: object) => Promise<any>, session: Session, model: string): Promise<unknown> {
  const setting = session.configOptions?.find(option => option.category === 'model' || option.id === 'model');
  return session.models?.availableModels?.length || !setting ? ask('session/set_model', { sessionId: session.sessionId, modelId: model })
    : ask('session/set_config_option', { sessionId: session.sessionId, configId: setting.id, value: model });
}

/** The names of a world's tools, from its tools server. */
async function toolNames(url: string): Promise<string[]> {
  const call = (method: string, params: object) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(answer => answer.json() as Promise<any>);
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tinkerlings', version: '1' } });
  return ((await call('tools/list', {})).result?.tools ?? []).map((tool: { name: string }) => tool.name);
}

/** Whether a tool call it asks about is one of the world's tools: by its name. */
const ofTheWorld = (names: string[], call: any) => {
  const said = `${call?.name ?? ''} ${call?.title ?? ''} ${call?.toolCallId ?? ''}`;
  return names.some(name => new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`, 'i').test(said));
};

export function acp(speaker: Speaker): MindKind {
  /** Starts it in a neutral folder only to open a session, and ends it again. */
  const session = () => new Promise<{ methods: { id: string; name: string }[]; session: Session }>((resolve, reject) => {
    const folder = join(tmpdir(), 'w');
    mkdirSync(folder, { recursive: true });
    const agent = speaking(speaker, folder, speaker.bare({ knows: '', folder }), () => {}, () => {});
    const done = (error: Error | null, found?: { methods: { id: string; name: string }[]; session: Session }) => {
      clearTimeout(late);
      agent.process.kill();
      if (error) reject(error);
      else resolve(found!);
    };
    const late = setTimeout(() => done(new Error(`${speaker.title} did not answer.`)), 30_000);
    agent.process.on('error', error => done(error));
    agent.begun.then(async init => {
      const methods = init?.authMethods ?? [];
      done(null, { methods, session: await agent.ask('session/new', { cwd: folder, mcpServers: [] }) });
    }).catch(error => done(error));
  });

  return {
    title: speaker.title,
    about: speaker.about,
    site: speaker.site,
    install: speaker.install,

    async setup(): Promise<Setup> {
      const installed = await version(speaker.program);
      if (!installed) return { there: false };
      // (Logged in is what it is when it opens a session.)
      const open = await session().then(() => true, () => false);
      return { there: true, version: installed, account: open ? `Logged in with ${speaker.account}` : undefined };
    },

    /** It logs in by itself, in the browser, when asked to in the way it offers for that. */
    login: speaker.signIn && (async () => {
      const folder = join(tmpdir(), 'w');
      mkdirSync(folder, { recursive: true });
      const agent = speaking(speaker, folder, speaker.bare({ knows: '', folder }), () => {}, () => {});
      const init = await agent.begun;
      const method = speaker.signIn!(init?.authMethods ?? []);
      const done = method ? agent.ask('authenticate', { methodId: method }).then(() => true, () => false) : Promise.resolve(false);
      const late = setTimeout(() => agent.process.kill(), 15 * 60_000);
      void done.then(() => { clearTimeout(late); agent.process.kill(); });
      return { url: null, done };
    }),

    async providers(): Promise<Provider[]> {
      const providers = new Map<string, Provider>();
      for (const model of offered((await session()).session)) {
        const { id, title } = speaker.maker(model.id);
        if (!providers.has(id)) providers.set(id, { id, title, models: [] });
        providers.get(id)!.models.push(model);
      }
      return [...providers.values()];
    },

    wake(waking) {
      const waiting: string[] = [waking.told];
      let sessionId: string | null = null, busy = true, ended = false;
      let pending: { kind: 'thought' | 'text'; text: string } | null = null;
      /** What came in pieces is told whole: a thought, or a text it wrote. */
      const flush = () => {
        const text = pending?.text.trim();
        if (text) (pending!.kind === 'thought' ? waking.thinks : waking.writes)(text);
        pending = null;
      };
      let names: string[] = [], loading = false;
      const bare = speaker.bare(waking);
      const agent = speaking(speaker, waking.folder, bare, message => {
        if (message.method !== 'session/update' || loading) return;   // (an old session told again: heard already)
        waking.heard(JSON.stringify(message));
        const update = message.params?.update ?? {};
        const kind = update.sessionUpdate === 'agent_thought_chunk' ? 'thought' : update.sessionUpdate === 'agent_message_chunk' ? 'text' : null;
        if (kind && update.content?.type === 'text') {
          if (pending?.kind !== kind) flush();
          pending ??= { kind, text: '' };
          pending.text += update.content.text;
        } else if (update.sessionUpdate === 'tool_call') {
          flush();
        }
      }, text => ended || waking.failed(text), call => ofTheWorld(names, call));

      const turn = (text: string) => {
        busy = true;
        agent.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }).then(answer => {
          flush();
          if (answer?.stopReason && !['end_turn', 'cancelled'].includes(answer.stopReason)) waking.failed(`It stopped: ${answer.stopReason}\n`);
        }, (error: Error) => {
          flush();
          if (!ended) waking.failed(`${error.message}\n`);
        }).finally(() => {
          busy = false;
          if (ended) return;
          if (waiting.length) return turn(waiting.shift()!);
          waking.stopped();
        });
      };

      (async () => {
        names = waking.tools ? await toolNames(waking.tools) : [];
        const opening = {
          cwd: waking.folder, mcpServers: waking.tools ? [{ type: 'http', name: 'world', url: waking.tools, headers: [] }] : [],
          ...bare.meta && { _meta: bare.meta } };
        loading = !!waking.resume;
        const opened: Session = waking.resume
          ? { sessionId: waking.resume, ...await agent.ask('session/load', { ...opening, sessionId: waking.resume }) }
          : await agent.ask('session/new', opening);
        loading = false;
        if (waking.model) await choose(agent.ask, opened, waking.model);
        sessionId = opened.sessionId;
        if (speaker.resumes) waking.session?.(sessionId);
        turn(waiting.shift()!);
      })().catch((error: Error) => {
        waking.failed(`${error.message}\n`);
        waking.stopped();
      });

      return {
        tell(text) {
          waiting.push(text);
          if (sessionId && !busy) turn(waiting.shift()!);
        },
        end() {
          ended = true;
          if (sessionId) agent.process.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }) + '\n');
          agent.process.kill();
        },
      };
    },
  };
}
