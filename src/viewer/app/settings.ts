// Settings: what Tinkerlings keeps, where, and forgetting it again, down to starting over as if
// it had just been installed.

import { $, api, el } from './page.ts';
import { readRuns } from './runs.ts';

interface Kept { runs: number; going: number; folder: string; home: string }

/** What this browser keeps for Tinkerlings: how the start form was filled in last, for each world. */
const browserKeys = (): string[] => {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith('tinkerlings:'));
  } catch {
    return [];
  }
};
function forgetBrowser(): void {
  try { for (const key of browserKeys()) localStorage.removeItem(key); } catch { /* nothing was kept */ }
}

export async function openSettings(): Promise<void> {
  const kept = await api<Kept>('/api/settings');
  const button = (text: string, onclick: () => void, danger = false) => {
    const made = el('button', danger ? 'danger' : '', text);
    made.type = 'button';
    made.onclick = onclick;
    return made;
  };
  const forget = async (what: 'runs' | 'everything', question: string) => {
    if (!confirm(question)) return;
    const done = await api<{ error?: string }>('/api/forget', { what });
    if (done.error) return alert(done.error);
    if (what === 'everything') forgetBrowser();
    await readRuns();
    if (what === 'everything') location.hash = '';
    else void openSettings();
  };
  const going = kept.going ? `End the ${kept.going === 1 ? 'run that is' : `${kept.going} runs that are`} going first.` : '';
  const item = (title: string, text: string, ...controls: (Node | string | false)[]) =>
    el('div', 'item', el('div', '', el('b', '', title), el('p', '', text)), el('div', 'controls', ...controls));
  const remembered = browserKeys().length;
  $('settingsBody').replaceChildren(
    el('section', '',
      el('h2', '', 'What Tinkerlings keeps'),
      item('Runs', `${kept.runs} run${kept.runs === 1 ? '' : 's'}, each with its whole record. Kept in ${kept.folder}`,
        going ? el('span', 'hint', going) : button('Delete all runs', () => void forget('runs', `Delete all ${kept.runs} runs? They cannot be brought back.`), true)),
      item('AIs connected by Tinkerlings', `What Tinkerlings installed itself, its logins to Codex, and the API keys given to pi. Kept in ${kept.home}, readable only by you.`,
        Object.assign(el('a', 'button', 'AI connections'), { href: '#ais' })),
      item('This browser', remembered
        ? `It remembers how the start form was filled in last, for ${remembered} world${remembered === 1 ? '' : 's'}.`
        : 'It remembers how the start form was filled in last. Nothing is remembered right now.',
        remembered > 0 && button('Forget it', () => { forgetBrowser(); void openSettings(); }))),
    el('section', 'danger',
      el('h2', '', 'Start over'),
      item('As if Tinkerlings had just been installed',
        'Deletes all runs, everything in Tinkerlings’ own folder (the AIs it installed, its logins, the API keys) and what this browser remembers. ' +
        'AIs you installed yourself stay. So does Claude Code’s login: it is the one this computer has for it (log out of it under AI connections).',
        going ? el('span', 'hint', going) : button('Start over', () => void forget('everything', 'Start over? All runs, Tinkerlings’ logins and API keys are deleted. This cannot be undone.'), true))));
}
