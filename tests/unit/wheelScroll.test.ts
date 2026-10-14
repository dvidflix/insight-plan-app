import { describe, expect, it } from 'vitest';
import { wheelScrollBy } from '../../src/utils/wheelScroll';

const wheel = (over: Partial<WheelEvent>) => ({ ctrlKey: false, metaKey: false, altKey: false, deltaX: 0, deltaY: 100, deltaMode: 0, ...over });

describe('Ctrl + wheel over the Table and the Gantt', () => {
  it('scrolls twice as far as the wheel does', () => {
    expect(wheelScrollBy(wheel({ ctrlKey: true }))).toEqual({ x: 0, y: 200 });
    expect(wheelScrollBy(wheel({ metaKey: true, deltaY: -100, deltaX: 30 }))).toEqual({ x: 60, y: -200 });
  });

  it('counts a mouse that reports lines, and leaves the plain wheel and Alt + wheel (the Gantt zoom) alone', () => {
    expect(wheelScrollBy(wheel({ ctrlKey: true, deltaMode: 1, deltaY: 3 }))).toEqual({ x: 0, y: 240 });
    expect(wheelScrollBy(wheel({}))).toBeNull();
    expect(wheelScrollBy(wheel({ altKey: true }))).toBeNull();
    expect(wheelScrollBy(wheel({ ctrlKey: true, altKey: true }))).toBeNull();
  });
});
