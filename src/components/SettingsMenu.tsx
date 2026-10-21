import { IS_SATELLITE } from '../state/satellite';
import { EXPERIMENTAL_FEATURES, useAppPrefsStore } from '../state/appPrefsStore';
import { type ReactNode, useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { CollapsibleSection } from './CollapsibleSection';
import { InfoTip } from './InfoTip';
import { ROW_SCALE_MAX, ROW_SCALE_MIN, useTableStyleStore } from '../state/tableStyleStore';
import { ImportExportPanel } from './ImportExportPanel';
import { FULL_SCREEN_KEY } from './FullScreenOnStart';
import { ACCENT_PALETTES, useAccentPaletteStore } from '../state/accentPaletteStore';
import { THEMES, useThemeStore, type ThemeChoice } from '../state/themeStore';
import { DEFAULT_SELECTION_COLOR, SELECTION_COLOR_KEY } from '../viewer/selectionColor';
import { useTimelineSettingsStore, MAX_TIMELINE_ZOOM } from '../state/timelineSettingsStore';
import { FileDetailsSync } from './InputDetails';
import { FEATURES } from '../features';
import { ProjectDbBar } from './ProjectDbPanel';
import { ExportFieldsPanel } from './ExportFieldsPanel';
import { SeaTablePanel } from './SeaTablePanel';

function usePersistedValue<T extends string | number>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return (typeof defaultValue === 'number' ? Number(stored) : stored) as T;
  });
  const set = (v: T) => {
    setValue(v);
    localStorage.setItem(key, String(v));
  };
  return [value, set];
}


/** Applies the saved viewer settings at startup — the Settings tab (which
    applies changes as they are made) is only mounted while it is open. */
/** Settings › Window › Show status bar (a "viewer." key, so the app
    configuration file carries it). Off hides the bottom status bar of the
    Models and Programmes pages; the 4D page's timeline bar always shows. */
const STATUS_BAR_KEY = 'viewer.statusBar';
/** The same choice for second windows (a window opened with New window or by a workspace). */
const STATUS_BAR_SECONDARY_KEY = 'viewer.statusBar.secondary';
const applyStatusBar = () => {
  const show = localStorage.getItem(IS_SATELLITE ? STATUS_BAR_SECONDARY_KEY : STATUS_BAR_KEY) !== 'false';
  document.body.classList.toggle('hide-statusbar', !show);
};

/** The cross at the right end of the status bar: hides it in this window (the main window and the second windows each have their own
    choice, which Settings turns back on). */
export function hideStatusBar() {
  try { localStorage.setItem(IS_SATELLITE ? STATUS_BAR_SECONDARY_KEY : STATUS_BAR_KEY, 'false'); } catch { /* not kept */ }
  applyStatusBar();
}

export function SettingsSync() {
  const engine = useViewerEngine();
  useEffect(() => {
    applyStatusBar();
    // A change made in another window (the main window's Settings can set the second windows' too).
    const onStorage = (e: StorageEvent) => { if (e.key === STATUS_BAR_KEY || e.key === STATUS_BAR_SECONDARY_KEY) applyStatusBar(); };
    window.addEventListener('storage', onStorage);
    const color = localStorage.getItem(SELECTION_COLOR_KEY) ?? DEFAULT_SELECTION_COLOR;
    void engine.ready.then(() => engine.setSelectionColor(color));
    return () => window.removeEventListener('storage', onStorage);
  }, [engine]);
  return null;
}

