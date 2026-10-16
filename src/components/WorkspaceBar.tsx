import { useEffect, useRef, useState } from 'react';
import { FEATURES } from '../features';
import { blockedWindows, openBlockedWindows, useWorkspaces, workspaceActions, workspaceDirty } from '../state/workspaces';
import { UpdateChip } from './UpdateChip';
import { PackageUpdateChip } from './PackageUpdateChip';
import { IconAddCircleOutline, IconChevronDown, IconLaunch, IconRemove, IconScenes } from './icons';

/** The second button of the top bar: the workspace you are in (a dot when it has changes not saved) and a menu to switch, add, save and
    choose the one the app starts with. */
export function WorkspaceButton({ readOnly = false }: { readOnly?: boolean }) {
  const list = useWorkspaces();
  const dirty = workspaceDirty();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = list?.items.find((w) => w.id === list.activeId);
  if (!list) return null;
  return (
    <div className="ws-page" ref={root}>
      <button type="button" className={`ws-page__btn ws-top__btn${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Workspaces" title={`Workspace: ${active?.name ?? ''}. The page, panels and second windows as you saved them`}>
        <IconScenes width={16} height={16} />
        <span className="ws-page__name">{active?.name ?? 'Workspace'}{dirty && <span className="ws-ws__dirty" title="Changes not saved yet"> ●</span>}</span>
        <IconChevronDown width={12} height={12} />
      </button>
      {open && (
        <div className="ws-page__menu" role="menu" style={{ minWidth: 260 }}>
          <WorkspaceMenu close={() => setOpen(false)} readOnly={readOnly} />
        </div>
      )}
    </div>
  );
}

/** The workspace chip of the status bar: the workspace you are in (a dot when it has changes not saved); a click opens the list above it. */
export function WorkspaceStatus({ readOnly = false }: { readOnly?: boolean }) {
  const list = useWorkspaces();
  const dirty = workspaceDirty();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!list) return null;
  const active = list.items.find((w) => w.id === list.activeId);
  return (
    <span className="ws-status" ref={root}>
      <button type="button" className={`ws-status__btn${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Workspaces" title="Workspaces: the page, panels and second windows you work with. Switch, add or save one.">
        <IconScenes width={14} height={14} />
        <span>{active?.name ?? 'Workspace'}{dirty && <span className="ws-ws__dirty" title="Changes not saved yet"> ●</span>}</span>
        <IconChevronDown width={10} height={10} style={{ transform: 'rotate(180deg)' }} />
      </button>
      {open && (
        <div className="ws-status__pop" role="menu">
          <WorkspaceMenu close={() => setOpen(false)} readOnly={readOnly} />
        </div>
      )}
    </span>
  );
}

export function WorkspaceMenu({ close, readOnly = false }: { close: () => void; /** A second window: it shows the workspaces, and they are changed in the main window. */ readOnly?: boolean }) {
  const list = useWorkspaces();
  const dirty = workspaceDirty();
  const active = list?.items.find((w) => w.id === list.activeId);

  const switchTo = (id: string) => {
    if (dirty && active && !window.confirm(`"${active.name}" has changes that are not saved.\n\nOK: leave them behind.\nCancel: stay in it (then Save workspace).`)) return;
    close();
    void workspaceActions.switchTo(id);
  };

  return (
    <div className="ws-ws" style={{ marginTop: 0, paddingTop: 0 }}>
      <div className="ws-page__group">
        <div className="ws-page__head ws-ws__head">
          <span>Workspaces</span>
          {!readOnly && (
            <button
              type="button"
              className="icon-btn ws-ws__new"
              aria-label="New workspace"
              title="New workspace: save how the app is now under a name"
              onClick={() => {
                const name = window.prompt('Name of the new workspace:', 'Workspace');
                if (name) { close(); void workspaceActions.add(name); }
              }}
            >
              <IconAddCircleOutline width={24} height={24} />
            </button>
          )}
        </div>
        {list?.items.map((w) => {
          const isActive = w.id === list.activeId;
          const isDefault = w.id === list.defaultId;
          return (
            <div key={w.id} className={`ws-ws__row${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="ws-ws__name"
                disabled={readOnly}
                onClick={() => switchTo(w.id)}
                onDoubleClick={() => {
                  if (w.fixed) return;
                  const name = window.prompt('Name of the workspace:', w.name);
                  if (name) workspaceActions.rename(w.id, name);
                }}
                title={w.fixed ? `${w.name}: the workspace for loading models and programmes` : `${w.name}: the page, panels and second windows as you saved them. Double-click to rename.`}
              >
                {w.name}
                {isActive && dirty && <span className="ws-ws__dirty" title="Changes not saved yet: Save workspace keeps them">●</span>}
                {w.windows.length > 0 && <span className="ws-tab__windows" title={`${w.windows.length} second window${w.windows.length === 1 ? '' : 's'} open with this workspace`}>{w.windows.length}</span>}
              </button>
              <button
                type="button"
                className={`ws-ws__star${isDefault ? ' is-on' : ''}`}
                disabled={readOnly}
                aria-pressed={isDefault}
                aria-label={isDefault ? `${w.name} is the workspace the app starts with` : `Start the app with ${w.name}`}
                title={isDefault ? 'The app starts with this workspace (click: start where it was left instead)' : 'Start the app with this workspace'}
                onClick={() => workspaceActions.setDefault(isDefault ? null : w.id)}
              >
                {isDefault ? '★' : '☆'}
              </button>
              {!w.fixed && !readOnly && (
                <button
                  type="button"
                  className="ws-ws__close"
                  aria-label={`Delete the workspace ${w.name}`}
                  title={`Delete the workspace ${w.name}`}
                  onClick={() => { if (window.confirm(`Delete the workspace "${w.name}"?\n\nIts layout is lost; programmes and models are not touched.`)) void workspaceActions.remove(w.id); }}
                >
                  <IconRemove width={16} height={16} />
                </button>
              )}
            </div>
          );
        })}
        {readOnly && <div className="scn-dim" style={{ padding: '4px 10px', fontSize: 11 }}>Change the workspace in the main window.</div>}
        {!readOnly && (
          <>
            <div className="ws-ws__saves">
            <button
              type="button"
              className={`ws-ws__add ws-ws__save${dirty ? ' is-dirty' : ''}`}
              disabled={!active || !dirty}
              title={`Keep how the app is now in "${active?.name ?? ''}": its page, panels, columns, filters, viewpoints and lists, and second windows`}
              onClick={() => void workspaceActions.save()}
            >
              {dirty ? 'Save changes to this workspace ●' : '✓ Workspace saved'}
            </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The bottom of the picker menu, always in view: new windows, the ones the browser blocked, and the update. */
export function WindowsFooter({ onNewWindow, close }: { onNewWindow: () => void; close: () => void }) {
  const blocked = blockedWindows().length;
  return (
    <div className="ws-foot">
        <button type="button" className="ws-ws__add" onClick={() => { close(); onNewWindow(); }} title="New window: this programme view in a window of its own (e.g. on a second screen). The windows stay in step: edits, the activity picked, the 4D date">
          <IconLaunch width={14} height={14} /> New window
        </button>
        {blocked > 0 && (
          <button type="button" className="ws-ws__add ws-ws__warn" onClick={() => { close(); openBlockedWindows(); }} title="The browser blocked the second windows of this workspace: click to open them where you left them">
            <IconLaunch width={14} height={14} /> Open {blocked} window{blocked === 1 ? '' : 's'}
          </button>
        )}
        {FEATURES.selfUpdate && <div className="ws-ws__update"><UpdateChip /></div>}
        {FEATURES.packageUpdate && <div className="ws-ws__update"><PackageUpdateChip /></div>}
    </div>
  );
}
