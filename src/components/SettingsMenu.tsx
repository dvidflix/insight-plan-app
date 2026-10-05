import { EXPERIMENTAL_FEATURES, useAppPrefsStore } from '../state/appPrefsStore';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { CollapsibleSection } from './CollapsibleSection';
import { InfoTip } from './InfoTip';
import { useTableStyleStore } from '../state/tableStyleStore';
import { exportAppConfig, importAppConfig } from '../state/appConfig';
import { FULL_SCREEN_KEY } from './FullScreenOnStart';
import { ACCENT_PALETTES, useAccentPaletteStore } from '../state/accentPaletteStore';
import { DEFAULT_FLOOR_PLAN_RANGE, FLOOR_PLAN_RANGE_KEY } from '../viewer/floorPlanRange';
import { DEFAULT_SELECTION_COLOR, SELECTION_COLOR_KEY } from '../viewer/selectionColor';
import { useTimelineSettingsStore, MAX_TIMELINE_ZOOM } from '../state/timelineSettingsStore';
import { FileDetailsSync } from './InputDetails';
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
const applyStatusBar = (show: boolean) => document.body.classList.toggle('hide-statusbar', !show);

export function SettingsSync() {
  const engine = useViewerEngine();
  useEffect(() => {
    applyStatusBar(localStorage.getItem(STATUS_BAR_KEY) !== 'false');
    const range = Number(localStorage.getItem(FLOOR_PLAN_RANGE_KEY) ?? DEFAULT_FLOOR_PLAN_RANGE);
    engine.setFloorPlanRange(range || DEFAULT_FLOOR_PLAN_RANGE);
    const color = localStorage.getItem(SELECTION_COLOR_KEY) ?? DEFAULT_SELECTION_COLOR;
    void engine.ready.then(() => engine.setSelectionColor(color));
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

export function SettingsPanel({ timeline = false, inputs = false }: { timeline?: boolean; inputs?: boolean }) {
  const wrapHeaders = useTableStyleStore((s) => s.wrapHeaders);
  const setWrapHeaders = useTableStyleStore((s) => s.setWrapHeaders);
  const [fullScreen, setFullScreen] = usePersistedValue<string>(FULL_SCREEN_KEY, 'true');
  const [statusBar, setStatusBar] = usePersistedValue<string>(STATUS_BAR_KEY, 'true');
  useEffect(() => { applyStatusBar(statusBar !== 'false'); }, [statusBar]);
  const accent = useAccentPaletteStore((s) => s.id);
  const setAccent = useAccentPaletteStore((s) => s.setId);
  const showScenariosTab = useAppPrefsStore((s) => s.showScenariosTab);
  const setShowScenariosTab = useAppPrefsStore((s) => s.setShowScenariosTab);
  const showTimelinesTab = useAppPrefsStore((s) => s.showTimelinesTab);
  const setShowTimelinesTab = useAppPrefsStore((s) => s.setShowTimelinesTab);
  const showWikiTab = useAppPrefsStore((s) => s.showWikiTab);
  const showExternalTab = useAppPrefsStore((s) => s.showExternalTab);
  const setShowExternalTab = useAppPrefsStore((s) => s.setShowExternalTab);
  const showDashboardsTab = useAppPrefsStore((s) => s.showDashboardsTab);
  const setShowDashboardsTab = useAppPrefsStore((s) => s.setShowDashboardsTab);
  const setShowWikiTab = useAppPrefsStore((s) => s.setShowWikiTab);
  const experimental = useAppPrefsStore((s) => s.experimental);
  const setExperimental = useAppPrefsStore((s) => s.setExperimental);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const handleImportConfig = async (file: File) => {
    setConfigError(null);
    setConfigNotice(null);
    try {
      const { missingModels, missingSchedules } = await importAppConfig(file);
      // Link Groups, Appearance Profiles and Programmes are store-backed, so
      // they're already showing everywhere. Column arrangements, color/
      // group/sort rules, palettes etc. are seeded from localStorage only on
      // mount (usePersistedState), so they need a reload to take effect —
      // left to the user to trigger (Reload now) rather than done
      // automatically, since a reload would also drop any 3D model loaded
      // this session (models aren't persisted at all, by design — see
      // exportAppConfig's doc comment).
      const missing = [...missingModels, ...missingSchedules];
      const missingNote = missing.length > 0 ? ` See the Inputs tab for which files are still needed.` : '';
      setConfigNotice(`Link Groups, Appearance Profiles and Programmes loaded.${missingNote} Reload to apply saved column/color/view settings.`);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="settings-panel">
      {timeline && <TimelineSettings />}

      {inputs && (
        <>
          <Section title="File details (SeaTable)" defaultOpen tip="The details of each file (discipline, building, status…) are filled in on SeaTable's Insight Plan Files table. Push sends the files of the Inputs page (name, type, format, size…): new ones are added, the others updated, and the details you filled in are not touched. Read brings the details back, to show as columns and to group and filter by.">
            <FileDetailsSync />
          </Section>
          <Section title="Project database" defaultOpen tip="The project folder and its database (insight-plan.db): programmes in P6 tables, scenarios and settings. Open it in DBeaver or DB Browser for SQLite; edits made there come in with Reload.">
            <ProjectDbBar bare />
          </Section>
          <Section title="Exports (XML / XER)" defaultOpen={false} tip="Tick what goes into the XML and XER files you download (scenario programmes, and programmes from the Inputs list). Untick the user fields, resources and activity codes that are for your own use: they stay in the app but are left out of the files, with their values and assignments. The app-only Precast (m3) resource is left out unless you tick it.">
            <ExportFieldsPanel bare />
          </Section>
          <Section title="SeaTable (model data)" defaultOpen={false} tip="Push sends the elements of the IFC classes you tick, with the properties the Properties table shows, to the Elements table of the SeaTable base, one row per element, by its GlobalId. Pull brings back every column you add to that table yourself (names without a dot) as Custom properties of the elements.">
            <SeaTablePanel bare />
          </Section>
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
            Show status bar{' '}
            <InfoTip>The bar along the bottom of the Models and Programmes pages (models loaded, active model, element and activity counts). The 4D Sequencing timeline always shows.</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={statusBar !== 'false'} className={`switch${statusBar !== 'false' ? ' on' : ''}`} onClick={() => setStatusBar(statusBar === 'false' ? 'true' : 'false')}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>
            Show Scenarios tab{' '}
            <InfoTip>The Scenarios page in the top bar. Scenarios also works inside 4D Sequencing (its Scenarios panel, beside the 3D model), so the tab is hidden by default.</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={showScenariosTab} className={`switch${showScenariosTab ? ' on' : ''}`} onClick={() => setShowScenariosTab(!showScenariosTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>Show Timelines tab</span>
          <button type="button" role="switch" aria-checked={showTimelinesTab} className={`switch${showTimelinesTab ? ' on' : ''}`} onClick={() => setShowTimelinesTab(!showTimelinesTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>Show Wiki tab</span>
          <button type="button" role="switch" aria-checked={showWikiTab} className={`switch${showWikiTab ? ' on' : ''}`} onClick={() => setShowWikiTab(!showWikiTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>Show External data tab <InfoTip>SeaTable in a frame, signed in for you.</InfoTip></span>
          <button type="button" role="switch" aria-checked={showExternalTab} className={`switch${showExternalTab ? ' on' : ''}`} onClick={() => setShowExternalTab(!showExternalTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>Show Dashboards tab <InfoTip>Apache Superset in a frame, signed in for you.</InfoTip></span>
          <button type="button" role="switch" aria-checked={showDashboardsTab} className={`switch${showDashboardsTab ? ' on' : ''}`} onClick={() => setShowDashboardsTab(!showDashboardsTab)}>
            <span className="switch__thumb" />
          </button>
        </div>
      </Section>

      <Section title="Experimental features" defaultOpen tip="Features still being tried out. They are hidden until switched on here, and may change or be removed.">
        {EXPERIMENTAL_FEATURES.map((f) => (
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

      <Section
        title="Preferences"
        defaultOpen={false}
        tip="Link Groups, Appearance Profiles, loaded Programmes (which/hidden), loaded Model references (which/hidden), and every saved view setting (columns, colors, sort, palettes, zoom) as one file. Model geometry itself isn't included; re-add those files from Inputs after importing, and matching names restore their hidden state."
      >
        <div className="settings-subheading">Configuration</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={exportAppConfig}>Export all</button>
          <button className="btn" type="button" onClick={() => importRef.current?.click()}>Import all</button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportConfig(f);
            e.target.value = '';
          }}
        />
        {configError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{configError}</div>}
        {configNotice && (
          <div style={{ marginTop: 6 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 4 }}>{configNotice}</div>
            <button className="btn" type="button" onClick={() => window.location.reload()}>Reload now</button>
          </div>
        )}
      </Section>

      <Section title="Tables" defaultOpen>
        <div className="disp__row">
          <span>Wrap column headers</span>
          <button type="button" role="switch" aria-checked={wrapHeaders} className={`switch${wrapHeaders ? ' on' : ''}`} onClick={() => setWrapHeaders(!wrapHeaders)}>
            <span className="switch__thumb" />
          </button>
        </div>
      </Section>

      <Section title="Appearance" defaultOpen tip="The accent colour of the app: buttons, selections, highlights and the Gantt's bars.">
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
