import { FEATURES } from '../features';
import { blockedWindows, openBlockedWindows, useWorkspaces, workspaceActions } from '../state/workspaces';
import { UpdateChip } from './UpdateChip';
import { IconClose, IconLaunch } from './icons';

/** The workspaces (Inputs, Custom, ...), in the view picker's menu: a workspace keeps how the app is set up, exactly, and follows what
    you change in it (state/workspaces.ts). Also the new window, the windows the browser blocked, and the update. There is no bar along the top. */
export function WorkspaceMenu({ onNewWindow, close, readOnly = false }: { /** Opens the programme view in a window of its own. */ onNewWindow: () => void; close: () => void; /** A second window: it shows the workspaces, and they are changed in the main window. */ readOnly?: boolean }) {
  const list = useWorkspaces();
  const blocked = blockedWindows().length;

  return (
    <div className="ws-page__col ws-ws">
      <div className="ws-page__group">
        <div className="ws-page__head">Workspaces</div>
        {list?.items.map((w) => (
          <div key={w.id} className={`ws-ws__row${w.id === list.activeId ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={w.id === list.activeId}
              className="ws-ws__name"
              disabled={readOnly}
              onClick={() => { close(); void workspaceActions.switchTo(w.id); }}
              onDoubleClick={() => {
                if (w.fixed) return;
                const name = window.prompt('Name of the workspace:', w.name);
                if (name) workspaceActions.rename(w.id, name);
              }}
              title={w.fixed ? `${w.name}: the workspace for loading models and programmes` : `${w.name}: it keeps the page, panels and second windows exactly as you set them. Double-click to rename.`}
            >
              {w.name}
              {w.windows.length > 0 && <span className="ws-tab__windows" title={`${w.windows.length} second window${w.windows.length === 1 ? '' : 's'} open with this workspace`}>{w.windows.length}</span>}
            </button>
            {!w.fixed && !readOnly && (
              <button
                type="button"
                className="ws-ws__close"
                aria-label={`Delete the workspace ${w.name}`}
                title={`Delete the workspace ${w.name}`}
                onClick={() => { if (window.confirm(`Delete the workspace "${w.name}"?\n\nIts layout is lost; programmes and models are not touched.`)) void workspaceActions.remove(w.id); }}
              >
                <IconClose width={12} height={12} />
              </button>
            )}
          </div>
        ))}
        {readOnly && <div className="scn-dim" style={{ padding: '4px 10px', fontSize: 11 }}>Change the workspace in the main window.</div>}
        {!readOnly && <button
          type="button"
          className="ws-ws__add"
          title="New workspace: a copy of how the app is set up now"
          onClick={() => {
            const name = window.prompt('Name of the new workspace:', 'Workspace');
            if (name) { close(); void workspaceActions.add(name); }
          }}
        >
          + New workspace
        </button>}
        {!readOnly && <div className="ws-page__sub"><span>Windows</span></div>}
        {!readOnly && <button type="button" className="ws-ws__add" onClick={() => { close(); onNewWindow(); }} title="New window: this programme view in a window of its own (e.g. on a second screen). The windows stay in step: edits, the activity picked, the 4D date">
          <IconLaunch width={14} height={14} /> New window
        </button>}
        {!readOnly && blocked > 0 && (
          <button type="button" className="ws-ws__add ws-ws__warn" onClick={() => { close(); openBlockedWindows(); }} title="The browser blocked the second windows of this workspace: click to open them where you left them">
            <IconLaunch width={14} height={14} /> Open {blocked} window{blocked === 1 ? '' : 's'}
          </button>
        )}
        {!readOnly && FEATURES.selfUpdate && <div className="ws-ws__update"><UpdateChip /></div>}
      </div>
    </div>
  );
}
