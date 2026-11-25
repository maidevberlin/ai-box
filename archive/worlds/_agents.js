// The agents as every world draws them: an animated figure, the thing it carries above its
// head, a lighter patch on the ground for what it sees, and a bubble for what it says or thinks.
// (Not a world's drawing itself: its name starts with "_".)
//
// The figure is a small robot (assets/robot.glb: "RobotExpressive" by Tomás Laulhé, CC0, from
// the three.js examples). It stands idle, walks while it moves, jumps, waves when it says
// something, and falls over when it drowns. If the model cannot be loaded, a simple figure
// made of a cylinder and a ball stands in for it.
//
// Several agents can live in a world at the same time, each in its own place (1, 2, ...).
// A place has its own colour, the same one as in the conversation next to the picture.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const PLACE_COLOURS = [0xe8553a, 0x8b5cf6, 0x14b8a6, 0xf59e0b];

const TALL = 1.45;   // how tall a figure is, in blocks
// The model, loaded once for the whole page. (Every world's drawing waits for it.)
const robot = await new GLTFLoader().loadAsync(new URL('./assets/robot.glb', import.meta.url).href).catch(() => null);
robot?.scene.updateMatrixWorld(true);   // (its bones must be in place before it is measured)
const robotScale = robot ? TALL / new THREE.Box3().setFromObject(robot.scene).getSize(new THREE.Vector3()).y : 1;

// Coming and going is shown when the run is played forward, one step at a time:
//   waking up   a beam of light, and the figure grows out of it
//   drowning    the figure falls over and sinks into the water, with a splash
//   gone        (it ended its turn, or had to make room) the figure rises, shrinks and fades
const LASTS = { wake: 900, sink: 1300, gone: 1000 };   // milliseconds

// What an agent says or thinks is shown in a bubble above its head: a speech bubble for
// what it says, a thought bubble for what it thinks. A bubble stays while the agent does a
// few more things, then goes. (Only the start of a long text is shown.) The bubbles are
// placed over the picture by three.js's CSS2DRenderer.
const BUBBLE_STAYS = 4;     // how many more actions of the same agent a bubble stays for
const BUBBLE_LETTERS = 180;

