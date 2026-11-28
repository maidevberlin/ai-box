// Claude Code, with the person's own login: a Claude subscription or an Anthropic account.
// It gets nothing but its world's tools: no built-in tools, no settings, no skills, no memory.

import { lines, type MindKind, type Provider } from '../mind.ts';
import { run, start, version } from '../programs.ts';

const BARE = ['--tools', '', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config'];
const TALKING = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];

export const claude: MindKind = {
  title: 'Claude Code',
  about: 'Your Claude subscription, or an Anthropic account.',
  site: 'https://claude.com/claude-code',
  package: '@anthropic-ai/claude-code',

  async setup() {
    const installed = await version('claude');
    if (!installed) return { there: false };
    const { out } = await run('claude', ['auth', 'status']);
    let status: { loggedIn?: boolean; email?: string; subscriptionType?: string } = {};
    try {
      status = JSON.parse(out);
    } catch { /* not logged in, or it says so in words */ }
    const plan = status.subscriptionType ? `Claude ${status.subscriptionType[0]!.toUpperCase()}${status.subscriptionType.slice(1)}` : '';
    return { there: true, version: installed, account: status.loggedIn ? [status.email, plan].filter(Boolean).join(' · ') || 'logged in' : undefined };
  },

  /** Claude Code opens the browser itself. The address it prints is there in case it cannot. */
  async login() {
    const child = start('claude', ['auth', 'login', '--claudeai'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const done = new Promise<boolean>(resolve => {
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
    const url = await new Promise<string | null>(resolve => {
      let said = '';
      const heard = (chunk: Buffer) => {
        said += chunk;
        const found = /https:\/\/\S+/.exec(said);
        if (found) resolve(found[0]);
      };
      child.stdout!.on('data', heard);
      child.stderr!.on('data', heard);
      setTimeout(() => resolve(null), 5000);
      void done.then(() => resolve(null));
    });
    return { url, done };
  },

  async logout() {
    await run('claude', ['auth', 'logout']);
  },

  /** Claude Code says which models it offers, and who is logged in, when it is asked to begin
   *  (as an editor asks it). */
  providers() {
    return new Promise((resolve, reject) => {
      const process = start('claude', [...TALKING, ...BARE], { stdio: ['pipe', 'pipe', 'ignore'] });
      const done = (error: Error | null, providers?: Provider[]) => {
        clearTimeout(late);
        process.kill();
        if (error) reject(error);
        else resolve(providers!);
      };
      const late = setTimeout(() => done(new Error('Claude Code did not answer.')), 30_000);
      process.on('error', error => done(error));
      lines(process.stdout!, line => {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type !== 'control_response') return;
        const { account } = event.response?.response ?? {};
        if (!account?.subscriptionType && !account?.apiProvider) return done(new Error('Claude Code is not logged in.'));
        const offered: { value: string; resolvedModel?: string; displayName: string; description?: string }[] = event.response?.response?.models ?? [];
        // ("default" is not a model of its own: it says which of the others is used when none is chosen.)
        const usual = offered.find(model => model.value === 'default')?.resolvedModel;
        const models = offered.filter(model => model.value !== 'default').map(model => ({
          id: model.value, title: model.displayName, about: model.description ?? '', usual: !!usual && model.resolvedModel === usual }));
        done(null, [{ id: 'anthropic', title: 'Claude', models }]);
      });
      process.stdin!.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n');
    });
  },

  wake(waking) {
    const config = { mcpServers: waking.tools ? { world: { type: 'http', url: waking.tools } } : {} };
    const process = start('claude', [
      ...TALKING, ...BARE,
      '--system-prompt', waking.knows,
      ...(waking.model ? ['--model', waking.model] : []),
      '--mcp-config', JSON.stringify(config), ...(waking.tools ? ['--allowedTools', 'mcp__world'] : []),
      '--thinking-display', 'summarized',
    ], { cwd: waking.folder, stdio: ['pipe', 'pipe', 'pipe'] });
    process.stderr!.on('data', chunk => waking.failed(String(chunk)));
    process.on('error', error => waking.failed(`${error}\n`));
    lines(process.stdout!, line => {
      waking.heard(line);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'assistant') {
        for (const part of event.message?.content ?? []) {
          if (part.type === 'thinking' && part.thinking?.trim()) waking.thinks(part.thinking.trim());
          if (part.type === 'text' && part.text?.trim()) waking.writes(part.text.trim());
        }
      } else if (event.type === 'result') {
        waking.stopped();
      }
    });
    const tell = (text: string) => {
      process.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    };
    tell(waking.told);
    return { tell, end: () => process.kill() };
  },
};
