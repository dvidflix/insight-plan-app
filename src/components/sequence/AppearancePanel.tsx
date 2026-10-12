import { MATERIAL_CLASSES, MATERIAL_CLASS_LABELS, type MaterialClass } from '../../viewer/materialClasses';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { HexColorInput } from '../HexColorInput';
import {
  DEFAULT_GROWTH_DISTANCE,
  DEFAULT_GROWTH_VECTOR,
  GROWS_OVER_TASK,
  GROWTH_IN,
  GROWTH_OUT,
  type GrowthIn,
  type GrowthOut,
  emptyAppearanceProfile,
  newAppearanceId,
  type AppearanceAction,
  type AppearanceProfile,
  type AppearanceStage,
} from '../../schedule/appearance';
import { useAppearanceStore } from '../../state/appearanceStore';
import { IconCopy, IconEye, IconEyeOff, IconPencil } from '../icons';

const ACTIONS: { value: AppearanceAction; label: string }[] = [
  { value: 'install', label: 'Install — hidden before start, stays after finish' },
  { value: 'remove', label: 'Remove — visible before start, hidden after finish' },
  { value: 'maintain', label: 'Maintain — always visible' },
];

/** The section header's "New profile" button asks the panel (mounted once the section is open) to start a new profile. */
export const useAppearanceUiStore = create<{ newRequested: boolean; requestNew: () => void; clearNew: () => void }>((set) => ({
  newRequested: false,
  requestNew: () => set({ newRequested: true }),
  clearNew: () => set({ newRequested: false }),
}));

