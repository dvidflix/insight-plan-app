import { FEATURES } from '../features';
import { blockedWindows, openBlockedWindows, useWorkspaces, workspaceActions, workspaceDirty } from '../state/workspaces';
import { UpdateChip } from './UpdateChip';
import { IconAddCircleOutline, IconLaunch, IconRemove } from './icons';

/** The workspaces (Inputs, Custom, ...), in the view picker's menu: a workspace keeps how the app is set up, exactly, when you save it
    (state/workspaces.ts). One of them can be the one the app starts with. Also the new window, the windows the browser blocked, and the
    update. There is no bar along the top. */
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
    <div className="ws-ws">
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
              <IconAddCircleOutline width={18} height={18} />
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
    </div>
  );
}
