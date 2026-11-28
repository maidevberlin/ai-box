// Codex, with the person's own login: a ChatGPT account, or an OpenAI key.
//
// Driven through its app server (JSON-RPC, one message per line on stdin and stdout): one
// thread for the agent, one turn for every text it is told. Codex keeps its own home, apart
// from any Codex the person uses themselves, so none of their settings, tools or skills come
// along. Its own tools are switched off: the agent has nothing but its world's tools.

import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lines, type MindKind, type Provider } from '../mind.ts';
import { HOME as BOX, start, version } from '../programs.ts';

const HOME = join(BOX, 'codex');

const SWITCHED_OFF = [
  'features.shell_tool=false', 'features.view_image=false', 'features.multi_agent=false', 'features.goals=false',
  'web_search="disabled"', 'tools.experimental_request_user_input={enabled=false}',
  'include_environment_context=false', 'include_permissions_instructions=false', 'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false', 'skills.include_instructions=false',
  'check_for_update_on_startup=false', 'model_reasoning_summary="detailed"',
];

/** A Codex app server: asks and is answered, and hears what it says by itself. */
function appServer(folder: string | undefined, heard: (message: any) => void, failed: (text: string) => void) {
  mkdirSync(HOME, { recursive: true });
  const process: ChildProcess = start('codex', ['app-server', ...SWITCHED_OFF.flatMap(setting => ['-c', setting])],
                                      { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'], env: { ...globalThis.process.env, CODEX_HOME: HOME } });
  const asked = new Map<number, (answer: any) => void>();
  let next = 0;
  const write = (message: object) => process.stdin!.write(JSON.stringify(message) + '\n');
  process.on('error', error => failed(`${error}\n`));
  process.stderr!.on('data', chunk => failed(String(chunk)));
  lines(process.stdout!, line => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && message.method) {   // it asks us something: nobody is here to answer
      write({ id: message.id, error: { code: -32601, message: 'Nobody is here to answer.' } });
    } else if (message.id !== undefined) {
      if (message.error) failed(`${JSON.stringify(message.error)}\n`);
      asked.get(message.id)?.(message.result);
      asked.delete(message.id);
    }
    heard(message);
  });
  const ask = (method: string, params: object) => new Promise<any>(answered => {
    asked.set(++next, answered);
    write({ id: next, method, params });
  });
  const begun = ask('initialize', { clientInfo: { name: 'tinkerlings', title: 'Tinkerlings', version: '1' } }).then(() => write({ method: 'initialized' }));
  return { process, ask: (method: string, params: object) => begun.then(() => ask(method, params)) };
}

type Account = { type: string; email?: string | null; planType?: string | null } | null;
type Listed = { data?: { id: string; displayName: string; description: string; hidden: boolean; isDefault: boolean }[] };

/** Starts an app server only to ask it some things, and ends it again. */
function asking<T>(questions: [method: string, params: object][]): Promise<T> {
  return new Promise((resolve, reject) => {
    const server = appServer(undefined, () => {}, () => {});
    const done = (error: Error | null, answers?: unknown) => {
      clearTimeout(late);
      server.process.kill();
      if (error) reject(error);
      else resolve(answers as T);
    };
    const late = setTimeout(() => done(new Error('Codex did not answer.')), 30_000);
    server.process.on('error', error => done(error));
    Promise.all(questions.map(([method, params]) => server.ask(method, params))).then(answers => done(null, answers));
  });
}

const plan = (account: NonNullable<Account>) => (account.type === 'chatgpt' ? `ChatGPT${account.planType ? ` ${account.planType[0]!.toUpperCase()}${account.planType.slice(1)}` : ''}` : 'OpenAI key');

export const codex: MindKind = {
  title: 'Codex',
  about: 'Your ChatGPT account.',
  site: 'https://developers.openai.com/codex',
  package: '@openai/codex',

  async setup() {
    const installed = await version('codex');
    if (!installed) return { there: false };
    const [{ account }] = await asking<[{ account: Account }]>([['account/read', {}]]);
    return { there: true, version: installed, account: account ? [account.email, plan(account)].filter(Boolean).join(' · ') : undefined };
  },

  /** The app server waits for the browser to come back to it; it ends when the login is over. */
  async login() {
    let finished: (worked: boolean) => void = () => {};
    const done = new Promise<boolean>(resolve => finished = resolve);
    const server = appServer(undefined, message => {
      if (message.method === 'account/login/completed') finished(!!message.params?.success);
    }, () => {});
    server.process.on('close', () => finished(false));
    const late = setTimeout(() => finished(false), 15 * 60_000);
    void done.then(() => {
      clearTimeout(late);
      server.process.kill();
    });
    const started = await server.ask('account/login/start', { type: 'chatgpt' });
    if (!started?.authUrl) finished(false);
    return { url: started?.authUrl ?? null, done };
  },

  async logout() {
    await asking([['account/logout', {}]]);
  },

  /** Its models, if it is logged in: with a ChatGPT account, or with an OpenAI key. */
  async providers() {
    const [{ account }, listed] = await asking<[{ account: Account }, Listed]>([['account/read', {}], ['model/list', {}]]);
    if (!account) throw new Error('Codex is not logged in.');
    const models = (listed?.data ?? []).filter(model => !model.hidden).map(model => ({
      id: model.id, title: model.displayName, about: model.description, usual: model.isDefault }));
    return [{ id: 'openai', title: account.type === 'chatgpt' ? 'ChatGPT' : 'OpenAI', models }];
  },

  wake(waking) {
    let thread: string | null = null;
    const waiting: string[] = [];
    const server = appServer(waking.folder, message => {
      if (message.method) waking.heard(JSON.stringify(message));
      if (message.method === 'item/completed') {
        const item = message.params.item;
        if (item.type === 'agentMessage' && item.text?.trim()) waking.writes(item.text.trim());
        if (item.type === 'reasoning') {
          const text = [...item.summary, ...(item.summary.length ? [] : item.content)].join('\n\n').trim();
          if (text) waking.thinks(text);
        }
      } else if (message.method === 'turn/completed') {
        const { turn } = message.params;
        if (turn.status === 'failed') waking.failed(`${turn.error?.message ?? 'The turn failed.'}\n`);
        waking.stopped();
      } else if (message.method === 'error') {
        waking.failed(`${JSON.stringify(message.params)}\n`);
      }
    }, waking.failed);
    const turn = (text: string) => server.ask('turn/start', { threadId: thread, input: [{ type: 'text', text, text_elements: [] }] });
    server.ask('thread/start', {
      model: waking.model || undefined, baseInstructions: waking.knows, cwd: waking.folder, ephemeral: true, approvalPolicy: 'never',
      config: { mcp_servers: waking.tools ? { world: { url: waking.tools, default_tools_approval_mode: 'approve' } } : {} },
    }).then(answer => {
      thread = answer?.thread?.id ?? null;
      if (!thread) return;
      for (const text of waiting.splice(0)) void turn(text);
    });
    const tell = (text: string) => {
      if (thread) void turn(text);
      else waiting.push(text);
    };
    tell(waking.told);
    return { tell, end: () => server.process.kill() };
  },
};