function Section({ title, defaultOpen, tip, children }: { title: string; defaultOpen: boolean; tip?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <CollapsibleSection title={title} open={open} onToggle={() => setOpen((v) => !v)} tip={tip}>{children}</CollapsibleSection>;
}

/** App-wide settings, the side pane's Settings tab: a "Preferences" section
    (the whole-app Configuration import/export), tables and window. How a 3D
    view looks (camera, style, edges, occlusion, anti-aliasing, background,
    grid) is a per-view setting — see View3DPanel (the "View settings" configuration). */

/** Settings › 4D timeline: how the 4D Sequencing timeline bar looks and plays. */
function TimelineSettings() {
  const t = useTimelineSettingsStore();
  const toggle = (label: string, on: boolean, set: (v: boolean) => void, tip?: string) => (
    <div className="disp__row">
      <span>
        {label}
        {tip && (
          <>
            {' '}
            <InfoTip>{tip}</InfoTip>
          </>
        )}
      </span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => set(!on)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
  return (
    <Section title="4D timeline" defaultOpen tip="How the timeline bar along the bottom of 4D Sequencing looks and plays. Saved with the app configuration.">
      <label className="settings-field">
        <span className="settings-field__label">Zoom: {t.zoom.toFixed(1)}×</span>
        <input type="range" min={1} max={MAX_TIMELINE_ZOOM} step={0.5} value={t.zoom} onChange={(e) => t.patch({ zoom: Number(e.target.value) })} style={{ width: '100%' }} />
      </label>
      {toggle('Follow the date while stepping', t.followPlayhead, (v) => t.patch({ followPlayhead: v }), 'When zoomed in, the bar scrolls left / right by itself as you play or step, keeping the current date in view.')}
      {toggle('Ctrl + wheel zooms the bar', t.wheelZoom, (v) => t.patch({ wheelZoom: v }))}
      <label className="settings-field">
        <span className="settings-field__label">Playback speed: {(1000 / t.stepIntervalMs).toFixed(1)} steps / s</span>
        <input type="range" min={100} max={2000} step={50} value={2100 - t.stepIntervalMs} onChange={(e) => t.patch({ stepIntervalMs: 2100 - Number(e.target.value) })} style={{ width: '100%' }} />
      </label>
      <div className="settings-field" title="Limit the timeline to these dates (inside the programme's own). Leave a date empty to use the programme's.">
        <span className="settings-field__label">Timeline limits</span>
        {([['limitStart', 'Start'], ['limitEnd', 'Finish']] as const).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ width: 44, fontSize: 12 }}>{label}</span>
            <input type="date" value={t[key] ?? ''} onChange={(e) => t.patch({ [key]: e.target.value || null })} style={{ flex: 1, minWidth: 0 }} />
            {t[key] && <button type="button" className="mini-btn" onClick={() => t.patch({ [key]: null })} title="Back to the programme's own date" aria-label={`Clear the ${label.toLowerCase()} limit`}>✕</button>}
          </label>
        ))}
      </div>
      {toggle('Show years', t.showYears, (v) => t.patch({ showYears: v }))}
      {toggle('Show months', t.showMonths, (v) => t.patch({ showMonths: v }), 'Monthly and Weekly stepping only.')}
      <label className="settings-field">
        <span className="settings-field__label">Month labels</span>
        <select value={t.monthLabels} onChange={(e) => t.patch({ monthLabels: e.target.value as 'names' | 'initials' })}>
          <option value="names">Names (Jan, Feb…) where there is room</option>
          <option value="initials">Initials (J, F…)</option>
        </select>
      </label>
      {toggle('Show week ticks', t.showWeekTicks, (v) => t.patch({ showWeekTicks: v }), 'Weekly stepping only.')}
      {toggle('Shade progress', t.showProgress, (v) => t.patch({ showProgress: v }))}
      {toggle('Line at the current date', t.showPlayhead, (v) => t.patch({ showPlayhead: v }))}
      <button className="btn" type="button" onClick={t.reset}>Reset the timeline settings</button>
    </Section>
  );
}

