import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SCHEDULE_TABS, type TabId } from '../pages/SchedulePage';
import { useAppPrefsStore } from '../state/appPrefsStore';
import { useDockStore } from '../state/dockStore';
import { useModelsStore } from '../state/modelsStore';
import { useContextMeshStore } from '../state/contextMeshStore';
import { useScheduleStore } from '../state/scheduleStore';
import { toggleHidden, useProjectDbStore } from '../state/projectDbStore';
import { useTableSearchStore } from '../state/tableSearchStore';
import { activeTargetId, useListConfigStore } from '../state/listConfigStore';
import { activitySearchText, searchTokens } from '../schedule/search';
import { scenes } from '../state/scenes';
import { workspaces, workspaceActions } from '../state/workspaces';
import { openSatelliteWindow } from '../state/windowSync';
import { IS_SATELLITE } from '../state/satellite';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useStoredModels } from './StoredModelsPanel';
import type { PageItem } from './ViewPicker';
import { IconSearch } from './icons';

type Group = 'Table' | 'Scenes' | 'Files' | 'Activities' | 'Views' | 'Panels' | 'Actions';
const GROUPS: Group[] = ['Table', 'Actions', 'Scenes', 'Files', 'Activities', 'Views', 'Panels'];

interface Hit {
  key: string;
  group: Group;
  label: string;
  /** Beside the label, dimmed: what it is, or where it goes. */
  hint?: string;
  run: () => void;
}

/** The query as alternatives (split on commas, "||", semicolons and new lines), each a list of words (split on spaces). */
const alternatives = (query: string) => searchTokens(query).map((a) => a.split(/\s+/).filter(Boolean)).filter((a) => a.length);
/** One of the alternatives has every one of its words somewhere in the text. */
const matches = (text: string, alts: string[][]) => { const t = text.toLowerCase(); return alts.some((terms) => terms.every((x) => t.includes(x))); };

/** One search box for the whole app (Ctrl+K): scenes, files, views, panels and actions. Enter takes the first result; the arrows move.
    Its scope today is navigation; activities and model elements are searched in their own tables. */
