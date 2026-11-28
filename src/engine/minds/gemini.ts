// Gemini, through Antigravity (agy, Google's agent), with the person's own Google login. It
// speaks ACP (see acp.ts). Besides Gemini it offers some of Claude's models and OpenAI's open one.
//
// It keeps its own folder, apart from any Antigravity the person uses themselves, so none of
// their settings, rules or tools come along; its own skills and plugins are left out too. Its
// login is the person's: kept by the system, not in that folder.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, place } from '../programs.ts';
import { acp } from './acp.ts';

const FOLDER = join(HOME, 'gemini');

/** Whose its models are, by the first word of their names ("gemini-3.8-flash-low"). */
const MAKERS: Record<string, { id: string; title: string }> = {
  gemini: { id: 'google', title: 'Gemini' },
  claude: { id: 'anthropic', title: 'Claude' },
  gpt: { id: 'openai', title: 'OpenAI' },
};

/** Where Google says its newest version is, for this computer. */
const MANIFEST = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests';
const PLATFORM = `${process.platform === 'win32' ? 'windows' : process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;

export const gemini = acp({
  title: 'Gemini',
  about: 'Your Google account, through Antigravity.',
  site: 'https://antigravity.google/docs/cli/reference',
  program: 'agy',
  args: ['acp'],
  account: 'Google',
  resumes: true,   // (tried: it tells the whole session again, then goes on)

  maker(model) {
    const word = model.split('-')[0]!;
    return MAKERS[word] ?? { id: word, title: word };
  },

  async install() {
    const answer = await fetch(`${MANIFEST}/${PLATFORM}.json`);
    if (!answer.ok) throw new Error('Antigravity is not made for this computer.');
    const { url, sha512 } = await answer.json() as { url: string; sha512: string };
    await place('agy', url, sha512);
  },

  bare({ knows }) {
    mkdirSync(FOLDER, { recursive: true });
    return {
      args: ['--gemini-dir', FOLDER, '--include-default-customizations=false', '--disable-telemetry'],
      meta: { antigravity: { systemPrompt: { append: knows } } },
    };
  },

  signIn: methods => methods.find(method => method.id === 'oauth-personal')?.id,
});
