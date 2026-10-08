import * as OBC from '@thatopen/components';
import * as THREE from 'three';

/** Walkthrough: move through the model with the keyboard, as in a game, while the mouse still looks around.
      W / ↑   forward          S / ↓   back          A   left          D   right        (along the ground, whatever the pitch)
      E / Space / PageUp   up        Q / C / PageDown   down        ← →   turn
      Shift   faster        Esc   leave
    The camera is the viewer's own (camera-controls): moving shifts the camera and its target together, so dragging
    turns the view around a point just ahead (like turning the head) and the wheel still moves it forward / back. */

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const UP = ['KeyE', 'Space', 'PageUp'];
const DOWN = ['KeyQ', 'KeyC', 'PageDown'];
const TURN_LEFT = ['ArrowLeft'];
const TURN_RIGHT = ['ArrowRight'];
const ALL = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...UP, ...DOWN, ...TURN_LEFT, ...TURN_RIGHT]);

/** The turning speed with ← →, radians per second. */
const TURN_RATE = 1.2;
/** How far ahead the view's pivot is kept, in metres: close, so dragging looks around instead of orbiting the building. */
const LOOK_AHEAD = 1.5;
/** Shift multiplies the speed by this. */
const FAST = 3;

export const WALK_SPEEDS = [
  { id: 'slow', label: 'Slow (1.5 m/s)', speed: 1.5 },
  { id: 'normal', label: 'Normal (4 m/s)', speed: 4 },
  { id: 'fast', label: 'Fast (10 m/s)', speed: 10 },
  { id: 'faster', label: 'Very fast (25 m/s)', speed: 25 },
] as const;

/** Keys typed into a field belong to the field. */
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
};

export class Walkthrough {
  /** Fired when the walkthrough is entered or left. */
  readonly onChange = new OBC.Event<boolean>();
  /** Metres per second. */
  speed = 4;

  private active = false;
  private down = new Set<string>();
  private fast = false;
  private raf = 0;
  private last = 0;
  private hint: HTMLElement | null = null;

  constructor(
    private readonly camera: OBC.OrthoPerspectiveCamera,
    private readonly container: HTMLElement,
    /** Called before each move, e.g. to make a linked view follow this camera. */
    private readonly beforeMove: () => void = () => {},
  ) {}

  get isActive() {
    return this.active;
  }

  toggle() {
    if (this.active) this.disable();
    else this.enable();
  }

  enable() {
    if (this.active) return;
    this.active = true;
    // From where the camera is now, looking the way it looks: the pivot is brought close ahead.
    const c = this.camera.controls;
    const p = c.getPosition(new THREE.Vector3());
    const t = c.getTarget(new THREE.Vector3());
    const dir = t.sub(p);
    if (dir.lengthSq() < 1e-9) this.camera.three.getWorldDirection(dir);
    dir.normalize();
    void c.setLookAt(p.x, p.y, p.z, p.x + dir.x * LOOK_AHEAD, p.y + dir.y * LOOK_AHEAD, p.z + dir.z * LOOK_AHEAD, false);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.release);
    this.showHint();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.onChange.trigger(true);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.release);
    this.release();
    this.hint?.remove();
    this.hint = null;
    this.onChange.trigger(false);
  }

  dispose() {
    this.disable();
  }

  private release = () => {
    this.down.clear();
    this.fast = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      this.disable();
      return;
    }
    this.fast = e.shiftKey;
    // Ctrl / Cmd / Alt are other shortcuts' (Ctrl+S, Ctrl+W…): not movement.
    if (!ALL.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    this.down.add(e.code);
    // The page must not scroll (Space, PageUp / PageDown, arrows) nor a focused button be pressed.
    e.preventDefault();
    e.stopPropagation();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.fast = e.shiftKey;
    this.down.delete(e.code);
  };

  private any = (codes: string[]) => (codes.some((k) => this.down.has(k)) ? 1 : 0);

  private tick = (now: number) => {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const forward = this.any(FORWARD) - this.any(BACK);
    const right = this.any(RIGHT) - this.any(LEFT);
    const up = this.any(UP) - this.any(DOWN);
    const turn = this.any(TURN_RIGHT) - this.any(TURN_LEFT);
    if (forward || right || up || turn) {
      this.beforeMove();
      const c = this.camera.controls;
      const step = this.speed * (this.fast ? FAST : 1) * dt;
      if (forward) void c.forward(forward * step, false);
      if (right) void c.truck(right * step, 0, false);
      if (up) void c.elevate(up * step, false);
      // A positive azimuth turns the view to the left.
      if (turn) void c.rotate(-turn * TURN_RATE * dt * (this.fast ? 1.5 : 1), 0, false);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private showHint() {
    const el = document.createElement('div');
    el.className = 'walk-hint';
    el.innerHTML = '<b>Walkthrough</b> · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>E</kbd> / <kbd>Space</kbd> up · <kbd>Q</kbd> / <kbd>C</kbd> down · <kbd>←</kbd><kbd>→</kbd> turn · <kbd>Shift</kbd> faster · <kbd>Esc</kbd> leave';
    this.container.appendChild(el);
    this.hint = el;
  }
}
