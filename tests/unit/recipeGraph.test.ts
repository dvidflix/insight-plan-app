import { describe, expect, it } from 'vitest';
import { END, START, autoLayout, graphEdges, positions } from '../../src/prs/recipeGraph';
import type { Recipe } from '../../src/prs/recipes';

const slab: Pick<Recipe, 'tasks' | 'edges'> = {
  tasks: ['Decking', 'Under Slab', 'Rebar', 'FWK', 'Concrete', 'Curing'].map((phase) => ({ phase })),
  edges: [
    { from: 'Decking', to: 'Under Slab', sharePct: 80 },
    { from: 'Decking', to: 'Rebar', sharePct: 80 },
    { from: 'Under Slab', to: 'Rebar', sharePct: 80 },
    { from: 'Rebar', to: 'FWK', sharePct: 80 },
    { from: 'FWK', to: 'Concrete' },
    { from: 'Rebar', to: 'Concrete' },
  ],
};

describe('the graph of a recipe', () => {
  it('has the written links, and for a task with none a dashed link from the task before it', () => {
    const edges = graphEdges(slab);
    expect(edges.filter((e) => !e.implicit)).toHaveLength(6);
    expect(edges.find((e) => e.to === 'Decking')).toMatchObject({ from: START, implicit: true });
    expect(edges.find((e) => e.to === 'Curing')).toMatchObject({ from: 'Concrete', implicit: true });
    expect(edges.find((e) => e.from === 'Curing')).toMatchObject({ to: END });
    expect(edges.find((e) => e.from === 'Decking' && e.to === 'Rebar')!.sharePct).toBe(80);
  });

  it('ignores a link to a task that is not there', () => {
    const edges = graphEdges({ tasks: [{ phase: 'A' }], edges: [{ from: 'Nope', to: 'A' }] });
    expect(edges.filter((e) => !e.implicit)).toEqual([]);
    expect(edges.find((e) => e.to === 'A')).toMatchObject({ from: START, implicit: true });
  });

  it('puts a task one layer after the last task it follows', () => {
    const at = autoLayout(slab);
    const layer = (p: string) => at.get(p)!.x;
    expect(layer('Decking')).toBeLessThan(layer('Under Slab'));
    expect(layer('Under Slab')).toBeLessThan(layer('Rebar'));
    expect(layer('Rebar')).toBeLessThan(layer('Concrete'));
    expect(layer('Concrete')).toBeLessThan(layer('Curing'));
    expect(at.get(END)!.x).toBeGreaterThan(layer('Curing'));
  });

  it('puts tasks of one layer in rows, and stops on a cycle', () => {
    const fork = autoLayout({ tasks: [{ phase: 'A' }, { phase: 'B' }, { phase: 'C' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }] });
    expect(fork.get('B')!.x).toBe(fork.get('C')!.x);
    expect(fork.get('B')!.y).not.toBe(fork.get('C')!.y);
    const loop = autoLayout({ tasks: [{ phase: 'A' }, { phase: 'B' }], edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }] });
    expect(loop.get('A')).toBeDefined();
  });

  it('keeps where a task was put', () => {
    const at = positions({ ...slab, tasks: slab.tasks.map((t) => (t.phase === 'FWK' ? { ...t, x: 5, y: 7 } : t)) });
    expect(at.get('FWK')).toEqual({ x: 5, y: 7 });
    expect(at.get('Rebar')).toEqual(autoLayout(slab).get('Rebar'));
  });
});
