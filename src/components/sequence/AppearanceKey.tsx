import { useMemo } from 'react';
import { useAppearanceStore } from '../../state/appearanceStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useAppearanceKeyStore } from '../../state/appearanceKeyStore';
import type { AppearanceProfile } from '../../schedule/appearance';

/** The colour a stage shows, or null when it keeps the object's own. */
const first = (...colours: (string | null)[]) => colours.find((c) => !!c) ?? null;

function Swatch({ profile }: { profile: AppearanceProfile }) {
  // Two halves: how it looks while the work is going on, and when it is done.
  const active = first(profile.activeStart.color, profile.activeFinish.color);
  const done = first(profile.endColor.color, profile.activeFinish.color);
  const half = (c: string | null) => c ?? 'repeating-linear-gradient(45deg, #cbd5e1, #cbd5e1 3px, #f1f5f9 3px, #f1f5f9 6px)';
  return (
    <span
      className="appearance-key__swatch"
      title={`${active ? `Active ${active}` : 'Active: own colour'} · ${done ? `Complete ${done}` : 'Complete: own colour'}`}
      style={{ background: `linear-gradient(135deg, ${half(active)} 50%, ${half(done)} 50%)` }}
    />
  );
}

/** Key of the Appearance profiles the Link Groups use: a swatch (active | complete) and the name of each. */
export function AppearanceKey() {
  const enabled = useAppearanceKeyStore((s) => s.enabled);
  const position = useAppearanceKeyStore((s) => s.position);
  const orientation = useAppearanceKeyStore((s) => s.orientation);
  const profiles = useAppearanceStore((s) => s.profiles);
  const groups = useLinkGroupsStore((s) => s.groups);
  const inUse = useMemo(() => {
    const ids = new Set(groups.map((g) => g.appearanceProfileId).filter((id): id is string => !!id));
    return profiles.filter((p) => ids.has(p.id) && !p.hideInKey);
  }, [profiles, groups]);
  if (!enabled || inUse.length === 0) return null;
  return (
    <div className={`appearance-key appearance-key--${orientation} sequence-label-overlay--${position}`} role="group" aria-label="Appearance profiles in use">
      {inUse.map((p) => (
        <span key={p.id} className="appearance-key__item">
          <Swatch profile={p} />
          <span className="appearance-key__name">{p.name}</span>
        </span>
      ))}
    </div>
  );
}
