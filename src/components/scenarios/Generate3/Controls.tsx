import { useEffect, useState, type ReactNode } from 'react';
import { IconClose } from '../../icons';
import { useRecipeStore } from '../../../state/recipeStore';
import { STANDARD_METHODS } from '../../../prs/standardMethods';
import { linkTargets, type ResolvedMethod, type WorkPackage } from '../../../prs/workPackages';
import type { useWorkPackages } from './useWorkPackages';

/** Controls Generate 3 uses in the package list and in Advanced: the method of a package, how it starts, and a number typed by hand. */

type WP = ReturnType<typeof useWorkPackages>;

/** A positive number from typed text ("2,5" too); undefined when empty or no use. */
export const parsePositive = (v: string): number | undefined => {
  const t = v.trim();
  if (!t) return undefined;
  const d = Number(t.replace(',', '.'));
  return Number.isFinite(d) && d > 0 ? d : undefined;
};

/** A number field that keeps what is typed while it is typed ("1." stays) and hands back the number, or undefined when it is cleared. */
export function NumberField({ value, placeholder, onChange, label, title, className }: { value: number | undefined; placeholder?: string; onChange: (v: number | undefined) => void; label: string; title?: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input type="text" inputMode="decimal" className={className ?? 'g3-num'} value={draft ?? (value ?? '')} placeholder={placeholder} aria-label={label} title={title}
      onClick={(e) => e.stopPropagation()} onChange={(e) => { setDraft(e.target.value); onChange(parsePositive(e.target.value)); }} onBlur={() => setDraft(null)} />
  );
}

/** The method of a package: automatic, a standard method, or one of the project's recipes. Choosing one clears the days fixed for the old one. */
export function MethodSelect({ wp, p, m }: { wp: WP; p: WorkPackage; m: ResolvedMethod }) {
  const recipes = useRecipeStore((s) => s.recipes);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  return (
    <select value={p.method ?? ''} aria-label="Method" title={m.chosen ? 'Chosen by you' : `Chosen automatically, because ${m.why}`} onClick={(e) => e.stopPropagation()}
      onChange={(e) => wp.patch(p.id, { method: e.target.value || undefined, days: undefined, people: undefined })}>
      <option value="">{p.method ? 'Back to the automatic choice' : `${m.name} (automatic)`}</option>
      <optgroup label="Standard methods">{STANDARD_METHODS.map((s) => <option key={s.id} value={`std:${s.id}`}>{s.name}</option>)}</optgroup>
      {chains.length > 0 && <optgroup label="This project’s recipes">{chains.map((r) => <option key={r.id} value={`recipe:${r.id}`}>{r.name?.trim() || r.id}</option>)}</optgroup>}
    </select>
  );
}

/** The package with objects just before this one in the build order (the one it follows unless told otherwise), or null for the first. */
export function packageAbove(wp: WP, id: string): WorkPackage | null {
  const live = wp.rows.filter((r) => (wp.contents.objects.get(r.pkg.id)?.length ?? 0) > 0).map((r) => r.pkg);
  const at = live.findIndex((p) => p.id === id);
  return at > 0 ? live[at - 1] : null;
}

/** How a package starts: after the one above, together with it, or after any other package (a package that holds others: when all of it is done);
    and the gap in working days. */
export function StartSelect({ wp, p, compact }: { wp: WP; p: WorkPackage; compact?: boolean }) {
  const above = packageAbove(wp, p.id);
  const code = (id: string) => wp.rows.find((r) => r.pkg.id === id)?.code ?? '';
  const name = (x: WorkPackage) => `${code(x.id)} ${x.name || 'Package'}`;
  const targets = linkTargets(wp.packages, p.id).filter((t) => t.id !== above?.id);
  const value = p.after ? `pkg:${p.after}` : p.link === 'with' ? 'with' : 'after';
  return (
    <span className={`g3-start${compact ? ' g3-start--compact' : ''}`} onClick={(e) => e.stopPropagation()}>
      <select value={value} aria-label="When it starts" title="When this package can start: after the package above finishes, together with it, or after another package finishes"
        onChange={(e) => { const v = e.target.value; wp.patch(p.id, { after: v.startsWith('pkg:') ? v.slice(4) : undefined, link: v === 'with' ? 'with' : undefined }); }}>
        <option value="after">{above ? `after ${name(above)} finishes` : 'at the start'}</option>
        {above && <option value="with">together with {name(above)}</option>}
        {targets.length > 0 && <optgroup label="Or after another package finishes">{targets.map((t) => <option key={t.id} value={`pkg:${t.id}`}>after {name(t)}{wp.rows.find((r) => r.pkg.id === t.id)?.children ? ' (all of it)' : ''}</option>)}</optgroup>}
      </select>
      <label className="g3-start__lag" title="Working days to wait before it starts (0: straight away)">+ <NumberField value={p.lagDays} placeholder="0" label="Gap in working days" onChange={(v) => wp.patch(p.id, { lagDays: v })} /> days</label>
    </span>
  );
}

/** A Generate 3 dialog: a header with its title and the close X, Esc or a click outside closes it. */
export function Dialog({ title, onClose, children, foot, wide = true }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="project-picker__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`g3-dlg${wide ? ' g3-dlg--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="g3-dlg__head"><h3>{title}</h3><button type="button" className="g3-dlg__close" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose /></button></div>
        <div className="g3-dlg__body">{children}</div>
        {foot && <div className="g3-dlg__foot">{foot}</div>}
      </div>
    </div>
  );
}
