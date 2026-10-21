import { describe, expect, it } from 'vitest';
import { addLinks, linkKey, linksOf, removeLinks, removeSoftLogic, setLinksSoft } from '../../src/schedule/linkTools';
import { activity, model, rel } from './helpers';

const m = () => model([activity('A'), activity('B'), activity('C'), activity('D')], [rel('A', 'B'), rel('B', 'C')]);
const ok = <T extends object>(r: { error: string } | ({ model: unknown } & T)) => { if ('error' in r) throw new Error(r.error); return r; };

describe('adding links to many activities', () => {
  it('gives every picked activity the chosen predecessor, skipping itself, duplicates and loops', () => {
    const r = ok(addLinks(m(), ['B', 'C', 'D'], ['A'], { role: 'pred', type: 'FS', lagDays: 1 }));
    // A>B is there already; A>C and A>D are new.
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(1);
    const links = (r.model as ReturnType<typeof m>).relationships;
    expect(links.find((x) => linkKey(x) === 'A>D')).toMatchObject({ type: 'FS', lagHours: 8 });
  });

  it('refuses a link that would close a loop', () => {
    const r = ok(addLinks(m(), ['A'], ['C'], { role: 'pred', type: 'FS', lagDays: 0 }));
    expect(r.added).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('makes the others the successors when asked, and can make them soft', () => {
    const r = ok(addLinks(m(), ['D'], ['A', 'B'], { role: 'succ', type: 'SS', lagDays: 0, soft: true }));
    expect(r.added).toBe(2);
    expect((r.model as ReturnType<typeof m>).relationships.filter((x) => x.soft).map(linkKey).sort()).toEqual(['D>A', 'D>B']);
  });

  it('says what is missing', () => {
    expect('error' in addLinks(m(), [], ['A'], { role: 'pred', type: 'FS', lagDays: 0 })).toBe(true);
    expect('error' in addLinks(m(), ['B'], [], { role: 'pred', type: 'FS', lagDays: 0 })).toBe(true);
  });
});

describe('removing links', () => {
  it('lists the links inside a selection, or every link touching it', () => {
    expect(linksOf(m(), ['A', 'B'], 'contained').map(linkKey)).toEqual(['A>B']);
    expect(linksOf(m(), ['B'], 'contained')).toEqual([]);
    expect(linksOf(m(), ['B'], 'uncontained').map(linkKey).sort()).toEqual(['A>B', 'B>C']);
  });

  it('removes only the links named', () => {
    const r = ok(removeLinks(m(), ['A>B']));
    expect(r.removed).toBe(1);
    expect((r.model as ReturnType<typeof m>).relationships.map(linkKey)).toEqual(['B>C']);
    expect(ok(removeLinks(m(), ['X>Y'])).removed).toBe(0);
  });
});

describe('soft logic', () => {
  it('marks links soft or hard, and removes the soft ones', () => {
    const soft = ok(setLinksSoft(m(), ['B>C'], true));
    expect(soft.changed).toBe(1);
    const mm = soft.model as ReturnType<typeof m>;
    expect(mm.relationships.find((x) => x.soft)).toMatchObject({ predId: 'B', succId: 'C' });
    expect(ok(setLinksSoft(mm, ['B>C'], true)).changed).toBe(0);
    const gone = ok(removeSoftLogic(mm));
    expect(gone.removed).toBe(1);
    expect((gone.model as ReturnType<typeof m>).relationships.map(linkKey)).toEqual(['A>B']);
    const hard = ok(setLinksSoft(mm, ['B>C'], false));
    expect((hard.model as ReturnType<typeof m>).relationships.some((x) => x.soft)).toBe(false);
  });
});
