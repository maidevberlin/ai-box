// Draws a block world in 3D: blocks in the colours of their kinds, items, the agents as
// robots and creatures as small boxes, a bubble over whoever just thought or said something.
// It is given a whole picture every time and works out by itself what has to be drawn again.
//
// A block at (x, y, z) is drawn at x to the right, z up, y away from the viewer (north).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Picture } from '../../blocks/world.ts';

/** A picture, and a number that changes whenever its blocks do. */
export interface View extends Picture { blocksVersion: number }
export interface Bubble { text: string; thought: boolean; loudness?: string }

export const PLACE_COLOURS = [0xe8553a, 0x8b5cf6, 0x14b8a6, 0xf59e0b, 0x3b82f6, 0xec4899, 0x84cc16, 0x64748b];
const TALL = 1.45;          // how tall a figure is, in blocks
const FLIGHT = 700;         // milliseconds a thrown thing is in the air
const BUBBLE_LETTERS = 180;
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const COLOURS = dark ? { sky: 0x10161b, water: 0x1d4257 } : { sky: 0xdbe9f0, water: 0x7fb4cc };

const spot = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

interface Robot { scene: THREE.Object3D; animations: THREE.AnimationClip[]; scale: number }
let robot: Robot | null = null;
const robotLoaded = new GLTFLoader().loadAsync('/assets/robot.glb').then(model => {
  model.scene.updateMatrixWorld(true);   // (its size is only right once its bones are in place)
  const size = new THREE.Box3().setFromObject(model.scene).getSize(new THREE.Vector3());
  robot = { scene: model.scene, animations: model.animations, scale: TALL / size.y };
}).catch(() => {});

interface Figure {
  group: THREE.Group;
  to: THREE.Vector3;
  /** The area it sees, lying on the ground around it. */
  sight: THREE.Mesh;
  carried: THREE.Mesh;
  bubble: CSS2DObject;
  mixer: THREE.AnimationMixer | null;
  clips: Record<string, THREE.AnimationAction>;
  playing: string;
  isRobot: boolean;
}

export class Scene {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  private readonly controls: OrbitControls;
  private readonly blocks = new THREE.Group();
  private readonly items = new THREE.Group();
  private readonly signs = new THREE.Group();
  private drawnSigns = '[]';
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly ball = new THREE.SphereGeometry(0.18, 14, 10);
  private readonly figures = new Map<number, Figure>();
  private readonly flying = new THREE.Mesh(this.cube, new THREE.MeshLambertMaterial());
  private flight: { path: THREE.Vector3[]; since: number } | null = null;
  private drawnBlocks = -1;
  private fitted = false;
  private frames = 0;        // how many more frames are drawn: nothing is drawn while nothing moves
  private last = performance.now();
  private stopped = false;
  private readonly box: HTMLElement;

