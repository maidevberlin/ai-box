// Grok, through Grok Build (xAI's agent), with the person's own xAI login. It speaks ACP (see
// acp.ts).
//
// It keeps its own home, apart from any Grok the person uses themselves, so none of their
// settings, rules, skills or tools come along; nor does what it would take over from Claude
// Code or Cursor. Told what it knows instead of its own instructions, with its own tools off.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME as BOX, install } from '../programs.ts';
import { acp } from './acp.ts';

const HOME = join(BOX, 'grok');

/** What it would take over from Claude Code and Cursor, and what it does besides: all off. */
const SWITCHED_OFF = Object.fromEntries([
  ...['CURSOR', 'CLAUDE'].flatMap(other => ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS'].map(what => `GROK_${other}_${what}_ENABLED`)),
  'GROK_SUBAGENTS', 'GROK_GOAL', 'GROK_MEMORY', 'GROK_WEB_FETCH', 'GROK_WRITE_FILE', 'GROK_LSP_TOOLS',
].map(name => [name, '0']));

export const grok = acp({
  title: 'Grok',
  about: 'Your xAI account, through Grok Build.',
  site: 'https://docs.x.ai/build/overview',
  program: 'grok',
  args: ['agent', 'stdio'],
  account: 'xAI',
  install: () => install('@xai-official/grok', { GROK_HOME: HOME }),

  maker: () => ({ id: 'xai', title: 'Grok' }),

  bare({ knows }) {
    mkdirSync(HOME, { recursive: true });
    return {
      args: ['--system-prompt-override', knows || ' '],
      env: { GROK_HOME: HOME, GROK_DISABLE_AUTOUPDATER: '1', ...SWITCHED_OFF },
    };
  },

  signIn: methods => methods[0]?.id,
});
