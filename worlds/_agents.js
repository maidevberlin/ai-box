// The agents as every world draws them: a body, a head, the thing carried above the head,
// and a lighter patch on the ground for what the agent sees.
// (Not a world's drawing itself: its name starts with "_".)
//
// Several agents can live in a world at the same time, each in its own place (1, 2, ...).
// A place has its own colour, the same one as in the conversation next to the picture.
import * as THREE from 'three';

export const PLACE_COLOURS = [0xe8553a, 0x8b5cf6, 0x14b8a6, 0xf59e0b];

// What an agent says or thinks is shown in a bubble above its head: a speech bubble for
// what it says, a thought bubble for what it thinks. A bubble stays while the agent does a
// few more things, then goes. (Only the start of a long text is shown.)
const BUBBLE_STAYS = 4;     // how many more actions of the same agent a bubble stays for
const BUBBLE_LETTERS = 180;

let styled = false;
function addStyle() {   // once per page: how bubbles look, in light and in dark
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
    .bubble { position: absolute; left: 0; top: 0; z-index: 1; pointer-events: none; max-width: 260px; width: max-content;
              padding: 7px 11px; border-radius: 14px; font: 12.5px/1.35 system-ui, sans-serif; color: #1d2126;
              background: #fff; border: 2px solid var(--who); box-shadow: 0 4px 14px rgba(0, 0, 0, .22);
              transform: translate(-50%, calc(-100% - 14px)); white-space: pre-wrap; overflow-wrap: anywhere; }
    .bubble::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 12px; height: 12px; margin-left: -7px;
                     background: inherit; border: 2px solid var(--who); border-top: 0; border-left: 0; transform: rotate(45deg); }
    .bubble.think { font-style: italic; color: #4b5360; border-style: dashed; border-radius: 22px; }
    .bubble.think::after { width: 9px; height: 9px; border-radius: 50%; border: 2px dashed var(--who); bottom: -16px;
                           transform: none; margin-left: -6px; }
    .bubble.old { opacity: .55; }
    @media (prefers-color-scheme: dark) {
      .bubble { background: #20262e; color: #e7e9ec; }
      .bubble.think { color: #b4bcc6; }
    }`;
  document.head.append(style);
}

// crowd(scene, cube, dress, camera, box): dress(mesh, thing) makes the carried mesh look like
// the thing; camera and box are where the bubbles are placed over the picture.
export function crowd(scene, cube, dress, camera, box) {
  const figures = {};   // place -> { group, carried, sight, target, bubble }
  addStyle();

  function figure(id) {
    const look = new THREE.MeshLambertMaterial({ color: PLACE_COLOURS[(id - 1) % PLACE_COLOURS.length] });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 20), look);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), look);
    const carried = new THREE.Mesh(cube);
    body.position.y = 0.55; head.position.y = 1.38; carried.position.y = 2.05;
    group.add(body, head, carried);
    const sight = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    scene.add(group, sight);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.hidden = true;
    bubble.style.setProperty('--who', '#' + PLACE_COLOURS[(id - 1) % PLACE_COLOURS.length].toString(16).padStart(6, '0'));
    box?.append(bubble);
    return { group, carried, sight, bubble, target: new THREE.Vector3(), isNew: true };
  }

  // agents: [{ id, pos, height, carrying, dead, view }]. place(x, y, up) is the world's own.
  function show(agents, place, fresh) {
    for (const id in figures) if (!agents.some(a => a.id === +id)) figures[id].group.visible = figures[id].sight.visible = false;
    for (const a of agents) {
      const f = figures[a.id] ||= figure(a.id);
      f.target = place(...a.pos, a.height);
      if (fresh || f.isNew) f.group.position.copy(f.target);
      f.isNew = false;
      f.group.visible = f.sight.visible = !a.dead;   // drowned: gone until a new agent wakes up
      f.carried.visible = !!a.carrying;
      if (a.carrying) { dress(f.carried, a.carrying); f.carried.scale.multiplyScalar(0.64); }
      const reach = a.view * 2 + 1 + (a.id - 1) * 0.04;   // wider when the agent stands higher
      f.sight.scale.set(reach, 0.02, reach);
      f.sight.position.copy(place(...a.pos, 0.01 + a.id * 0.002));
    }
  }

  // What each agent said or thought last, up to the step on screen: shown while it is recent.
  function speak(steps, index) {
    const said = {};   // place -> { step, acts since }
    const done = new Set();
    for (let i = index; i >= 0 && done.size < Object.keys(figures).length; i--) {
      const step = steps[i], place = step.place || 1;
      if (done.has(place)) continue;
      const found = said[place] ||= { acts: 0 };
      if (step.kind === 'death' || (step.kind === 'prompt' && i < index)) done.add(place);   // a new life: nothing said yet
      else if (step.kind === 'act' && ++found.acts > BUBBLE_STAYS) done.add(place);
      else if (step.kind === 'think' || step.kind === 'say') { found.step = step; found.now = i === index; done.add(place); }
    }
    for (const [id, f] of Object.entries(figures)) {
      const it = said[id]?.step;
      f.bubble.hidden = !it || !f.group.visible;
      if (f.bubble.hidden) continue;
      const text = it.text.replace(/\s+/g, ' ').trim();
      f.bubble.textContent = text.length > BUBBLE_LETTERS ? text.slice(0, BUBBLE_LETTERS - 1) + '…' : text;
      f.bubble.className = `bubble ${it.kind}` + (said[id].now ? '' : ' old');
    }
  }

  // Each figure glides to its new place instead of jumping there, and its bubble goes with it.
  // Bubbles of agents that stand close together would cover each other: the newer one stays
  // above its agent's head, an older one moves up out of its way.
  const glide = () => {
    const placed = [];
    const all = Object.values(figures);
    for (const f of all) f.group.position.lerp(f.target, 0.18);
    if (!camera || !box) return;
    const order = all.filter(f => !f.bubble.hidden).sort((a, b) => a.bubble.classList.contains('old') - b.bubble.classList.contains('old'));
    for (const f of order) {
      const head = f.group.position.clone().add(new THREE.Vector3(0, f.carried.visible ? 2.5 : 1.8, 0)).project(camera);
      f.bubble.style.visibility = head.z > 1 ? 'hidden' : '';   // behind the camera
      const x = (head.x + 1) / 2 * box.clientWidth, w = f.bubble.offsetWidth, h = f.bubble.offsetHeight;
      let y = (1 - head.y) / 2 * box.clientHeight;
      for (const other of placed)   // its box is from y - h - 14 up to y - 14
        if (Math.abs(other.x - x) < (other.w + w) / 2 + 6 && y - 14 > other.y - other.h - 14 - 6 && y - h - 14 < other.y - 14 + 6)
          y = other.y - other.h - 8;
      placed.push({ x, y, w, h });
      f.bubble.style.left = `${x}px`;
      f.bubble.style.top = `${y}px`;
      f.bubble.style.zIndex = f.bubble.classList.contains('old') ? 1 : 2;
    }
  };

  const remove = () => { for (const f of Object.values(figures)) f.bubble.remove(); };

  return { show, glide, speak, remove };
}