  constructor(box: HTMLElement) {
    this.box = box;
    this.scene.background = new THREE.Color(COLOURS.sky);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 14, 9);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: COLOURS.water }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.3;
    this.flying.visible = false;
    this.scene.add(sun, water, this.blocks, this.items, this.signs, this.flying);
    this.labels.domElement.className = 'bubbles';
    box.append(this.renderer.domElement, this.labels.domElement);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.addEventListener('change', () => this.wake());
    new ResizeObserver(() => this.resize()).observe(box);
    this.resize();
    robotLoaded.then(() => {   // the stand-ins become robots
      for (const figure of this.figures.values()) {
        this.scene.remove(figure.group, figure.sight);
        figure.bubble.element.remove();
      }
      this.figures.clear();
      this.wake();
    });
    requestAnimationFrame(() => this.frame());
  }

  /** Something changed: draw for a while. */
  private wake(frames = 20): void {
    this.frames = Math.max(this.frames, frames);
  }

  private resize(): void {
    const { clientWidth: wide, clientHeight: high } = this.box;
    if (!wide || !high) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(wide, high);
    this.labels.setSize(wide, high);
    this.camera.aspect = wide / high;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  /** Shows a picture. `jump`: at once, without anyone gliding to where they are now. */
  show(view: View, bubbles: Map<number, Bubble>, jump: boolean): void {
    if (view.blocksVersion !== this.drawnBlocks) {
      this.drawnBlocks = view.blocksVersion;
      this.drawBlocks(view);
      if (!this.fitted) this.fit(view);
    }
    this.drawItems(view);
    this.drawSigns(view);
    const seen = new Set<number>();
    for (const body of view.bodies) {
      seen.add(body.id);
      const figure = this.figures.get(body.id) ?? this.figure(body, view);
      figure.to.copy(spot(body.x + 0.5, body.y + 0.5, body.z));
      if (jump || !figure.group.visible) figure.group.position.copy(figure.to);
      figure.group.visible = !body.dead;
      figure.sight.visible = !body.dead && !!body.sees;
      if (body.sees) figure.sight.scale.set(body.sees * 2 + 1, body.sees * 2 + 1, 1);
      const held = body.hand ? view.kinds[body.hand] : null;
      figure.carried.visible = !!held;
      if (held) {
        (figure.carried.material as THREE.MeshLambertMaterial).color.set(held.colour);
        figure.carried.scale.set(0.36, held.shape === 'sheet' ? 0.04 : 0.36, 0.36);
      }
      const bubble = body.place === undefined ? undefined : bubbles.get(body.place);
      const element = figure.bubble.element;
      figure.bubble.visible = !!bubble && !body.dead;
      if (bubble) {
        element.textContent = bubble.text.length > BUBBLE_LETTERS ? `${bubble.text.slice(0, BUBBLE_LETTERS)}…` : bubble.text;
        element.className = `bubble${bubble.thought ? ' thought' : ''}${bubble.loudness && bubble.loudness !== 'normal' ? ` ${bubble.loudness}` : ''}`;
      }
    }
    for (const [id, figure] of this.figures) {
      if (seen.has(id)) continue;
      this.scene.remove(figure.group, figure.sight);
      figure.bubble.element.remove();
      this.figures.delete(id);
    }
    this.wake();
  }

  /** A thrown thing flies along its path. */
  throw(path: number[][], colour: string): void {
    if (path.length < 2) return;
    (this.flying.material as THREE.MeshLambertMaterial).color.set(colour);
    this.flying.scale.setScalar(0.4);
    this.flight = { path: path.map(([x, y, z]) => spot(x!, y!, z!)), since: performance.now() };
    this.wake(FLIGHT / 10);
  }

  /** The next picture is of another world: the camera looks for it again. */
  reset(): void {
    this.fitted = false;
    this.drawnBlocks = -1;
    this.flight = null;
    this.flying.visible = false;
  }

  dispose(): void {
    this.stopped = true;
    this.renderer.dispose();
    this.box.replaceChildren();
  }

  private drawBlocks(view: View): void {
    for (const mesh of this.blocks.children) (mesh as THREE.InstancedMesh).dispose();
    this.blocks.clear();
    const byKind = new Map<string, Picture['blocks']>();
    for (const block of view.blocks) {
      if (!byKind.has(block[3])) byKind.set(block[3], []);
      byKind.get(block[3])!.push(block);
    }
    const placed = new THREE.Object3D();
    for (const [kind, list] of byKind) {
      const look = view.kinds[kind];
      const below = !!look?.ground || list.every(([, , z]) => z < 0);   // the ground is drawn without gaps, other blocks with a small one
      // (The ground is blocks too: every other one is a shade darker, so that they can be told apart.)
      const colour = new THREE.Color(look?.colour ?? '#888'), shade = new THREE.Color();
      const material = new THREE.MeshLambertMaterial({ color: below ? '#fff' : colour, transparent: !!look?.soft, opacity: look?.soft ? 0.8 : 1 });
      const mesh = new THREE.InstancedMesh(this.cube, material, list.length);
      list.forEach(([x, y, z], i) => {
        if (below) mesh.setColorAt(i, shade.copy(colour).multiplyScalar((x + y + z) % 2 ? 1 : 0.9));
        placed.position.copy(spot(x + 0.5, y + 0.5, z + 0.5));
        placed.scale.setScalar(below ? 1 : 0.94);
        placed.updateMatrix();
        mesh.setMatrixAt(i, placed.matrix);
      });
      this.blocks.add(mesh);
    }
  }

  private drawItems(view: View): void {
    for (const mesh of this.items.children) ((mesh as THREE.Mesh).material as THREE.Material).dispose();
    this.items.clear();
    for (const [x, y, z, kind] of view.items) {
      const look = view.kinds[kind];
      const mesh = new THREE.Mesh(look?.shape === 'ball' ? this.ball : this.cube, new THREE.MeshLambertMaterial({ color: look?.colour ?? '#ccc' }));
      if (look?.shape === 'sheet') mesh.scale.set(0.6, 0.05, 0.45);
      else if (look?.shape !== 'ball') mesh.scale.setScalar(0.3);
      mesh.position.copy(spot(x + 0.5, y + 0.5, z + (look?.shape === 'sheet' ? 0.03 : 0.17)));
      this.items.add(mesh);
    }
  }

  /** What a world has written at places, for whoever watches: made again only when it changed. */
  private drawSigns(view: View): void {
    const wanted = JSON.stringify(view.signs);
    if (wanted === this.drawnSigns) return;
    this.drawnSigns = wanted;
    for (const sign of this.signs.children) (sign as CSS2DObject).element.remove();
    this.signs.clear();
    for (const [x, y, z, text, where] of view.signs) {
      const sign = new CSS2DObject(document.createElement('div'));
      sign.element.className = `sign ${where === 'on' ? 'on' : 'beside'}`;
      sign.element.textContent = text;
      sign.position.copy(spot(x + { on: 0.5, east: 1.1, west: -0.1 }[where], y + 0.5, z + (where === 'on' ? 1 : 0.5)));
      sign.center.set({ on: 0.5, east: 0, west: 1 }[where], 0.5);
      this.signs.add(sign);
    }
  }

  private figure(body: Picture['bodies'][number], view: View): Figure {
    const group = new THREE.Group();
    const colour = body.creature ? new THREE.Color(view.kinds[body.creature]?.colour ?? '#ccc')
      : new THREE.Color(PLACE_COLOURS[((body.place ?? 1) - 1) % PLACE_COLOURS.length]);
    let mixer: THREE.AnimationMixer | null = null;
    const clips: Record<string, THREE.AnimationAction> = {};
    const isRobot = !body.creature && !!robot;
    if (body.creature) {
      const mesh = new THREE.Mesh(this.cube, new THREE.MeshLambertMaterial({ color: colour }));
      mesh.scale.set(0.45, 0.4, 0.6);
      mesh.position.y = 0.2;
      group.add(mesh);
    } else if (robot) {
      const model = SkeletonUtils.clone(robot.scene);
      model.scale.setScalar(robot.scale);
      model.traverse(part => {
        const mesh = part as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();   // its own, to colour it
        if (material.name === 'Main') material.color.copy(colour);
        mesh.material = material;
      });
      mixer = new THREE.AnimationMixer(model);
      for (const clip of robot.animations) clips[clip.name] = mixer.clipAction(clip);
      clips.Idle?.play();
      mixer.update(0);
      group.add(model);
    } else {   // until the robot is loaded: a simple stand-in
      const look = new THREE.MeshLambertMaterial({ color: colour });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 20), look);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 14), look);
      trunk.position.y = 0.55;
      head.position.y = 1.38;
      group.add(trunk, head);
    }
    const carried = new THREE.Mesh(this.cube, new THREE.MeshLambertMaterial());
    carried.position.y = TALL + 0.35;
    const bubble = new CSS2DObject(document.createElement('div'));
    bubble.position.y = TALL + 0.75;
    bubble.center.set(0.5, 1);
    group.add(carried, bubble);
    // What it sees: a square in its colour on the ground, as far as its sight reaches.
    const sight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.16, depthWrite: false }));
    sight.rotation.x = -Math.PI / 2;
    sight.visible = false;
    this.scene.add(group, sight);
    const figure: Figure = { group, to: new THREE.Vector3(), sight, carried, bubble, mixer, clips, playing: 'Idle', isRobot };
    this.figures.set(body.id, figure);
    return figure;
  }

  /** Puts the camera where it sees the whole land. */
  private fit(view: View): void {
    if (!view.blocks.length) return;
    this.fitted = true;
    const box = new THREE.Box3();
    for (const [x, y, z] of view.blocks) box.expandByPoint(spot(x + 0.5, y + 0.5, z + 0.5));
    const middle = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const far = Math.max(size.x, size.z, 8) * 1.4;
    this.controls.target.set(middle.x, 0, middle.z);
    this.camera.position.set(middle.x, far * 0.75, middle.z + far);
    this.controls.update();
  }

  private frame(): void {
    if (this.stopped) return;
    requestAnimationFrame(() => this.frame());
    const now = performance.now(), passed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden || this.frames <= 0) return;
    this.frames--;
    for (const figure of this.figures.values()) {
      const left = figure.group.position.distanceTo(figure.to);
      const moving = left > 0.03;
      if (moving) {
        const toward = figure.to.clone().sub(figure.group.position);
        if (Math.hypot(toward.x, toward.z) > 0.05) figure.group.rotation.y = Math.atan2(toward.x, toward.z);
        figure.group.position.lerp(figure.to, Math.min(1, passed * 9));
        this.wake(4);
      } else figure.group.position.copy(figure.to);
      figure.sight.position.set(figure.group.position.x, 0.02, figure.group.position.z);
      const wanted = moving ? 'Walking' : 'Idle';
      if (figure.mixer && wanted !== figure.playing && figure.clips[wanted]) {
        figure.clips[figure.playing]?.fadeOut(0.15);
        figure.clips[wanted]!.reset().fadeIn(0.15).play();
        figure.playing = wanted;
      }
      if (figure.mixer && moving) figure.mixer.update(passed);
    }
    if (this.flight) {
      const along = (now - this.flight.since) / FLIGHT, { path } = this.flight;
      if (along >= 1) {
        this.flight = null;
        this.flying.visible = false;
      } else {
        const exact = along * (path.length - 1), i = Math.floor(exact);
        this.flying.position.lerpVectors(path[i]!, path[Math.min(i + 1, path.length - 1)]!, exact - i);
        this.flying.visible = true;
        this.wake(4);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