export function AppearancePanel() {
  const profiles = useAppearanceStore((s) => s.profiles);
  const add = useAppearanceStore((s) => s.add);
  const update = useAppearanceStore((s) => s.update);
  const remove = useAppearanceStore((s) => s.remove);
  const replaceAll = useAppearanceStore((s) => s.replaceAll);
  const [editing, setEditing] = useState<AppearanceProfile | null>(null);
  const newRequested = useAppearanceUiStore((st) => st.newRequested);
  useEffect(() => {
    if (!newRequested) return;
    useAppearanceUiStore.getState().clearNew();
    setEditing(emptyAppearanceProfile());
  }, [newRequested]);
  // Drag a row onto another: it goes before or after it (the line shows which), as in the Link Groups table.
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const moveProfile = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const moving = profiles.find((x) => x.id === id);
    if (!moving) return;
    const rest = profiles.filter((x) => x.id !== id);
    const at = rest.findIndex((x) => x.id === target) + (after ? 1 : 0);
    replaceAll([...rest.slice(0, at), moving, ...rest.slice(at)]);
  };
  /** A copy right under the original, to change from there. */
  const duplicate = (p: AppearanceProfile) => {
    const i = profiles.findIndex((x) => x.id === p.id);
    const copy: AppearanceProfile = { ...structuredClone(p), id: newAppearanceId(), name: `${p.name} (copy)` };
    replaceAll([...profiles.slice(0, i + 1), copy, ...profiles.slice(i + 1)]);
  };

  if (editing) {
    return (
      <ProfileEditor
        profile={editing}
        onCancel={() => setEditing(null)}
        onDelete={
          profiles.some((x) => x.id === editing.id)
            ? () => {
                if (!window.confirm(`Delete the appearance profile "${editing.name}"?`)) return;
                remove(editing.id);
                setEditing(null);
              }
            : undefined
        }
        onSave={(p) => {
          if (profiles.some((x) => x.id === p.id)) update(p);
          else add(p);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div>
      {profiles.length === 0 && (
        <div style={{ padding: '8px', color: 'var(--text-dim)' }}>
          No profiles yet. A profile sets Start / Active / End colors and opacity for 4D playback, then gets attached to a Link Group.
        </div>
      )}
      {profiles.length > 0 && (
        <table className="seq-grid">
          <thead>
            <tr>
              <th className="seq-grid__stages" title="Start, Active start, Active finish, End">Stages</th>
              <th>Name</th>
              <th>Action</th>
              <th className="seq-grid__actions" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr
                key={p.id}
                className={[dragId === p.id ? 'is-dragging' : '', drop?.id === p.id && dragId !== p.id ? (drop.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ') || undefined}
                draggable
                onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > rect.top + rect.height / 2;
                  if (drop?.id !== p.id || drop.after !== after) setDrop({ id: p.id, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && drop) moveProfile(dragId, drop.id, drop.after);
                  setDragId(null);
                  setDrop(null);
                }}
                onDragEnd={() => { setDragId(null); setDrop(null); }}
                title="Drag to reorder"
              >
                <td className="seq-grid__stages">
                  {[p.startColor, p.activeStart, p.activeFinish, p.endColor].map((s, i) => (
                    <span
                      key={i}
                      className="seq-grid__dot"
                      title={['Start', 'Active start', 'Active finish', 'End'][i]}
                      style={{ background: s.color ?? 'repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%)' }}
                    />
                  ))}
                </td>
                <td className="seq-grid__name" title={p.name} onClick={() => setEditing(p)}>{p.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{p.action}</td>
                <td className="seq-grid__actions">
                  <button type="button" title={p.hideInKey ? 'Not in the key on the viewer: click to show it' : 'In the key on the viewer: click to hide it'} aria-label={p.hideInKey ? 'Show in the key' : 'Hide from the key'} aria-pressed={!p.hideInKey} style={p.hideInKey ? { opacity: 0.45 } : undefined} onClick={() => update({ ...p, hideInKey: !p.hideInKey })}>{p.hideInKey ? <IconEyeOff /> : <IconEye />}</button>
                  <button type="button" title="Edit" aria-label="Edit" onClick={() => setEditing(p)}><IconPencil /></button>
                  <button type="button" title="Duplicate" aria-label="Duplicate" onClick={() => duplicate(p)}><IconCopy /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** One row of the stages table: colour (unchecked = the object's own), opacity in % (blank = its own), surface. */
function StageRow({ label, stage, onChange }: { label: string; stage: AppearanceStage; onChange: (s: AppearanceStage) => void }) {
  return (
    <tr>
      <td style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{label}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" aria-label={`${label} colour`} checked={stage.color !== null} onChange={(e) => onChange({ ...stage, color: e.target.checked ? '#7c5cff' : null })} />
          <HexColorInput value={stage.color ?? '#7c5cff'} disabled={stage.color === null} onChange={(hex) => onChange({ ...stage, color: hex })} />
        </div>
      </td>
      <td>
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          placeholder="own"
          aria-label={`${label} opacity, percent`}
          title="Opacity 0 to 100 %; blank = the object's own"
          value={stage.opacity === null ? '' : Math.round(stage.opacity * 100)}
          onChange={(e) => onChange({ ...stage, opacity: e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
          style={{ width: 60 }}
        />
      </td>
      <td>
        <select value={stage.surface ?? ''} onChange={(e) => onChange({ ...stage, surface: (e.target.value || undefined) as MaterialClass | undefined })} title="Surface: draw the object as brick, rebar mesh, glass... instead of a flat colour" aria-label={`${label} surface`} style={{ width: '100%' }}>
          <option value="">Flat colour</option>
          {MATERIAL_CLASSES.map((c) => <option key={c} value={c}>{MATERIAL_CLASS_LABELS[c]}</option>)}
        </select>
      </td>
    </tr>
  );
}

function ProfileEditor({ profile, onSave, onCancel, onDelete }: { profile: AppearanceProfile; onSave: (p: AppearanceProfile) => void; onCancel: () => void; onDelete?: () => void }) {
  const [p, setP] = useState<AppearanceProfile>(profile);

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Profile name" style={{ flex: 1 }} />
      </div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>Action</div>
        <select value={p.action} onChange={(e) => setP({ ...p, action: e.target.value as AppearanceAction })} style={{ width: '100%' }}>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <h3 style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Appearance</h3>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 6 }}>Unchecked colour / blank opacity = the object's own. Active start/finish interpolate across the activity's duration.</div>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
        <thead>
          <tr style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'left' }}>
            <th style={{ fontWeight: 500 }}>Stage</th>
            <th style={{ fontWeight: 500 }}>Colour</th>
            <th style={{ fontWeight: 500 }}>Opacity %</th>
            <th style={{ fontWeight: 500 }}>Surface</th>
          </tr>
        </thead>
        <tbody>
          <StageRow label="Start" stage={p.startColor} onChange={(s) => setP({ ...p, startColor: s })} />
          <StageRow label="Active start" stage={p.activeStart} onChange={(s) => setP({ ...p, activeStart: s })} />
          <StageRow label="Active finish" stage={p.activeFinish} onChange={(s) => setP({ ...p, activeFinish: s })} />
          <StageRow label="End" stage={p.endColor} onChange={(s) => setP({ ...p, endColor: s })} />
        </tbody>
      </table>

      <h3 style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginTop: 12 }}>Growth simulation</h3>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 6 }}>
        Follows the task's own time: a dropped object hangs above its place from the task's start and lands at its finish; a lifted one leaves by its finish; bottom to top grows with the task. Finer Steps (e.g. hourly) or more frames per step give a smoother movement.
      </div>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Arrival</span>
        <select value={p.growthIn ?? 'none'} onChange={(e) => setP({ ...p, growthIn: e.target.value as GrowthIn })} style={{ width: '100%' }} disabled={p.action === 'remove'}>
          {GROWTH_IN.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Removal</span>
        <select value={p.growthOut ?? 'none'} onChange={(e) => setP({ ...p, growthOut: e.target.value as GrowthOut })} style={{ width: '100%' }} disabled={p.action !== 'remove'}>
          {GROWTH_OUT.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </label>
      {p.growthIn === 'custom' && p.action !== 'remove' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }} title="Direction the object grows along, in project axes: X east, Y north, Z up. It is normalised, so only the proportions matter.">
          <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>Direction vector (X, Y, Z)</span>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <input
              key={axis}
              type="number"
              step={0.1}
              aria-label={`Direction ${axis.toUpperCase()}`}
              value={(p.growthVector ?? DEFAULT_GROWTH_VECTOR)[axis]}
              onChange={(e) => setP({ ...p, growthVector: { ...(p.growthVector ?? DEFAULT_GROWTH_VECTOR), [axis]: Number(e.target.value) || 0 } })}
              style={{ width: 52 }}
            />
          ))}
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>Distance (m) — drop / slide / lift</span>
        <input type="number" min={0.5} step={0.5} value={p.growthDistance ?? DEFAULT_GROWTH_DISTANCE} onChange={(e) => setP({ ...p, growthDistance: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 70 }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }} title="The movement plays over this many hours before the task's finish, landing at the finish; blank = across the whole task.">
        <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>Duration (h) before finish — blank = whole task</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={p.growthHours ?? ''}
          onChange={(e) => setP({ ...p, growthHours: e.target.value === '' ? null : Math.max(0.5, Number(e.target.value) || 0.5) })}
          style={{ width: 70 }}
        />
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }} title="Edge lines on the object while it grows or moves in. Once it is built it shows edges like the rest of the model. Off by default for a growth over the task, where they look messy on the cut. With it off the object is solid and hides the edges behind it.">
        <input
          type="checkbox"
          checked={p.growthEdges ?? !GROWS_OVER_TASK.includes(p.growthIn ?? 'none')}
          onChange={(e) => setP({ ...p, growthEdges: e.target.checked })}
        />
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Show edges while it grows / moves in</span>
      </label>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button className="btn primary" onClick={() => onSave(p)} disabled={!p.name.trim()}>
          Save
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button className="btn btn--danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
