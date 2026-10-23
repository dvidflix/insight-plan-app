import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useListQuery } from '../../../state/tableSearchStore';
import type { ColorRule } from '../../schedule/ColorPanel';
import { packageColor, packageFacts, visiblePackages, type PackageFacts } from '../../../prs/packageFields';
import type { useWorkPackages } from './useWorkPackages';

/** Generate 3's package list as a list of the app (ListConfig id `g3-packages`): its filters and colour rules (remembered), the main header's
    search words, and what follows from them: which packages show, which match, and the colour each is drawn in (list, timeline and 3D). */

export const G3_LIST = 'g3-packages';
export const NO_VALUE = '(none)';

export const useG3List = create<{ filters: Record<string, string[]>; colorRules: ColorRule[]; setFilter: (field: string, kept: string[]) => void; clearFilters: () => void; setColorRules: (r: ColorRule[]) => void }>()(
  persist((set) => ({
    filters: {},
    colorRules: [],
    setFilter: (field, kept) => set((s) => { const next = { ...s.filters }; if (kept.length) next[field] = kept; else delete next[field]; return { filters: next }; }),
    clearFilters: () => set({ filters: {} }),
    setColorRules: (colorRules) => set({ colorRules }),
  }), { name: 'generate3.list' }),
);

type WP = ReturnType<typeof useWorkPackages>;

export function usePackageListView(wp: WP) {
  const query = useListQuery(G3_LIST);
  const filters = useG3List((s) => s.filters);
  const colorRules = useG3List((s) => s.colorRules);
  const facts = useMemo(() => {
    const name = new Map(wp.rows.map((r) => [r.pkg.id, `${r.code} ${r.pkg.name}`]));
    return wp.rows.map((r) => packageFacts(r.pkg, r.code, r.pkg.parent ? name.get(r.pkg.parent) ?? '' : '', r.children, wp.contents.all.get(r.pkg.id) ?? [], wp.contents.objects.get(r.pkg.id)?.length ?? 0, wp.methods.get(r.pkg.id)));
  }, [wp.rows, wp.contents, wp.methods]);
  const shown = useMemo(() => visiblePackages(facts, filters, query, NO_VALUE), [facts, filters, query]);
  const colors = useMemo(() => new Map(facts.map((f, i) => [f.id, colorRules.length ? packageColor(f, colorRules, wp.rows[i].pkg.color) : wp.rows[i].pkg.color])), [facts, colorRules, wp.rows]);
  return {
    facts, query, filters, colorRules,
    /** null: every package shows. */
    visible: shown?.visible ?? null,
    matched: shown?.matched ?? null,
    /** Package id -> the colour it is drawn in (the same map until the packages or rules change). */
    colors,
    colorOf: (id: string) => colors.get(id) ?? '#888888',
  };
}

/** Each field's values over the packages, with how many have it (for the filter and colour panels). */
export function valuesOfField(facts: readonly PackageFacts[], field: string): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of facts) { const vs = f.values[field] ?? []; for (const v of vs.length ? vs : [NO_VALUE]) counts.set(v, (counts.get(v) ?? 0) + 1); }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => (a.value === NO_VALUE ? 1 : b.value === NO_VALUE ? -1 : a.value.localeCompare(b.value, undefined, { numeric: true })));
}
