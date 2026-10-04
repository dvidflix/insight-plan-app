import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NO_FOLDER, useInputFoldersStore } from '../state/inputFoldersStore';
import { IconChevronDown, IconChevronRight, IconFolder, IconPencil } from './icons';

const DRAG_TYPE = 'application/x-ip-input-item';

/** Props for a table row that can be dragged onto a folder header. */
export function dragItemProps(name: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, name);
      e.dataTransfer.effectAllowed = 'move';
    },
  };
}

/** "+ New folder" for the toolbar above a list. */
export function NewFolderButton() {
  const addFolder = useInputFoldersStore((s) => s.addFolder);
  return (
    <button
      type="button"
      className="mini-btn"
      onClick={() => {
        const name = window.prompt('Folder name (for example a building):');
        if (name !== null && !addFolder(name)) window.alert('Give the folder a name that is not used yet.');
      }}
    >
      + New folder
    </button>
  );
}

/** The folder button of a row: a small menu to put the item in a folder. */
export function FolderMenuButton({ name }: { name: string }) {
  const folders = useInputFoldersStore((s) => s.folders);
  const current = useInputFoldersStore((s) => s.assign[name]);
  const moveItem = useInputFoldersStore((s) => s.moveItem);
  const addFolder = useInputFoldersStore((s) => s.addFolder);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const pick = (folder: string | null) => {
    moveItem(name, folder);
    setPos(null);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="mini-btn mini-btn--icon"
        title={current ? `In folder “${current}” — move to…` : 'Move to a folder…'}
        aria-label="Move to a folder"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos(pos ? null : { x: Math.max(8, r.right - 180), y: r.bottom + 4 });
        }}
      >
        <IconFolder width={16} height={16} />
      </button>
      {pos &&
        createPortal(
          <div className="folder-menu" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
            {folders.map((f) => (
              <button key={f} type="button" className={f === current ? 'on' : ''} onClick={() => pick(f)}>{f}</button>
            ))}
            {current && <button type="button" onClick={() => pick(null)}>No folder</button>}
            <button
              type="button"
              className="folder-menu__new"
              onClick={() => {
                const n = window.prompt('New folder name:');
                if (n === null) return setPos(null);
                if (addFolder(n)) pick(n.trim());
                else window.alert('Give the folder a name that is not used yet.');
              }}
            >
              + New folder…
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A folder's header row in a list: collapse, rename, delete; drop items on it. */
export function FolderHeaderRow({ folder, count, colSpan }: { folder: string; count: number; colSpan: number; children?: ReactNode }) {
  const collapsed = useInputFoldersStore((s) => s.collapsed.includes(folder));
  const toggle = useInputFoldersStore((s) => s.toggleCollapsed);
  const moveItem = useInputFoldersStore((s) => s.moveItem);
  const renameFolder = useInputFoldersStore((s) => s.renameFolder);
  const removeFolder = useInputFoldersStore((s) => s.removeFolder);
  const [over, setOver] = useState(false);
  const none = folder === NO_FOLDER;
  return (
    <tr
      className={`inputs-folder${over ? ' inputs-folder--over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const item = e.dataTransfer.getData(DRAG_TYPE);
        if (item) moveItem(item, none ? null : folder);
      }}
    >
      <td colSpan={colSpan}>
        <div className="inputs-folder__bar">
          <button type="button" className="inputs-folder__toggle" onClick={() => toggle(folder)} aria-expanded={!collapsed}>
            {collapsed ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
            {!none && <IconFolder width={16} height={16} />}
            <b>{none ? 'No folder' : folder}</b>
            <span className="inputs-folder__count">{count}</span>
          </button>
          {!none && (
            <span className="inputs-folder__actions">
              <button
                type="button"
                className="mini-btn mini-btn--icon"
                title="Rename folder"
                aria-label="Rename folder"
                onClick={() => {
                  const n = window.prompt('Rename the folder:', folder);
                  if (n !== null && n.trim() !== folder && !renameFolder(folder, n)) window.alert('Give the folder a name that is not used yet.');
                }}
              >
                <IconPencil width={14} height={14} />
              </button>
              <button
                type="button"
                className="mini-btn danger"
                title="Delete folder (its items go back to “No folder”)"
                aria-label="Delete folder"
                onClick={() => {
                  if (window.confirm(`Delete the folder “${folder}”? Its ${count} item${count === 1 ? '' : 's'} stay loaded and go back to “No folder”.`)) removeFolder(folder);
                }}
              >
                ✕
              </button>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
