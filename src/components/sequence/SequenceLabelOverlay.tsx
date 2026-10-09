import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useViewSettingsStore } from '../../state/viewSettingsStore';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { useSequenceLabelStore } from '../../state/sequenceLabelStore';
import { tagCss, useActiveTagsStore, useTagsStore } from '../../state/tagsStore';
import { TagCallouts } from './TagCallouts';
import { AppearanceKey } from './AppearanceKey';
import { useRecordingStore } from '../../state/recordingStore';
import { scheduleRange } from '../../schedule/linking';
import { alignDown, nextBoundary } from '../../schedule/period';
import { renderLabelTemplate } from '../../schedule/labelTemplate';

/** The one piece of the old bottom-docked timeline that still floats over
    the 3D viewport — everything else (scrub/play controls) now lives in the
    app status bar (see SequenceTimelineStatusBar), which has no room for a
    multi-line, freely-positioned readout like "Week 12 / Week commencing
    04/03/26". Renders nothing until the user has both a schedule and a
    non-empty template. */
export function SequenceLabelOverlay() {
  const model = useSequenceSchedule();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const date = useSequenceTimelineStore((s) => s.date);
  const enabled = useSequenceLabelStore((s) => s.enabled);
  const position = useSequenceLabelStore((s) => s.position);
  const template = useSequenceLabelStore((s) => s.template);

  const range = useMemo(() => scheduleRange(model, basis), [model, basis]);

  const text = useMemo(() => {
    if (!range || date === null || !template.trim()) return '';
    return renderLabelTemplate(template, { date: new Date(date), range, period: { start: alignDown(date, stepUnit), end: nextBoundary(date, stepUnit) } });
  }, [template, range, date, stepUnit]);

  // The second view, while the 4D page is split side by side: its tags are drawn over it.
  const engine = useViewerEngine();
  const split = useViewSettingsStore((s) => s.pages.sequence.split && (s.pages.sequence.compare ?? 'side') === 'side');
  const [hasSecond, setHasSecond] = useState(!!engine.secondary);
  useEffect(() => {
    const sync = () => setHasSecond(!!engine.secondary);
    engine.onSecondaryChange.add(sync);
    sync();
    return () => engine.onSecondaryChange.remove(sync);
  }, [engine]);
  const sideBySide = split && hasSecond;
  const tagItems = useActiveTagsStore((s) => s.items);
  const placement = useTagsStore((s) => s.placement);
  const tagsShown = useTagsStore((s) => s.shown);
  const recPhase = useRecordingStore((s) => s.phase);
  const recCount = useRecordingStore((s) => s.count);
  // Esc stops an export in progress.
  useEffect(() => {
    if (recPhase === 'idle') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useRecordingStore.getState().cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recPhase]);

  return (
    <>
      {enabled && text && (
        <div className={`sequence-label-overlay sequence-label-overlay--${position}`}>
          {text}
        </div>
      )}
      <AppearanceKey />
      {tagsShown && placement === 'objects' && <TagCallouts view="main" />}
      {tagsShown && placement === 'objects' && sideBySide && <TagCallouts view="second" />}
      {/* Not drawn into the export: frameCapture only redraws the label/tag overlays. */}
      {recPhase === 'countdown' && <div className="rec-countdown">{recCount}</div>}
      {tagsShown && placement === 'corner' && tagItems.length > 0 && (
        <div className="tag-overlay">
          {tagItems.map((t) => (
            <div key={t.key} className="tag-overlay__chip" style={{ ...tagCss(t.style), borderLeftColor: t.color }}>
              {t.lines.join('\n')}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
