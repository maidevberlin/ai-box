// The page: a side bar to go places, and one screen at a time. Where the page is shows in the
// address, so every screen can be linked to, and the browser's back button works:
//
//   #                  the dashboard
//   #new               starting a new run
//   #run/<id>[/<s>]    one run played back (at a moment of it, in seconds)
//   #ais               the AIs on this computer, and connecting more
//   #settings          what Tinkerlings keeps, and starting over

import { openConnections } from './connections.ts';
import { openCreate } from './create.ts';
import { leaveHome, openHome } from './home.ts';
import { $, el } from './page.ts';
import { leaveRun, openRun } from './run.ts';
import { onRuns, readRuns, runLine, runs } from './runs.ts';
import { openSettings } from './settings.ts';

const SCREENS = { home: 'home', new: 'create', run: 'viewer', ais: 'connections', settings: 'settings' } as const;
type Screen = keyof typeof SCREENS;

let current: { screen: Screen; id?: string } = { screen: 'home' };

/** Shows the screen the address names. */
function route(): void {
  const [where = '', id, moment] = location.hash.slice(1).split('/');
  const screen: Screen = where in SCREENS && where !== 'home' ? where as Screen : 'home';
  if (screen === 'run' && !id) return void (location.hash = '');
  if (current.screen === 'run' && screen !== 'run') leaveRun();
  if (current.screen === 'home' && screen !== 'home') leaveHome();
  current = { screen, id };
  for (const [name, element] of Object.entries(SCREENS)) $(element).hidden = name !== screen;
  for (const link of document.querySelectorAll<HTMLAnchorElement>('#sidebar a.go')) link.classList.toggle('on', link.getAttribute('href') === `#${where}`);
  drawRuns();
  if (screen === 'home') openHome();
  if (screen === 'new') void openCreate(started => { location.hash = `run/${started}`; });
  if (screen === 'run') void openRun(id!, moment === undefined ? undefined : Number(moment) || 0);
  if (screen === 'ais') openConnections();
  if (screen === 'settings') void openSettings();
}

/** The runs in the side bar, the one on screen marked. */
function drawRuns(): void {
  $('runs').replaceChildren(...(runs.length ? runs.map(run => runLine(run, current.screen === 'run' && current.id === run.id))
    : [el('p', 'hint', 'None yet. A run started with “New run” is kept here.')]));
}
onRuns(drawRuns);

window.onhashchange = route;
void readRuns().then(route);