let styled = false;
function addStyle() {   // once per page: how bubbles look, in light and in dark
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
    .bubbles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .bubble-at { width: 0; height: 0; }
    .bubble { position: absolute; left: 0; top: 0; max-width: 260px; width: max-content;
              padding: 7px 11px; border-radius: 14px; font: 12.5px/1.35 system-ui, sans-serif; color: #1d2126;
              background: #fff; border: 2px solid var(--who); box-shadow: 0 4px 14px rgba(0, 0, 0, .22);
              transform: translate(-50%, calc(-100% - 12px)); white-space: pre-wrap; overflow-wrap: anywhere; }
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
// The world's drawing calls render() after drawing the picture, and resize() when it resizes.
export function crowd(scene, cube, dress, camera, box) {
  const figures = {};   // place -> everything about one figure
  addStyle();
  const labels = camera && box ? new CSS2DRenderer() : null;
  if (labels) { labels.domElement.className = 'bubbles'; box.append(labels.domElement); }

  // The body: the robot in this place's colour, with its animations; or the simple stand-in.
  function body(colour) {
    if (!robot) {
      const look = new THREE.MeshLambertMaterial({ color: colour, transparent: true });
      const model = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 20), look);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), look);
      trunk.position.y = 0.55; head.position.y = 1.38;
      model.add(trunk, head);
      return { model, looks: [look], mixer: null, clips: {} };
    }
    const model = SkeletonUtils.clone(robot.scene);
    model.scale.setScalar(robotScale);
    const looks = [];
    model.traverse(part => {
      if (!part.isMesh) return;
      part.material = part.material.clone();   // its own, to colour and fade it
      part.material.transparent = true;
      if (part.material.name === 'Main') part.material.color.setHex(colour);
      looks.push(part.material);
    });
    const mixer = new THREE.AnimationMixer(model);
    const clips = Object.fromEntries(robot.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
    for (const name of ['Jump', 'Wave', 'Death']) {   // played once
      clips[name].setLoop(THREE.LoopOnce, 1);
      clips[name].clampWhenFinished = true;
    }
    clips.Idle.play();
    mixer.update(0);   // stand in the idle pose at once (also for a still picture)
    return { model, looks, mixer, clips };
  }

  function figure(id) {
    const colour = PLACE_COLOURS[(id - 1) % PLACE_COLOURS.length];
    const group = new THREE.Group();
    const { model, looks, mixer, clips } = body(colour);
    const carried = new THREE.Mesh(cube);
    carried.position.y = TALL + 0.55;
    group.add(model, carried);
    const sight = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }));
    scene.add(group, sight);
    // The bubble hangs above the head, wherever the figure is.
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.hidden = true;
    bubble.style.setProperty('--who', '#' + colour.toString(16).padStart(6, '0'));
    const at = document.createElement('div');
    at.className = 'bubble-at';
    at.append(bubble);
    const label = new CSS2DObject(at);
    label.position.y = TALL + 0.3;
    group.add(label);
    // The effects of coming and going: a beam of light, and a ring on the ground or the water.
    const glow = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4, 24, 1, true), glow);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32), glow.clone());
    ring.rotation.x = -Math.PI / 2;
    beam.visible = ring.visible = false;
    scene.add(beam, ring);
    return { group, model, looks, mixer, clips, looping: 'Idle', once: null, carried, sight, bubble, label, beam, ring,
             base: new THREE.Vector3(), target: new THREE.Vector3(), isNew: true, alive: false, anim: null };
  }

  // agents: [{ id, pos, height, carrying, dead, view }]. place(x, y, up) is the world's own.
  function show(agents, place, fresh) {
    for (const id in figures) if (!agents.some(a => a.id === +id)) figures[id].group.visible = figures[id].sight.visible = false;
    for (const a of agents) {
      const f = figures[a.id] ||= figure(a.id);
      f.target = place(...a.pos, a.height);
      if (fresh || f.isNew) { f.base.copy(f.target); f.group.position.copy(f.target); }
      f.isNew = false;
      f.dead = a.dead;
      f.group.visible = f.sight.visible = !a.dead;   // drowned: gone until a new agent wakes up
      f.carried.visible = !!a.carrying;
      if (a.carrying) { dress(f.carried, a.carrying); f.carried.scale.multiplyScalar(0.64); }
      const reach = a.view * 2 + 1 + (a.id - 1) * 0.04;   // wider when the agent stands higher
      f.sight.scale.set(reach, 0.02, reach);
      f.sight.position.copy(place(...a.pos, 0.01 + a.id * 0.002));
    }
  }

  // A movement that is played once: a jump, a wave, a fall. Then back to standing or walking.
  function play(f, name) {
    if (!f.mixer || !f.clips[name]) return;
    if (f.once) f.clips[f.once].fadeOut(0.1);
    f.once = name;
    f.clips[name].reset().fadeIn(0.1).play();
    f.clips[f.looping].fadeOut(0.1);
  }

  // Who is alive at the step on screen, and the animation of coming or going when the run is
  // played forward onto a step where that changes. An agent that ended its turn stays in the
  // world's record where it stood until a new one wakes up: it is shown gone from its death on.
  let lastIndex = -1;
  function lives(steps, index) {
    const forward = index === lastIndex + 1, again = index === lastIndex;
    lastIndex = index;
    const gone = {};   // place -> whether its last step up to here is a death
    for (let i = index; i >= 0 && Object.keys(gone).length < Object.keys(figures).length; i--) {
      const place = steps[i].place || 1;
      if (place in gone || !(place in figures)) continue;
      if (['death', 'prompt', 'act', 'think', 'say'].includes(steps[i].kind)) gone[place] = steps[i].kind === 'death';
    }
    for (const [id, f] of Object.entries(figures)) {
      const alive = !f.dead && !gone[id];
      if (again) { if (f.anim) f.group.visible = true; else f.group.visible = f.sight.visible = alive; continue; }
      if (forward && f.alive && !alive) start(f, f.dead ? 'sink' : 'gone');
      else if (forward && !f.alive && alive) { f.base.copy(f.target); start(f, 'wake'); }
      else stop(f);
      f.alive = alive;
      f.group.visible = alive || !!f.anim;   // a going one stays in sight while it goes
      f.sight.visible = alive;
    }
    // What the agent on this step does, played as a movement when the run is played forward.
    const step = steps[index], f = figures[step?.place || 1];
    if (forward && f && f.alive) {
      if (step.kind === 'act' && step.tool === 'jump') play(f, 'Jump');
      else if (step.kind === 'say') play(f, 'Wave');
    }
  }

  function start(f, kind) {
    f.anim = { kind, start: performance.now() };
    f.beam.visible = kind !== 'sink';
    f.ring.visible = true;
    if (kind === 'sink') play(f, 'Death');
  }

  function stop(f) {
    f.anim = null;
    f.beam.visible = f.ring.visible = false;
    f.group.scale.setScalar(1);
    for (const look of f.looks) look.opacity = 1;
  }

  // One frame of an animation of coming or going. Returns how far up or down the figure is moved.
  function animate(f, now) {
    const { kind, start: began } = f.anim, t = Math.min((now - began) / LASTS[kind], 1);
    const ease = 1 - (1 - t) ** 3;
    const fade = opacity => { for (const look of f.looks) look.opacity = opacity; };
    let lift = 0;
    f.beam.position.copy(f.base);
    f.beam.position.y += 2;
    f.ring.position.copy(f.base);
    f.ring.position.y += kind === 'sink' ? -0.15 : 0.03;
    if (kind === 'wake') {          // grows out of a beam of light that then fades
      const grow = t < 0.75 ? ease * 1.12 : 1.12 - (t - 0.75) / 0.25 * 0.12;   // a little too big, then settles
      f.group.scale.setScalar(Math.max(0.01, Math.min(grow, 1.12)));
      fade(Math.min(1, t * 2));
      f.beam.material.opacity = 0.45 * (1 - t);
      f.beam.scale.set(1 - t * 0.6, 1, 1 - t * 0.6);
      f.ring.material.opacity = 0.8 * (1 - t);
      f.ring.scale.setScalar(1 + t * 2.5);
      lift = (1 - ease) * 0.8;
    } else if (kind === 'sink') {   // falls over, then goes under; a splash spreads on the water
      lift = t < 0.4 ? 0 : -(((t - 0.4) / 0.6) ** 2) * 1.8;
      fade(1 - Math.max(0, t - 0.4) * 1.3);
      f.ring.material.opacity = 0.9 * (1 - t);
      f.ring.scale.setScalar(1 + ease * 4);
    } else {                        // rises, shrinks and fades away, in a fading light
      lift = ease * 1.4;
      f.group.scale.set(1 - ease * 0.8, 1 + ease * 0.3, 1 - ease * 0.8);
      fade(1 - t);
      f.carried.visible = false;
      f.beam.material.opacity = 0.35 * (1 - t);
      f.ring.material.opacity = 0.6 * (1 - t);
      f.ring.scale.setScalar(1 + ease * 1.5);
    }
    if (t >= 1) {
      const ended = kind;
      stop(f);
      if (ended !== 'wake') f.group.visible = false;
      if (ended === 'sink' && f.once === 'Death') { f.clips.Death.stop(); f.once = null; f.clips[f.looping].reset().play(); }
    }
    return lift;
  }

  // What each agent said or thought last, up to the step on screen: shown while it is recent.
  function speak(steps, index) {
    lives(steps, index);
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
      f.label.visible = !f.bubble.hidden;
      if (f.bubble.hidden) continue;
      const text = it.text.replace(/\s+/g, ' ').trim();
      f.bubble.textContent = text.length > BUBBLE_LETTERS ? text.slice(0, BUBBLE_LETTERS - 1) + '…' : text;
      f.bubble.className = `bubble ${it.kind}` + (said[id].now ? '' : ' old');
    }
  }

  // Every frame while the picture moves: each figure glides to its new place, faces the way it
  // goes, walks while it moves and stands still when it has arrived.
  let lastFrame = 0;
  const glide = () => {
    const now = performance.now(), dt = Math.min((now - (lastFrame || now)) / 1000, 0.1);
    lastFrame = now;
    for (const f of Object.values(figures)) {
      const dx = f.target.x - f.base.x, dz = f.target.z - f.base.z;
      const moving = Math.hypot(dx, dz) > 0.04;
      if (moving) f.model.rotation.y = Math.atan2(dx, dz);   // the robot looks along +z
      f.base.lerp(f.target, 0.12);
      const lift = f.anim ? animate(f, now) : 0;
      f.group.position.copy(f.base);
      f.group.position.y += lift;
      if (!f.mixer) continue;
      const loop = moving ? 'Walking' : 'Idle';
      if (loop !== f.looping) {
        f.clips[f.looping].fadeOut(0.2);
        if (!f.once) f.clips[loop].reset().fadeIn(0.2).play();
        f.looping = loop;
      }
      if (f.once && f.once !== 'Death' && !f.clips[f.once].isRunning()) {   // a jump or wave is over
        f.clips[f.once].fadeOut(0.2);
        f.clips[f.looping].reset().fadeIn(0.2).play();
        f.once = null;
      }
      f.mixer.update(dt);
    }
  };

  // The bubbles, placed over the picture. Bubbles of agents that stand close together would
  // cover each other: the newer one stays above its agent's head, an older one moves up.
  const point = new THREE.Vector3();
  function render() {
    if (!labels) return;
    const shown = Object.values(figures).filter(f => f.label.visible)
      .sort((a, b) => a.bubble.classList.contains('old') - b.bubble.classList.contains('old'));
    const placed = [];
    for (const f of shown) {
      f.label.getWorldPosition(point).project(camera);
      const x = (point.x + 1) / 2 * box.clientWidth, w = f.bubble.offsetWidth, h = f.bubble.offsetHeight;
      let y = (1 - point.y) / 2 * box.clientHeight;
      const own = y;
      for (const other of placed)   // its box is from y - h up to y
        if (Math.abs(other.x - x) < (other.w + w) / 2 + 6 && y > other.y - other.h - 6 && y - h < other.y + 6)
          y = other.y - other.h - 8;
      placed.push({ x, y, w, h });
      f.bubble.style.marginTop = `${y - own}px`;
      f.label.element.style.zIndex = f.bubble.classList.contains('old') ? 1 : 2;
    }
    labels.render(scene, camera);
  }

  const resize = (width, height) => labels?.setSize(width, height);

  const remove = () => labels?.domElement.remove();

  // Whether something still moves: then the picture has to keep being drawn.
  const busy = () => Object.values(figures).some(f =>
    f.anim || f.once || Math.hypot(f.target.x - f.base.x, f.target.z - f.base.z) > 0.01);

  return { show, glide, speak, render, resize, remove, busy };
}
