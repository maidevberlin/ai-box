#!/usr/bin/env node
// A stand-in for an agent that speaks ACP (see src/engine/minds/acp.ts), for the tests. It
// offers two models. Told something, it thinks, asks to use the world's tool "look" and a
// shell of its own, says what it was allowed, and ends its turn. Told "who are you?", it
// answers with what it was told to know when its session began, and the model it is.

import { createInterface } from 'node:readline';

const write = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const waiting = new Map();
let next = 100, model = 'small', knows = '';
const ask = (method, params) => new Promise(answered => { waiting.set(++next, answered); write({ id: next, method, params }); });
const update = (sessionId, update) => write({ method: 'session/update', params: { sessionId, update } });
const chunk = (sessionId, kind, text) => update(sessionId, { sessionUpdate: kind, content: { type: 'text', text } });
const options = [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }];

async function prompt({ sessionId, prompt: [{ text }] }) {
  if (text === 'who are you?') {
    chunk(sessionId, 'agent_message_chunk', `I know: ${knows}. I am ${model}.`);
    return { stopReason: 'end_turn' };
  }
  chunk(sessionId, 'agent_thought_chunk', 'I should ');
  chunk(sessionId, 'agent_thought_chunk', 'look around.');
  const allowed = [];
  for (const [id, title] of [['call-1', 'world: look'], ['call-2', 'Run shell command']]) {
    update(sessionId, { sessionUpdate: 'tool_call', toolCallId: id, title, status: 'pending' });
    const { outcome } = await ask('session/request_permission', { sessionId, toolCall: { toolCallId: id, title }, options });
    if (outcome.optionId === 'yes') allowed.push(title);
  }
  chunk(sessionId, 'agent_message_chunk', `Allowed: ${allowed.join(', ') || 'nothing'}`);
  return { stopReason: 'end_turn' };
}

createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line);
  if (!message.method) return waiting.get(message.id)?.(message.result);
  const answer = result => write({ id: message.id, result });
  switch (message.method) {
    case 'initialize': return answer({ protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, authMethods: [{ id: 'browser', name: 'Log in with the browser' }] });
    case 'session/new': knows = message.params._meta?.fake?.knows ?? ''; return answer({ sessionId: 's1', models: { currentModelId: model, availableModels: [{ modelId: 'small', name: 'Small' }, { modelId: 'big', name: 'Big', description: 'Thinks longer' }] } });
    case 'session/set_model': model = message.params.modelId; return answer({});
    case 'session/prompt': return answer(await prompt(message.params));
    case 'session/cancel': return;
    default: return write({ id: message.id, error: { code: -32601, message: 'unknown' } });
  }
});