export function GlobalSearch({ pages, onPage, onTab }: { pages: PageItem[]; onPage: (id: string) => void; onTab: (id: TabId) => void }) {
  const engine = useViewerEngine();
  const experimental = useAppPrefsStore((s) => s.experimental);
  const entries = useDockStore((s) => s.entries);
  const models = useModelsStore((s) => s.models);
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const toggleModelHidden = useModelsStore((s) => s.toggleModelHidden);
  const meshes = useContextMeshStore((s) => s.meshes);
  const schedules = useScheduleStore((s) => s.schedules);
  const hiddenScheduleIds = useScheduleStore((s) => s.hiddenScheduleIds);
  const toggleScheduleHidden = useScheduleStore((s) => s.toggleScheduleHidden);
  const dbProgrammes = useProjectDbStore((s) => s.programmes);
  const storedActions = useStoredModels();
  const [query, setQuery] = useState('');
  // The list the search box works on: the one that is active (Gantt, Data table ...), when it can take words.
  const activeList = useListConfigStore((s) => { const id = activeTargetId(s); return id ? s.targets[id] ?? null : null; });
  const tableAvailable = !!activeList?.searchable;
  const tableQuery = useTableSearchStore((t) => (activeList ? t.queries[activeList.id] ?? '' : ''));
  const listName = (activeList?.label ?? '').replace(/ (panel|page)$/i, '');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [sceneList, setSceneList] = useState(() => scenes.get());
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setSceneList(scenes.get());
    window.addEventListener('ip-scenes', refresh);
    return () => window.removeEventListener('ip-scenes', refresh);
  }, []);
  // Moving to another list: the box shows the words that list is narrowed to.
  const activeListId = activeList?.id ?? null;
  useEffect(() => { setQuery(useTableSearchStore.getState().queries[activeListId ?? ''] ?? ''); }, [activeListId]);
  // Ctrl+K from anywhere.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const all = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    const go = (page: string) => () => onPage(page);
    // Actions
    out.push({ key: 'a:home', group: 'Actions', label: 'Go to Home', hint: 'the scenes', run: go('home') });
    if (!IS_SATELLITE) {
      out.push({ key: 'a:scene', group: 'Actions', label: 'New scene', hint: 'a copy of this one', run: () => {
        const name = window.prompt('Name of the new scene (a copy of this one):', 'Scene')?.trim();
        if (name) void scenes.create(name, false).catch((e) => window.alert(e instanceof Error ? e.message : String(e)));
      } });
      out.push({ key: 'a:save', group: 'Actions', label: 'Save workspace', hint: workspaces.active()?.name, run: () => void workspaceActions.save() });
      out.push({ key: 'a:win', group: 'Actions', label: 'New window', hint: 'on a second screen', run: () => openSatelliteWindow('gantt') });
    }
    // Scenes
    if (!IS_SATELLITE) {
      for (const s of sceneList.scenes) {
        out.push({ key: `s:${s.id}`, group: 'Scenes', label: s.name, hint: s.id === sceneList.activeId ? 'you are in it' : 'open', run: () => {
          if (s.id === sceneList.activeId) { onPage('home'); return; }
          if (window.confirm(`Open the scene “${s.name}”?\n\nThe page reloads with its layout and lists (models loaded now are unloaded).`)) void scenes.activate(s.id).catch((e) => window.alert(e instanceof Error ? e.message : String(e)));
        } });
      }
    }
    // Files: a file that is off is loaded or shown; one that is on is taken to where it is used.
    const loadedNames = new Set(models.map((m) => m.name));
    for (const m of models) {
      const on = !hiddenModelIds.has(m.modelId);
      out.push({ key: `m:${m.modelId}`, group: 'Files', label: m.name, hint: on ? 'model · go to Models' : 'model · show', run: () => { if (on) onPage('model'); else toggleModelHidden(m.modelId); } });
    }
    for (const m of storedActions.stored.filter((x) => !loadedNames.has(x.name))) {
      out.push({ key: `st:${m.name}`, group: 'Files', label: m.name, hint: 'model · load', run: () => void storedActions.open(m) });
    }
    for (const c of meshes) {
      out.push({ key: `c:${c.id}`, group: 'Files', label: c.name, hint: c.hidden ? 'site context · show' : 'site context · hide', run: () => { useContextMeshStore.getState().toggleHidden(c.id); engine.contexts.setVisible(c.id, c.hidden); } });
    }
    for (const p of dbProgrammes) {
      out.push({ key: `p:${p.id}`, group: 'Files', label: p.name, hint: p.hidden ? 'programme · load' : 'programme · go to Gantt', run: () => { if (p.hidden) void toggleHidden(p); else { onTab('gantt'); onPage('schedule'); } } });
    }
    for (const s of schedules.filter((x) => x.dbProgrammeId === undefined)) {
      const on = !hiddenScheduleIds.has(s.id);
      out.push({ key: `p:${s.id}`, group: 'Files', label: s.sourceFileName, hint: on ? 'programme · go to Gantt' : 'programme · show', run: () => { if (on) { onTab('gantt'); onPage('schedule'); } else toggleScheduleHidden(s.id); } });
    }
    // Views
    for (const p of pages.filter((x) => x.id !== 'schedule' && x.id !== 'home' && x.id !== 'inputs')) out.push({ key: `pg:${p.id}`, group: 'Views', label: p.label, hint: 'page', run: go(p.id) });
    for (const v of SCHEDULE_TABS.filter((t) => !t.experimental || experimental[t.experimental])) {
      out.push({ key: `v:${v.id}`, group: 'Views', label: v.label, hint: 'view', run: () => { onTab(v.id); onPage('schedule'); } });
    }
    // Panels
    for (const e of Object.values(entries)) {
      if (e) out.push({ key: `pn:${e.id}`, group: 'Panels', label: e.label, hint: 'panel', run: () => useDockStore.getState().reveal(e.id) });
    }
    return out;
  }, [pages, onPage, onTab, experimental, entries, models, hiddenModelIds, toggleModelHidden, meshes, schedules, hiddenScheduleIds, toggleScheduleHidden, dbProgrammes, storedActions.stored, sceneList, engine]);

  const hits = useMemo(() => {
    const terms = alternatives(query);
    if (!terms.length) return [];
    const found = all.filter((h) => matches(h.label, terms));
    // On a table: the first row narrows the table to these words (any ID, name, code, user field or resource), as the old box did.
    if (tableAvailable) found.unshift({ key: 't:filter', group: 'Table', label: `Filter ${listName} by “${query.trim()}”`, hint: 'Enter', run: () => useTableSearchStore.getState().setListQuery(activeList!.id, query.trim()) });
    // Activities of the programmes that are shown: by ID, name, WBS, codes, user fields and resources. Only while typing, and the first 25.
    const shown = schedules.filter((m) => !hiddenScheduleIds.has(m.id));
    let more = 0;
    for (const m of shown) {
      for (const a of m.activities) {
        if (more >= 25) break;
        if (!matches(activitySearchText(a), terms)) continue;
        more++;
        found.push({
          key: `ac:${m.id}:${a.id}`,
          group: 'Activities',
          label: `${a.code}  ${a.name}`,
          hint: shown.length > 1 ? m.sourceFileName : a.wbsPath,
          run: () => {
            onTab('gantt');
            onPage('schedule');
            window.setTimeout(() => window.dispatchEvent(new CustomEvent('ip-goto-activity', { detail: { id: a.id, scheduleId: m.id } })), 300);
          },
        });
      }
    }
    // Names that start with the query first; then by group.
    const rank = (h: Hit) => (terms.some((t) => h.label.toLowerCase().startsWith(t[0])) ? 0 : 1);
    return found.sort((a, b) => (a.group === 'Table' ? -1 : b.group === 'Table' ? 1 : rank(a) - rank(b) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))).slice(0, 40);
  }, [all, query, schedules, hiddenScheduleIds, onTab, onPage, tableAvailable]);
  useEffect(() => { setAt(0); }, [query]);

  const choose = (h: Hit) => { setOpen(false); setQuery(''); input.current?.blur(); h.run(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); input.current?.blur(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); choose(hits[at]); }
  };

  let lastGroup: Group | null = null;
  const rows: ReactNode[] = [];
  hits.forEach((h, i) => {
    if (h.group !== lastGroup) { lastGroup = h.group; rows.push(<div key={`g:${h.group}`} className="gs__group">{h.group}</div>); }
    rows.push(
      <button key={h.key} type="button" role="option" aria-selected={i === at} className={`gs__hit${i === at ? ' is-at' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => choose(h)}>
        <span className="gs__label">{h.label}</span>
        {h.hint && <span className="gs__hint">{h.hint}</span>}
      </button>,
    );
  });

  return (
    <div className="gs" ref={root}>
      <IconSearch width={14} height={14} />
      <input
        ref={input}
        type="text"
        className="gs__input"
        placeholder={tableAvailable ? `Search on ${listName}` : 'Search…'}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (activeList?.searchable) useTableSearchStore.getState().setListQuery(activeList.id, e.target.value.trim()); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search scenes, files, views, panels and actions"
        aria-expanded={open && query.trim() !== ''}
        role="combobox"
        aria-controls="gs-list"
      />
      {tableQuery && tableQuery !== query.trim() && (
        <button type="button" className="gs__chip" onClick={() => activeList && useTableSearchStore.getState().setListQuery(activeList.id, '')} title={`${listName} is narrowed to these words. Click to show every row again`}>
          {tableQuery} ×
        </button>
      )}
      {open && query.trim() !== '' && (
        <div className="gs__list" id="gs-list" role="listbox">
          {hits.length === 0 ? <div className="gs__none">Nothing matches “{query}”.</div> : rows}
        </div>
      )}
    </div>
  );
}
