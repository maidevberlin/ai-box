// The driver of agents that speak ACP, tried with a stand-in for such an agent (fake-acp.mjs).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Waking } from '../src/engine/mind.ts';
import { acp } from '../src/engine/minds/acp.ts';

const fake = acp({
  title: 'Fake', about: '', site: '', program: join(import.meta.dirname, 'fake-acp.mjs'), args: [],
  account: 'Fake', maker: model => (model === 'big' ? { id: 'huge', title: 'Huge' } : { id: 'fake', title: 'Fake' }),
  bare: ({ knows }) => ({ meta: { fake: { knows } } }),
});

const resuming = acp({ ...{ title: 'Fake', about: '', site: '', program: join(import.meta.dirname, 'fake-acp.mjs'), args: [], account: 'Fake' },
                       maker: () => ({ id: 'fake', title: 'Fake' }), bare: () => ({}), resumes: true });

/** A world's tools server with one tool, "look". */
async function tools(): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const { id, method } = JSON.parse(body);
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result: method === 'tools/list' ? { tools: [{ name: 'look' }] } : {} }));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() };
}

/** Wakes the fake agent, and hears it until it stops talking. */
function wake(more: Partial<Waking>, kind = fake): Promise<{ thought: string[]; written: string[]; failed: string[] }> {
  return new Promise(resolve => {
    const heard = { thought: [] as string[], written: [] as string[], failed: [] as string[] };
    const mind = kind.wake({
      model: '', knows: '', told: '', folder: mkdtempSync(join(tmpdir(), 'acp-')), ...more,
      thinks: text => heard.thought.push(text), writes: text => heard.written.push(text), failed: text => heard.failed.push(text),
      heard: () => {}, stopped: () => { mind.end(); resolve(heard); },
    });
  });
}

test('its models are the ones its session offers, by their makers', async () => {
  const providers = await fake.providers();
  assert.deepEqual(providers.map(provider => [provider.id, provider.models.map(model => [model.id, model.title, model.usual])]),
                   [['fake', [['small', 'Small', true]]], ['huge', [['big', 'Big', false]]]]);
});

test('it may use the world\'s tools and nothing else, and is heard whole', async () => {
  const world = await tools();
  const heard = await wake({ told: 'Live!', tools: world.url });
  world.close();
  assert.deepEqual(heard.thought, ['I should look around.']);
  assert.deepEqual(heard.written, ['Allowed: world: look']);
});

test('it knows what it is told to know, as the chosen model', async () => {
  const heard = await wake({ told: 'who are you?', knows: 'the island', model: 'big' });
  assert.deepEqual(heard.written, ['I know: the island. I am big.']);
});

test('one that can goes on in the session it was in, without being heard again saying what it said', async () => {
  const sessions: string[] = [];
  const heard = await wake({ told: 'who are you?', resume: 's7', session: id => sessions.push(id) }, resuming);
  assert.deepEqual(heard.written, ['I know: . I am small.']);
  assert.deepEqual(sessions, ['s7']);
  const told: string[] = [];
  await wake({ told: 'who are you?', session: id => told.push(id) });
  assert.deepEqual(told, [], 'one that cannot go on does not say its session');
});
