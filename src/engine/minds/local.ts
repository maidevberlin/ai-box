// Models on this computer, served by Ollama, LM Studio or llama.cpp. They all speak the same
// language (OpenAI's chat completions), so one small agent of our own drives them: it asks
// the model, does the tool calls it makes through its world's tools, and asks again, until
// the model answers without calling a tool. Then it has stopped talking.
//
// The models are the ones the server says it has. A server that is not running is not there.

import type { MindKind, Provider } from '../mind.ts';

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: Call[]; tool_call_id?: string };
type Call = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Tool = { type: 'function'; function: { name: string; description: string; parameters: object } };

/** Asks a tools server (MCP over HTTP: see doors.ts) something. */
async function mcp(url: string, method: string, params: object = {}): Promise<any> {
  const answer = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const { result, error } = await answer.json() as { result?: any; error?: { message: string } };
  if (error) throw new Error(error.message);
  return result;
}

/** Some models think out loud in their answer, between <think> and </think>. */
function thinking(text: string): [thought: string, said: string] {
  const found = /<think>([\s\S]*?)<\/think>/.exec(text);
  return found ? [found[1]!.trim(), text.replace(found[0], '').trim()] : ['', text.trim()];
}

/** A server of models on this computer, at its usual address. */
function local(id: string, title: string, address: string, site: string): MindKind {
  const models = async () => {
    const answer = await fetch(`${address}/models`, { signal: AbortSignal.timeout(2000) });
    const { data } = await answer.json() as { data?: { id: string }[] };
    return (data ?? []).map(model => ({ id: model.id, title: model.id, about: '', usual: false }));
  };
  return {
    title,
    about: 'Models on this computer. Nothing leaves it, and nobody needs an account.',
    site,
    local: true,

    async setup() {
      try {
        const found = await models();
        return { there: true, account: found.length ? `${found.length} model${found.length === 1 ? '' : 's'} ready` : 'Running, but no model is there yet' };
      } catch {
        return { there: false };
      }
    },

    providers: async (): Promise<Provider[]> => [{ id, title, models: await models() }],

    wake(waking) {
      const messages: Message[] = [{ role: 'system', content: waking.knows }];
      const waiting: string[] = [];
      const ending = new AbortController();
      let busy = false;
      const tools: Promise<Tool[]> = waking.tools
        ? mcp(waking.tools, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tinkerlings', version: '1' } })
          .then(() => mcp(waking.tools!, 'tools/list'))
          .then(({ tools: listed }) => listed.map((tool: any) => ({ type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema } })))
        : Promise.resolve([]);

      /** One turn: asks the model again and again, as long as it calls tools. */
      async function turn(): Promise<void> {
        busy = true;
        try {
          for (;;) {
            const offered = await tools;
            const answer = await fetch(`${address}/chat/completions`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ending.signal,
              body: JSON.stringify({ model: waking.model, messages, ...(offered.length ? { tools: offered } : {}), stream: false }),
            });
            const body = await answer.json() as any;
            waking.heard(JSON.stringify(body));
            const message = body.choices?.[0]?.message;
            if (!message) throw new Error(body.error?.message ?? `The server answered ${answer.status}.`);
            const [inline, said] = thinking(message.content ?? '');
            const thought = (message.reasoning_content ?? message.reasoning ?? inline ?? '').trim();
            if (thought) waking.thinks(thought);
            if (said) waking.writes(said);
            const calls: Call[] = message.tool_calls ?? [];
            messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
            if (!calls.length) break;
            for (const call of calls) {
              let result: string;
              try {
                const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
                const done = await mcp(waking.tools!, 'tools/call', { name: call.function.name, arguments: args });
                result = (done.content ?? []).map((part: any) => part.text ?? '').join('\n');
              } catch (error) {
                result = `That did not work: ${(error as Error).message}`;
              }
              messages.push({ role: 'tool', tool_call_id: call.id, content: result });
            }
          }
        } catch (error) {
          if (ending.signal.aborted) return;
          waking.failed(`${(error as Error).message}\n`);
        } finally {
          busy = false;
        }
        if (ending.signal.aborted) return;
        if (waiting.length) return tell(waiting.shift()!);
        waking.stopped();
      }

      function tell(text: string): void {
        if (busy) return void waiting.push(text);
        messages.push({ role: 'user', content: text });
        void turn();
      }

      tell(waking.told);
      return { tell, end: () => ending.abort() };
    },
  };
}

export const ollama = local('ollama', 'Ollama', 'http://127.0.0.1:11434/v1', 'https://ollama.com/download');
export const lmstudio = local('lmstudio', 'LM Studio', 'http://127.0.0.1:1234/v1', 'https://lmstudio.ai');
export const llamacpp = local('llamacpp', 'llama.cpp', 'http://127.0.0.1:8080/v1', 'https://github.com/ggml-org/llama.cpp');
