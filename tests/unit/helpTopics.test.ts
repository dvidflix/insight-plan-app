import { describe, expect, it } from 'vitest';
import { helpTopics } from '../../src/help/content';

describe('help topics', () => {
  const topics = helpTopics();

  it('has the keyboard shortcuts page', () => {
    const t = topics.find((x) => x.slug === 'keyboard-shortcuts');
    expect(t?.title).toBe('Keyboard shortcuts');
    expect(t?.markdown).toContain('Ctrl+Alt+9');
  });

  it('builds the licences page from the licence file, one row per package', () => {
    const t = topics.find((x) => x.slug === 'licences');
    expect(t).toBeTruthy();
    const rows = t!.markdown.split('\n').filter((l) => /^\| [^|]+ \| [^|]* \| [^|]+ \| .*\|$/.test(l) && !l.startsWith('| ---'));
    expect(t!.markdown).toMatch(/## Libraries \((\d+)\)/);
    const n = Number(/## Libraries \((\d+)\)/.exec(t!.markdown)![1]);
    expect(n).toBeGreaterThan(20);
    expect(rows.length).toBeGreaterThanOrEqual(n);
    expect(t!.markdown).toContain('web-ifc');
  });

  it('orders the pages, shortcuts then licences last', () => {
    const slugs = topics.map((t) => t.slug);
    expect(slugs.indexOf('keyboard-shortcuts')).toBeLessThan(slugs.indexOf('licences'));
    expect(slugs[slugs.length - 1]).toBe('licences');
  });
});
