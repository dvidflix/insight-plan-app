import { useState } from 'react';
import { queryMatcher } from '../schedule/search';
import { useModelsStore } from '../state/modelsStore';
import { useModelEdgesStore } from '../state/modelEdgesStore';
import { IconEye, IconEyeOff, IconSectionChevron } from './icons';

/** The loaded models with an eye each (the same on / off as the Inputs list). Click a name to select it,
    Shift+click (or Shift+arrows) to reach down to another, Ctrl+click to add or remove one; Space turns
    the selected models on or off. */
export function ModelsList() {
  const allModels = useModelsStore((s) => s.models);
  const hidden = useModelsStore((s) => s.hiddenModelIds);
  const toggleHidden = useModelsStore((s) => s.toggleModelHidden);
  const edgesOff = useModelEdgesStore((s) => s.off);
  const toggleEdges = useModelEdgesStore((s) => s.toggle);
  const [open, setOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  // The models listed (the search keeps some): ranges and arrows go through these.
  const hit = queryMatcher(query);
  const models = query.trim() ? allModels.filter((m) => hit(m.name)) : allModels;

  const pick = (id: string, mod: { shift?: boolean; ctrl?: boolean } = {}) => {
    setActiveId(id);
    const from = models.findIndex((m) => m.modelId === anchorId);
    const to = models.findIndex((m) => m.modelId === id);
    if (mod.shift && from >= 0 && to >= 0) {
      const range = models.slice(Math.min(from, to), Math.max(from, to) + 1).map((m) => m.modelId);
      setSelected(new Set(mod.ctrl ? [...selected, ...range] : range));
      return;
    }
    setAnchorId(id);
    if (mod.ctrl) {
      const next = new Set(selected);
      if (!next.delete(id)) next.add(id);
      setSelected(next);
    } else setSelected(new Set([id]));
  };
  /** Off if any of the models is on, otherwise all come back. */
  const flip = (ids: string[]) => {
    const anyShown = ids.some((id) => !hidden.has(id));
    for (const id of ids) if (hidden.has(id) === !anyShown) toggleHidden(id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    if (e.key === ' ') {
      const ids = selected.size ? [...selected] : activeId ? [activeId] : [];
      flip(ids.filter((id) => models.some((m) => m.modelId === id)));
      return;
    }
    if (!models.length) return;
    const i = models.findIndex((m) => m.modelId === activeId);
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : models.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= models.length) return;
    pick(models[next].modelId, { shift: e.shiftKey });
    document.getElementById(`models-row-${models[next].modelId}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    // (A button would also "click" on Space's release: kept from doing so.)
    <div className="flt ss models-list" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === ' ' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault(); }} style={{ outline: 'none' }} aria-label="Models: arrow keys move, Shift or Ctrl select several, Space turns the selected on or off">
      <div className="cols__group">
        <div className="cols__group-head">
          <button type="button" className="cols__group-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <IconSectionChevron className="section-chevron" />
            <span className="cols__group-name">Models</span>
            <span className="cols__count">{models.length}</span>
          </button>
        </div>
        {open && allModels.length > 0 && <input className="cols__search" type="search" placeholder="Search models…" value={query} onChange={(e) => setQuery(e.target.value)} />}
        {open && allModels.length === 0 && <div className="cols__empty">No models loaded.</div>}
        {open && allModels.length > 0 && models.length === 0 && <div className="flt__hint">No model matches “{query}”.</div>}
        {open && models.length > 0 && (
          <div className="ss__table">
            {models.map((m) => {
              const off = hidden.has(m.modelId);
              return (
                <div
                  key={m.modelId}
                  id={`models-row-${m.modelId}`}
                  className={`ss__row${selected.has(m.modelId) ? ' is-active' : ''}${activeId === m.modelId ? ' is-current' : ''}`}
                  style={off ? { opacity: 0.5 } : undefined}
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('button.ss__eye, button.ss__edges')) pick(m.modelId, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }); }}
                >
                  <span className="ss__name" style={{ flex: 1, minWidth: 0 }} title={m.name}><span className="ss__label">{m.name}</span></span>
                  <button
                    type="button"
                    className={`ss__eye ss__edges${edgesOff[m.name] ? ' is-off' : ''}`}
                    onClick={() => toggleEdges(m.name)}
                    title={edgesOff[m.name] ? 'Edge lines are off for this model: turn them on' : 'Turn edge lines off for this model'}
                    aria-label={edgesOff[m.name] ? `Show edges on ${m.name}` : `Hide edges on ${m.name}`}
                    aria-pressed={!edgesOff[m.name]}
                    style={{ fontSize: 11, fontWeight: 600, width: 'auto', padding: '0 5px' }}
                  >
                    Edges
                  </button>
                  <button
                    type="button"
                    className={`ss__eye${off ? ' is-off' : ''}`}
                    onClick={() => flip([m.modelId])}
                    title={off ? 'Show this model' : 'Hide this model'}
                    aria-label={off ? `Show ${m.name}` : `Hide ${m.name}`}
                  >
                    {off ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
