// pi, with the providers a person logged in to with it: subscriptions (Claude, ChatGPT,
// Copilot …) or API keys (Z.ai's GLM, DeepSeek, OpenRouter, Mistral …).
//
// Driven in its RPC mode (one JSON record per line on stdin and stdout). pi keeps its own home,
// apart from any pi the person uses themselves, so none of their settings, extensions, skills
// or MCP servers come along. Each agent runs in a folder of its own, which holds nothing but
// where its world's tools are. pi's own tools are switched off. (pi tells the model which folder
// it is in: the name of this one says nothing.)

import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lines, type MindKind, type Provider } from '../mind.ts';
import { HOME as BOX, run, start, version } from '../programs.ts';

const HOME = join(BOX, 'pi');
/** Where pi keeps API keys and logins: only the person can read it. */
const KEYS = join(HOME, 'auth.json');
const keys = (): Record<string, { type: string; key?: string }> => (existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, 'utf8')) : {});
function keepKeys(all: Record<string, unknown>): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(KEYS, JSON.stringify(all, null, 2), { mode: 0o600 });
  chmodSync(KEYS, 0o600);
}

const BARE = ['--mode', 'rpc', '--no-session', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates',
              '--no-themes', '--no-context-files'];

/** A pi in RPC mode: is asked, and answers, and says what goes on by itself. */
function rpc(args: string[], folder: string | undefined, heard: (record: any) => void, failed: (text: string) => void) {
  mkdirSync(HOME, { recursive: true });
  const process: ChildProcess = start('pi', [...BARE, ...args], { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'],
                                                                   env: { ...globalThis.process.env, PI_CODING_AGENT_DIR: HOME } });
  const asked = new Map<string, (data: any) => void>();
  let next = 0;
  process.on('error', error => failed(`${error}\n`));
  process.stderr!.on('data', chunk => failed(String(chunk)));
  lines(process.stdout!, line => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.type === 'response') {
      if (!record.success) failed(`${record.command}: ${record.error}\n`);
      asked.get(record.id)?.(record.success ? record.data : null);
      asked.delete(record.id);
    }
    heard(record);
  });
  const ask = (command: object) => new Promise<any>(answered => {
    const id = String(++next);
    asked.set(id, answered);
    process.stdin!.write(JSON.stringify({ id, ...command }) + '\n');
  });
  return { process, ask };
}

/** The text of a finished assistant message's blocks of one kind. */
const blocks = (message: any, type: 'thinking' | 'text') =>
  (message.content ?? []).filter((block: any) => block.type === type).map((block: any) => block[type]?.trim()).filter(Boolean).join('\n\n');

export const pi: MindKind = {
  title: 'pi',
  about: 'API keys of many providers: Z.ai (GLM), DeepSeek, OpenRouter, Mistral and more.',
  site: 'https://pi.dev',
  package: '@earendil-works/pi-coding-agent',

  async setup() {
    const installed = await version('pi');
    if (!installed) return { there: false };
    const kept = Object.keys(keys());
    return { there: true, version: installed, account: kept.length ? `Keys for ${kept.join(', ')}` : undefined };
  },

  keys: {
    /** The providers pi knows: it names them when asked to log in to one it does not know. */
    async providers() {
      const { out } = await run('pi', ['auth', 'login', 'unknown-provider'], { env: { PI_CODING_AGENT_DIR: HOME } });
      return /Providers: (.*)/.exec(out)?.[1]?.split(',').map(name => name.trim()).filter(Boolean) ?? [];
    },
    kept: async () => Object.entries(keys()).filter(([, kept]) => kept.type === 'api_key').map(([provider]) => provider),
    async keep(provider, key) {
      keepKeys({ ...keys(), [provider]: { type: 'api_key', key: key.trim() } });
    },
    async forget(provider) {
      const { [provider]: _, ...rest } = keys();
      keepKeys(rest);
    },
  },

  /** The models of every provider it is logged in to, and the one it uses when none is chosen. */
  providers() {
    return new Promise((resolve, reject) => {
      const server = rpc(['--no-tools', '--no-mcp'], undefined, () => {}, () => {});
      const done = (error: Error | null, providers?: Provider[]) => {
        clearTimeout(late);
        server.process.kill();
        if (error) reject(error);
        else resolve(providers!);
      };
      const late = setTimeout(() => done(new Error('pi did not answer.')), 30_000);
      server.process.on('error', error => done(error));
      type Listed = { models?: { id: string; name?: string; provider: string; contextWindow?: number; reasoning?: boolean }[] };
      Promise.all([server.ask({ type: 'get_available_models' }), server.ask({ type: 'get_state' })]).then(([listed, state]: [Listed | null, any]) => {
        const providers = new Map<string, Provider>();
        for (const model of listed?.models ?? []) {
          const provider = providers.get(model.provider) ?? { id: model.provider, title: model.provider, models: [] };
          providers.set(model.provider, provider);
          provider.models.push({
            id: `${model.provider}/${model.id}`, title: model.name ?? model.id,
            about: [model.reasoning ? 'thinks' : '', model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k context` : ''].filter(Boolean).join(' · '),
            usual: state?.model?.provider === model.provider && state?.model?.id === model.id,
          });
        }
        if (!providers.size) return done(new Error('pi is not logged in to any provider.'));
        done(null, [...providers.values()]);
      });
    });
  },

  wake(waking) {
    // Its own folder, with nothing in it but where its world's tools are. (They are handed to
    // the model directly, not found through pi's search or scripts.)
    const folder = mkdtempSync(join(waking.folder, 'a-'));
    mkdirSync(join(folder, '.pi'));
    const servers = waking.tools ? { world: { url: waking.tools, exposure: 'direct' } } : {};
    writeFileSync(join(folder, '.pi', 'mcp.json'), JSON.stringify({ mcpServers: servers, autoEnableCodemode: false }));
    const server = rpc([
      '--approve', '--system-prompt', waking.knows,
      ...(waking.model ? ['--model', waking.model] : []),
      // (MCP is one of pi's own extensions: switched off with the others, and on again here.)
      ...(waking.tools ? ['--extension', 'builtin:mcp', '--tools', 'mcp__world__*'] : ['--no-tools', '--no-mcp']),
    ], folder, record => {
      waking.heard(JSON.stringify(record));
      if (record.type === 'message_end' && record.message?.role === 'assistant') {
        const thought = blocks(record.message, 'thinking'), written = blocks(record.message, 'text');
        if (thought) waking.thinks(thought);
        if (written) waking.writes(written);
        if (record.message.errorMessage) waking.failed(`${record.message.errorMessage}\n`);
      } else if (record.type === 'agent_settled') {
        waking.stopped();
      }
    }, waking.failed);
    const tell = (text: string) => void server.ask({ type: 'prompt', message: text });
    tell(waking.told);
    return {
      tell,
      end() {
        server.process.kill();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  },
};
