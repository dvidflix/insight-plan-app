import { useEffect, useState, type ReactNode } from 'react';
import { usePersistedState } from '../../utils/persistedState';
import { IconChevronDown, IconDownload } from '../icons';

export interface ExplorerPanelDef {
  id: string;
  title: string;
  render: () => ReactNode;
  /** Shows an Export button on the panel when given. */
  onExport?: () => void;
}

const DEFAULT_VISIBLE = ['activities', 'gantt'];

/** Several workspaces stacked on one page. The Views menu shows/hides each
    panel; a panel can also be maximised to fill the window, closed, or
    resized vertically by dragging its bottom edge. */
export function ExplorerView({ panels }: { panels: ExplorerPanelDef[] }) {
  const [visible, setVisible] = usePersistedState<string[]>('schedule.explorerPanels', DEFAULT_VISIBLE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [maximised, setMaximised] = useState<string | null>(null);

  useEffect(() => {
    if (!maximised) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximised(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximised]);

  const toggle = (id: string) => setVisible((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  // Keep the canonical panel order however the user toggled them on.
  const shown = panels.filter((p) => visible.includes(p.id));

  return (
    <div className="explorer">
      <div className="explorer__bar">
        <div className="explorer__views">
          <button type="button" className="btn btn--small" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} title="Show or hide any of the Schedule Explorer panels">
            Views <IconChevronDown />
          </button>
          {menuOpen && (
            <>
              <div className="check-pop-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="explorer__menu" role="menu">
                {panels.map((p) => (
                  <button key={p.id} type="button" role="menuitemcheckbox" aria-checked={visible.includes(p.id)} className={visible.includes(p.id) ? 'active' : ''} onClick={() => toggle(p.id)}>
                    <span className="explorer__tick">{visible.includes(p.id) ? '✓' : ''}</span>
                    {p.title}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {shown.length === 0 && <div className="report-empty">No panels shown — turn some on from the Views menu.</div>}

      {shown.map((p) => (
        <section key={p.id} className={`explorer-panel${maximised === p.id ? ' explorer-panel--max' : ''}`}>
          <header className="explorer-panel__header">
            <span className="explorer-panel__title">{p.title}</span>
            <div className="explorer-panel__actions">
              {p.onExport && (
                <button type="button" className="btn btn--small" onClick={p.onExport} title="Export">
                  <IconDownload /> Export
                </button>
              )}
              <button type="button" className="btn btn--small" onClick={() => setMaximised((m) => (m === p.id ? null : p.id))} title={maximised === p.id ? 'Exit full screen (Esc)' : 'Full screen'}>
                {maximised === p.id ? '⤡' : '⤢'}
              </button>
              <button type="button" className="btn btn--small" onClick={() => { toggle(p.id); if (maximised === p.id) setMaximised(null); }} title="Close panel">✕</button>
            </div>
          </header>
          <div className="explorer-panel__body">{p.render()}</div>
        </section>
      ))}
    </div>
  );
}