export function SettingsPanel({ timeline = false }: { timeline?: boolean; inputs?: boolean }) {
  const wrapHeaders = useTableStyleStore((s) => s.wrapHeaders);
  const setWrapHeaders = useTableStyleStore((s) => s.setWrapHeaders);
  const smoothScroll = useTableStyleStore((s) => s.smoothScroll);
  const setSmoothScroll = useTableStyleStore((s) => s.setSmoothScroll);
  const ctrlScroll = useTableStyleStore((s) => s.ctrlScrollFactor);
  const setCtrlScroll = useTableStyleStore((s) => s.setCtrlScrollFactor);
  const rowScale = useTableStyleStore((s) => s.rowScale);
  const setRowScale = useTableStyleStore((s) => s.setRowScale);
  const [fullScreen, setFullScreen] = usePersistedValue<string>(FULL_SCREEN_KEY, 'true');
  const [statusBar, setStatusBar] = usePersistedValue<string>(STATUS_BAR_KEY, 'true');
  const [statusBarSecondary, setStatusBarSecondary] = usePersistedValue<string>(STATUS_BAR_SECONDARY_KEY, 'true');
  useEffect(() => { applyStatusBar(); }, [statusBar, statusBarSecondary]);
  const theme = useThemeStore((s) => s.choice);
  const setTheme = useThemeStore((s) => s.setChoice);
  const accent = useAccentPaletteStore((s) => s.id);
  const setAccent = useAccentPaletteStore((s) => s.setId);
  const showTimelinesTab = useAppPrefsStore((s) => s.showTimelinesTab);
  const setShowTimelinesTab = useAppPrefsStore((s) => s.setShowTimelinesTab);
  const showWikiTab = useAppPrefsStore((s) => s.showWikiTab);
  const showHelpTab = useAppPrefsStore((s) => s.showHelpTab);
  const setShowHelpTab = useAppPrefsStore((s) => s.setShowHelpTab);
  const showExternalTab = useAppPrefsStore((s) => s.showExternalTab);
  const setShowExternalTab = useAppPrefsStore((s) => s.setShowExternalTab);
  const showDashboardsTab = useAppPrefsStore((s) => s.showDashboardsTab);
  const setShowDashboardsTab = useAppPrefsStore((s) => s.setShowDashboardsTab);
  const setShowWikiTab = useAppPrefsStore((s) => s.setShowWikiTab);
  const experimental = useAppPrefsStore((s) => s.experimental);
  const setExperimental = useAppPrefsStore((s) => s.setExperimental);
  return (
    <div className="settings-panel">
      <Section title="Import / Export" defaultOpen tip="Each kind of thing on its own, as a small file to keep or hand to a colleague. Importing adds what is new and replaces what has the same id; it never removes anything. Export all writes every file into the project folder at once.">
        <ImportExportPanel />
      </Section>

      {timeline && <TimelineSettings />}

      {/* The project folder and the file settings are always here: nothing sets `inputs` any more, so they were out of reach. */}
      {(
        <>
          {FEATURES.seatable && experimental.seatableFiles && <Section title="File details (SeaTable)" defaultOpen tip="The details of each file (discipline, building, status…) are filled in on SeaTable's Insight Plan Files table. Push sends the files of the Inputs page (name, type, format, size…): new ones are added, the others updated, and the details you filled in are not touched. Read brings the details back, to show as columns and to group and filter by.">
            <FileDetailsSync />
          </Section>}
          <Section title="Project database" defaultOpen tip="The project folder and its database (insight-plan.db): programmes in P6 tables, scenarios and settings. Open it in DBeaver or DB Browser for SQLite; edits made there come in with Reload.">
            <ProjectDbBar bare />
          </Section>
          <Section title="Exports (XML / XER)" defaultOpen={false} tip="Tick what goes into the XML and XER files you download (scenario programmes, and programmes from the Inputs list). Untick the user fields, resources and activity codes that are for your own use: they stay in the app but are left out of the files, with their values and assignments. The app-only Precast (m3) resource is left out unless you tick it.">
            <ExportFieldsPanel bare />
          </Section>
          {FEATURES.seatable && experimental.seatableModel && <Section title="SeaTable (model data)" defaultOpen={false} tip="Push sends the elements of the IFC classes you tick, with the properties the Properties table shows, to the Elements table of the SeaTable base, one row per element, by its GlobalId. Pull brings back every column you add to that table yourself (names without a dot) as Custom properties of the elements.">
            <SeaTablePanel bare />
          </Section>}
        </>
      )}

      <Section title="Window" defaultOpen tip="Browsers only allow full screen after a click or key press, so the app goes full screen on the first one. Esc (or F11) leaves it.">
        <div className="disp__row">
          <span>Full screen on start</span>
          <button type="button" role="switch" aria-checked={fullScreen !== 'false'} className={`switch${fullScreen !== 'false' ? ' on' : ''}`} onClick={() => setFullScreen(fullScreen === 'false' ? 'true' : 'false')}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>
            Status bar, main window{' '}
            <InfoTip>The bar along the bottom of every page (models loaded, active model, element and activity counts) in the main window. On 4D Sequencing it sits under the timeline, which always shows.</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={statusBar !== 'false'} className={`switch${statusBar !== 'false' ? ' on' : ''}`} onClick={() => setStatusBar(statusBar === 'false' ? 'true' : 'false')}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>
            Status bar, second windows{' '}
            <InfoTip>The same bar in the windows opened with New window or by a workspace (a second screen).</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={statusBarSecondary !== 'false'} className={`switch${statusBarSecondary !== 'false' ? ' on' : ''}`} onClick={() => setStatusBarSecondary(statusBarSecondary === 'false' ? 'true' : 'false')}>
            <span className="switch__thumb" />
          </button>
        </div>
        {FEATURES.teamPages && (
        <div className="disp__row">
          <span>Show Timelines tab</span>
          <button type="button" role="switch" aria-checked={showTimelinesTab} className={`switch${showTimelinesTab ? ' on' : ''}`} onClick={() => setShowTimelinesTab(!showTimelinesTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        )}
        {FEATURES.teamPages && (
        <div className="disp__row">
          <span>Show Wiki tab</span>
          <button type="button" role="switch" aria-checked={showWikiTab} className={`switch${showWikiTab ? ' on' : ''}`} onClick={() => setShowWikiTab(!showWikiTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        )}
        {FEATURES.help && (
        <div className="disp__row">
          <span>Show Help tab</span>
          <button type="button" role="switch" aria-checked={showHelpTab} className={`switch${showHelpTab ? ' on' : ''}`} onClick={() => setShowHelpTab(!showHelpTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        )}
        {FEATURES.externalPages && (
        <div className="disp__row">
          <span>Show External data tab <InfoTip>SeaTable in a frame, signed in for you.</InfoTip></span>
          <button type="button" role="switch" aria-checked={showExternalTab} className={`switch${showExternalTab ? ' on' : ''}`} onClick={() => setShowExternalTab(!showExternalTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        )}
        {FEATURES.externalPages && (
        <div className="disp__row">
          <span>Show Dashboards tab <InfoTip>Apache Superset in a frame, signed in for you.</InfoTip></span>
          <button type="button" role="switch" aria-checked={showDashboardsTab} className={`switch${showDashboardsTab ? ' on' : ''}`} onClick={() => setShowDashboardsTab(!showDashboardsTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        )}
      </Section>

      <Section title="Experimental features" defaultOpen tip="Features still being tried out. They are hidden until switched on here, and may change or be removed.">
        {EXPERIMENTAL_FEATURES.filter((f) => (f.id !== 'scenarios' || FEATURES.scenarios) && (!f.id.startsWith('seatable') || FEATURES.seatable)).map((f) => (
          <div key={f.id} className="disp__row">
            <span>
              {f.label}{' '}
              <InfoTip>{f.tip}</InfoTip>
            </span>
            <button type="button" role="switch" aria-checked={experimental[f.id]} className={`switch${experimental[f.id] ? ' on' : ''}`} onClick={() => setExperimental(f.id, !experimental[f.id])}>
              <span className="switch__thumb" />
            </button>
          </div>
        ))}
      </Section>

      <Section title="Tables" defaultOpen tip="How tight the rows are and how the column headers read, in the Gantt, the Planner, the activity table and the data table.">
        <div className="set-row set-row--stack">
          <div className="set-row__text">
            <span className="set-row__label">Row height</span>
            <span className="set-row__hint">Smaller fits more rows; larger is easier to hit with a finger. The Gantt, Planner and tables follow it.</span>
          </div>
          <div className="set-size">
            <span className="set-seg__bars" aria-hidden style={{ gap: `${Math.max(1, Math.round((3 * rowScale) / 100))}px` }}><i /><i /><i /></span>
            <input type="range" min={ROW_SCALE_MIN} max={ROW_SCALE_MAX} step={5} value={rowScale} onChange={(e) => setRowScale(Number(e.target.value))} aria-label="Row height, percent of normal" />
            <label className="set-size__value">
              <input type="number" min={ROW_SCALE_MIN} max={ROW_SCALE_MAX} step={5} value={rowScale} onChange={(e) => setRowScale(Number(e.target.value))} aria-label="Row height in percent" />%
            </label>
          </div>
          <div className="set-size__presets">
            {[80, 100, 130, 160].map((p) => (
              <button key={p} type="button" className={rowScale === p ? 'is-on' : ''} onClick={() => setRowScale(p)}>{p === 100 ? 'Normal' : `${p}%`}</button>
            ))}
            <span className="set-row__hint">Gantt row: {Math.round((28 * rowScale) / 100)} px</span>
          </div>
        </div>
        <div className="set-row">
          <div className="set-row__text">
            <span className="set-row__label">Wrap column headers</span>
            <span className="set-row__hint">Long headings go onto more lines instead of being cut off.</span>
          </div>
          <button type="button" role="switch" aria-checked={wrapHeaders} aria-label="Wrap column headers" className={`switch${wrapHeaders ? ' on' : ''}`} onClick={() => setWrapHeaders(!wrapHeaders)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="set-row">
          <div className="set-row__text">
            <span className="set-row__label">Smooth mouse scrolling</span>
            <span className="set-row__hint">The mouse wheel glides in the tables and the Gantt: it speeds up as you turn it and slows to a stop, as a hand does on a tablet.</span>
          </div>
          <button type="button" role="switch" aria-checked={smoothScroll} aria-label="Smooth mouse scrolling" className={`switch${smoothScroll ? ' on' : ''}`} onClick={() => setSmoothScroll(!smoothScroll)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span title="Holding Ctrl while the wheel turns scrolls this many times as far (with or without the glide)">Ctrl + wheel scrolls</span>
          <select className="rel-cell" value={ctrlScroll} onChange={(e) => setCtrlScroll(Number(e.target.value))} aria-label="Ctrl and wheel scroll distance">
            {[2, 3, 4].map((n) => <option key={n} value={n}>{n}× as far</option>)}
          </select>
        </div>
      </Section>

      <Section title="Appearance" defaultOpen tip="The theme (light, dark, or the system's) and the accent colour of the app: buttons, selections, highlights and the Gantt's bars.">
        <div className="disp__row">
          <span>Theme</span>
          <select className="rel-cell" value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} aria-label="Theme">
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="accent-palettes" role="radiogroup" aria-label="Accent palette">
          {ACCENT_PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={accent === p.id}
              className={`accent-palette${accent === p.id ? ' is-on' : ''}`}
              onClick={() => setAccent(p.id)}
              title={p.label}
            >
              <span className="accent-palette__swatches">
                {p.colors.map((c) => <i key={c} style={{ background: c }} />)}
              </span>
              <span className="accent-palette__label">{p.label}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
