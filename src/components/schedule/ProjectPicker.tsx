import { useEffect, useMemo, useState } from 'react';
import type { XerProjectInfo } from '../../schedule/importSchedule';
import { queryMatcher } from '../../schedule/search';

/** Past this many activities a load gets slow and memory-hungry (a whole
    300 MB export is ~220k) — allowed, but flagged. */
const LARGE_SELECTION = 60_000;

interface ProjectPickerProps {
  fileName: string;
  projects: XerProjectInfo[];
  onLoad: (projectIds: string[]) => void;
  onCancel: () => void;
}

/** Chooses which projects of a multi-project .xer to load. The chosen
    projects load as one programme, so relationships between them are kept. */
export function ProjectPicker({ fileName, projects, onLoad, onCancel }: ProjectPickerProps) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sorted = useMemo(() => [...projects].sort((a, b) => a.shortName.localeCompare(b.shortName)), [projects]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = queryMatcher(query);
    return q ? sorted.filter((p) => hit(`${p.shortName} ${p.name}`)) : sorted;
  }, [sorted, query]);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleChosen = visible.length > 0 && visible.every((p) => chosen.has(p.id));
  const toggleVisible = () =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (allVisibleChosen) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });

  const activityTotal = projects.reduce((sum, p) => sum + (chosen.has(p.id) ? p.activityCount : 0), 0);

  return (
    <div className="project-picker__backdrop">
      <div className="project-picker" role="dialog" aria-modal="true" aria-labelledby="project-picker-title">
        <div className="project-picker__header">
          <h3 id="project-picker-title">Choose projects</h3>
          <div className="project-picker__sub">
            {fileName} has {projects.length} projects. Projects loaded together keep the links between them.
          </div>
          <input
            className="project-picker__search"
            type="search"
            placeholder="Filter by ID or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <label className="project-picker__row project-picker__row--all">
          <input type="checkbox" checked={allVisibleChosen} onChange={toggleVisible} disabled={visible.length === 0} />
          <span>{query ? `All ${visible.length} matching` : 'All projects'}</span>
        </label>
        <div className="project-picker__list">
          {visible.map((p) => (
            <label key={p.id} className="project-picker__row">
              <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="project-picker__names">
                <span className="project-picker__id">{p.shortName}</span>
                {p.name && <span className="project-picker__name">{p.name}</span>}
              </span>
              <span className="project-picker__count">{p.activityCount.toLocaleString()}</span>
            </label>
          ))}
          {visible.length === 0 && <div className="project-picker__empty">No project matches “{query}”.</div>}
        </div>
        <div className="project-picker__footer">
          <span className={activityTotal > LARGE_SELECTION ? 'project-picker__total project-picker__total--warn' : 'project-picker__total'}>
            {chosen.size === 0
              ? 'No projects selected'
              : `${chosen.size} project${chosen.size === 1 ? '' : 's'} · ${activityTotal.toLocaleString()} activities`}
            {activityTotal > LARGE_SELECTION && ' — large selection, loading may be slow'}
          </span>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={chosen.size === 0} onClick={() => onLoad([...chosen])}>
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
