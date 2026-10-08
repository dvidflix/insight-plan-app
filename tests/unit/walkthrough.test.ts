import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Walkthrough } from '../../src/viewer/walkthrough';

type Listener = (e: unknown) => void;

/** The few browser globals the walkthrough touches, and a frame loop the test drives by hand. */
function setup() {
  const listeners = new Map<string, Listener[]>();
  let frame: ((now: number) => void) | null = null;
  const win = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: Listener) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
  };
  const hint = { className: '', innerHTML: '', removed: false, remove() { this.removed = true; } };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { createElement: () => hint });
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frame = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });

  const calls: string[] = [];
  const rec = (name: string) => (...a: unknown[]) => { const nums = a.filter((n): n is number => typeof n === 'number').slice(0, 2); calls.push(`${name}(${nums.map((n) => Math.round(n * 1000) / 1000).join(',')})`); return Promise.resolve(); };
  const camera = {
    controls: {
      getPosition: (v: { set: (...a: number[]) => unknown }) => v.set(0, 2, 0),
      getTarget: (v: { set: (...a: number[]) => unknown }) => v.set(0, 2, -10),
      setLookAt: rec('lookAt'),
      forward: rec('forward'), truck: rec('truck'), elevate: rec('elevate'), rotate: rec('rotate'),
    },
    three: { getWorldDirection: (v: unknown) => v },
  };
  const container = { appendChild: vi.fn() };
  const fire = (type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}) => {
    const e = { code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'DIV' }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    for (const fn of listeners.get(type) ?? []) fn(e);
    return e;
  };
  // One frame, `ms` after the last.
  let now = 0;
  const step = (ms: number) => { now += ms; frame?.(now); };
  return { camera, container, fire, step, calls, hint, listeners };
}

describe('walkthrough', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const start = () => {
    const t = setup();
    const w = new Walkthrough(t.camera as never, t.container as never);
    w.speed = 4;
    w.enable();
    return { ...t, w };
  };

  it('brings the pivot close ahead and shows the keys', () => {
    const { calls, hint, container, w } = start();
    expect(w.isActive).toBe(true);
    expect(calls[0]).toBe('lookAt(0,2)'); // from where the camera is
    expect(hint.innerHTML).toContain('Walkthrough');
    expect(container.appendChild).toHaveBeenCalled();
  });

  it('W and S walk forward and back, A and D go left and right, at the speed per second', () => {
    const { fire, step, calls } = start();
    calls.length = 0;
    fire('keydown', 'KeyW');
    step(100);
    expect(calls).toEqual(['forward(0.4)']); // 4 m/s for 0.1 s
    fire('keyup', 'KeyW');
    calls.length = 0;
    fire('keydown', 'KeyS');
    step(100);
    expect(calls).toEqual(['forward(-0.4)']);
    fire('keyup', 'KeyS');
    calls.length = 0;
    fire('keydown', 'KeyD');
    step(100);
    fire('keyup', 'KeyD');
    fire('keydown', 'KeyA');
    step(100);
    expect(calls).toEqual(['truck(0.4,0)', 'truck(-0.4,0)']);
  });

  it('several keys for up and for down', () => {
    const { fire, step, calls } = start();
    for (const [code, sign] of [['KeyE', 1], ['Space', 1], ['PageUp', 1], ['KeyQ', -1], ['KeyC', -1], ['PageDown', -1]] as const) {
      calls.length = 0;
      fire('keydown', code);
      step(100);
      fire('keyup', code);
      expect(calls, code).toEqual([`elevate(${sign * 0.4})`]);
    }
  });

  it('the arrows walk and turn, and Shift is faster', () => {
    const { fire, step, calls } = start();
    calls.length = 0;
    fire('keydown', 'ArrowUp');
    step(100);
    fire('keyup', 'ArrowUp');
    expect(calls).toEqual(['forward(0.4)']);
    calls.length = 0;
    fire('keydown', 'ArrowRight');
    step(100);
    fire('keyup', 'ArrowRight');
    expect(calls[0]).toMatch(/^rotate\(-0\.12/); // a turn to the right is a negative azimuth
    calls.length = 0;
    fire('keydown', 'KeyW', { shiftKey: true });
    step(100);
    expect(calls).toEqual(['forward(1.2)']); // 3 times faster
  });

  it('moves nothing when no key is held, and diagonals combine', () => {
    const { fire, step, calls } = start();
    calls.length = 0;
    step(100);
    expect(calls).toEqual([]);
    fire('keydown', 'KeyW');
    fire('keydown', 'KeyD');
    step(100);
    expect(calls).toEqual(['forward(0.4)', 'truck(0.4,0)']);
  });

  it('leaves the keys to a text field and to Ctrl shortcuts', () => {
    const { fire, step, calls } = start();
    calls.length = 0;
    const typed = fire('keydown', 'KeyW', { target: { tagName: 'INPUT' } });
    const save = fire('keydown', 'KeyS', { ctrlKey: true });
    step(100);
    expect(calls).toEqual([]);
    expect(typed.preventDefault).not.toHaveBeenCalled();
    expect(save.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps the page from scrolling on Space, and Esc leaves for good', () => {
    const { fire, step, calls, w, hint, listeners } = start();
    const space = fire('keydown', 'Space');
    expect(space.preventDefault).toHaveBeenCalled();
    const events: boolean[] = [];
    w.onChange.add((a: boolean) => events.push(a));
    fire('keydown', 'Escape');
    expect(w.isActive).toBe(false);
    expect(events).toEqual([false]);
    expect(hint.removed).toBe(true);
    expect(listeners.get('keydown')).toEqual([]);
    calls.length = 0;
    step(100);
    expect(calls).toEqual([]);
  });
});
