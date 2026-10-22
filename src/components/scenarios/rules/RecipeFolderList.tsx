import { useState, type DragEvent } from 'react';
import type { Recipe } from '../../../prs/recipes';
import { foldersOf, moveRecipe, renameFolder } from '../../../prs/recipeFolders';
import { usePersistedState, usePersistedStringSet } from '../../../utils/persistedState';
import { IconChevronDown, IconChevronRight, IconFolderNew, IconRemove } from '../../icons';

/** The recipe list with folders. A folder is a group header (chevron, name, number of recipes); drag a recipe onto a folder to put it there, onto
    "Unfiled" to take it out, or onto another recipe to put it in front of that one (in that recipe's folder). Double-click a folder name to rename it.
    The folders a recipe is in are saved with the recipes; a folder with none in it is remembered here. */

export interface RecipeEntry {
  r: Recipe;
  i: number;
  count: number | null;
  chainText: string;
  undecided: boolean;
  on: boolean;
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function RecipeFolderList({ entries, recipes, onChange, onPick }: {
  /** The recipes to show (the search has already taken some out), with what the list shows of each. */
  entries: RecipeEntry[];
  /** Every recipe, in order: a move is made on these. */
  recipes: Recipe[];
  onChange: (next: Recipe[]) => void;
  onPick: (group: string) => void;
}) {
  const [empty, setEmpty] = usePersistedState<string[]>('recipes.folders', []);
  const [closed, setClosed] = usePersistedStringSet('recipes.foldersClosed');
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const folders = [...foldersOf(recipes), ...empty.filter((f) => !foldersOf(recipes).some((o) => same(o, f)))];
  const searching = entries.length !== recipes.length;
  const inFolder = (f: string) => entries.filter(({ r }) => same(r.folder ?? '', f) && (r.folder ?? '').trim() !== '');
  const unfiled = entries.filter(({ r }) => (r.folder ?? '').trim() === '');
  const total = (f: string) => recipes.filter((r) => same(r.folder ?? '', f) && (r.folder ?? '').trim() !== '').length;

  const addFolder = () => {
    const name = (window.prompt('Folder name') ?? '').trim();
    if (name && !folders.some((f) => same(f, name))) setEmpty([...empty, name]);
  };
  const rename = (f: string) => {
    const name = (window.prompt(`Rename the folder “${f}” to`, f) ?? '').trim();
    if (!name || same(name, f)) return;
    onChange(renameFolder(recipes, f, name));
    setEmpty(empty.map((e) => (same(e, f) ? name : e)));
    if (closed.has(f)) setClosed(new Set([...closed].map((c) => (c === f ? name : c))));
  };
  const remove = (f: string) => {
    if (!window.confirm(`Delete the folder “${f}”? Its ${total(f)} recipe${total(f) === 1 ? '' : 's'} stay, in no folder.`)) return;
    onChange(renameFolder(recipes, f, ''));
    setEmpty(empty.filter((e) => !same(e, f)));
  };
  const toggle = (f: string) => setClosed((c) => { const n = new Set(c); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  const dropOnFolder = (folder: string) => (e: DragEvent) => {
    e.preventDefault();
    if (drag !== null) onChange(moveRecipe(recipes, drag, folder));
    setDrag(null); setOver(null);
  };
  const folderOver = (key: string) => (e: DragEvent) => { if (drag === null) return; e.preventDefault(); if (over !== key) setOver(key); };

  const item = ({ r, i, count, chainText, undecided, on }: RecipeEntry) => (
    <button key={i} type="button" draggable className={`rec-list__item${on ? ' is-on' : ''}${r.enabled === false ? ' is-off' : ''}${over === `i${i}` && drag !== i ? ' is-drop' : ''}`}
      onClick={() => onPick(r.group)} title={undecided ? 'No days, formula, rate or crew yet: the default days are used. Drag to a folder to organise.' : 'Drag to a folder, or onto another recipe to put it before that one'}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); setDrag(i); }}
      onDragEnd={() => { setDrag(null); setOver(null); }}
      onDragOver={folderOver(`i${i}`)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag !== null) onChange(moveRecipe(recipes, drag, (recipes[i].folder ?? ''), i)); setDrag(null); setOver(null); }}>
      <span className="rec-list__name">{r.id}{count !== null && <span className="rec-list__count">{count.toLocaleString()}</span>}</span>
      <span className="rec-list__chain">{chainText}</span>
      {undecided && <span className="rec-list__flag">default days</span>}
    </button>
  );

  return (
    <>
      <div className="rec-list__bar">
        <button type="button" className="icon-btn" onClick={addFolder} aria-label="New folder" title="New folder: make one, then drag recipes into it"><IconFolderNew width={18} height={18} /></button>
        <span className="scn-dim">Drag recipes onto a folder</span>
      </div>
      {folders.map((f) => {
        const list = inFolder(f);
        if (searching && list.length === 0) return null;
        const shut = closed.has(f) && !searching;
        return (
          <div key={f} className="rec-list__group">
            <div className={`rec-list__folder${over === `f${f}` ? ' is-drop' : ''}`} onDragOver={folderOver(`f${f}`)} onDrop={dropOnFolder(f)}>
              <button type="button" className="rec-list__fold" aria-expanded={!shut} onClick={() => toggle(f)} onDoubleClick={() => rename(f)} title="Click to open or close the folder. Double-click to rename it">
                {shut ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}<strong>{f}</strong><span className="scn-dim">({total(f)})</span>
              </button>
              <button type="button" className="cols__icon cols__icon--remove" aria-label={`Delete the folder ${f}`} title="Delete the folder (its recipes stay, in no folder)" onClick={() => remove(f)}><IconRemove /></button>
            </div>
            {!shut && (list.length === 0 ? <div className="scn-dim rec-list__hint">{searching ? '' : 'Empty: drag recipes here'}</div> : list.map(item))}
          </div>
        );
      })}
      {folders.length > 0 && unfiled.length > 0 && (
        <div className={`rec-list__folder rec-list__folder--plain${over === 'f' ? ' is-drop' : ''}`} onDragOver={folderOver('f')} onDrop={dropOnFolder('')}>
          <span className="rec-list__fold"><strong>Unfiled</strong><span className="scn-dim">({unfiled.length})</span></span>
        </div>
      )}
      {unfiled.map(item)}
    </>
  );
}
