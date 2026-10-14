import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../src/licence/freeMode';
import { STORE_KEY } from '../../src/licence/licence';

const fakeReal = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('free edition storage', () => {
  it('keeps settings in memory only', () => {
    const real = fakeReal();
    const mem = createMemoryStorage(real);
    mem.setItem('view.zoom', '3');
    expect(mem.getItem('view.zoom')).toBe('3');
    expect(mem.length).toBe(1);
    expect(real.m.size).toBe(0);
    mem.removeItem('view.zoom');
    expect(mem.getItem('view.zoom')).toBeNull();
  });
  it('lets only the licence key through to the real storage', () => {
    const real = fakeReal();
    const mem = createMemoryStorage(real);
    mem.setItem(STORE_KEY, 'IP1.x.y');
    expect(real.m.get(STORE_KEY)).toBe('IP1.x.y');
    expect(mem.getItem(STORE_KEY)).toBe('IP1.x.y');
    expect(mem.length).toBe(0);
  });
});
