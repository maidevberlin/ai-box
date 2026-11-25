// How agents reach their world. One small web server hands every agent of every run its
// tools, in the form AI agents expect (MCP over HTTP). Each agent gets an address of its own,
// which says which run and which place it is in. The worlds live in this process's memory:
// nothing is read from or written to a file for an action.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { schema, type Run } from './run.ts';

interface Message { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, any> }

export class Doors {
  private readonly runs = new Map<string, Run>();
  private server: Server | null = null;
  private port = 0;

  /** Starts listening, on this computer only. */
  open(): Promise<void> {
    this.server = createServer((request, response) => void this.serve(request, response));
    return new Promise(resolve => this.server!.listen(0, '127.0.0.1', () => {
      this.port = (this.server!.address() as AddressInfo).port;
      resolve();
    }));
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
  }

  /** Lets the agents of a run in. Gives the address for each place. */
  let(run: Run): (place: number) => string {
    const key = randomBytes(12).toString('hex');   // nobody else on this computer can guess it
    this.runs.set(key, run);
    run.listeners.push({ ended: () => setTimeout(() => this.runs.delete(key), 5000) });
    return place => `http://127.0.0.1:${this.port}/mcp/${key}/${place}`;
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const [, , key, place] = (request.url ?? '').split('/');
    const run = this.runs.get(key ?? '');
    if (!run) return void response.writeHead(404).end();
    if (request.method !== 'POST') return void response.writeHead(405, { Allow: 'POST' }).end();   // (no stream of our own to offer)
    let body = '';
    for await (const chunk of request) body += chunk;
    let asked: Message | Message[];
    try {
      asked = JSON.parse(body);
    } catch {
      return void response.writeHead(400).end();
    }
    const answers = [];
    for (const message of Array.isArray(asked) ? asked : [asked]) {
      if (message.id === undefined) continue;   // a notification: nothing to answer
      answers.push({ jsonrpc: '2.0', id: message.id, ...await this.answer(run, Number(place), message) });
    }
    if (!answers.length) return void response.writeHead(202).end();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(Array.isArray(asked) ? answers : answers[0]));
  }

  private async answer(run: Run, place: number, { method, params = {} }: Message): Promise<object> {
    if (method === 'initialize')
      return { result: { protocolVersion: params.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'world', version: '1' } } };
    if (method === 'ping') return { result: {} };
    if (method === 'tools/list')   // exactly what the agent gets to see about each tool
      return { result: { tools: Object.entries(run.tools(place)).map(([name, tool]) => ({ name, description: tool.about, inputSchema: schema(tool.args) })) } };
    if (method === 'tools/call')
      return { result: { content: [{ type: 'text', text: await run.act(place, String(params.name), params.arguments) }] } };
    return { error: { code: -32601, message: 'Method not found' } };
  }
}
