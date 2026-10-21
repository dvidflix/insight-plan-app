import { useCallback, useRef, useState } from 'react';
import { DockGantt } from '../sequence/DockGantt';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { usePersistedState } from '../../utils/persistedState';
import { useGenerateTab } from './GenerateTabs';

/** The programme as a Gantt along the bottom of the Generate view, so a change to the order, a recipe or a limit can be checked against the
    programme Update 4D made, without leaving the tab. It is the Gantt of 4D Sequencing (the same columns, grouping, colours and zoom). The bar between
    it and the tab above is dragged to give it more or less of the height. */
export function GenerateGantt() {
  const model = useSequenceSchedule();
  const setGantt = useGenerateTab((s) => s.setGantt);
  const [height, setHeight] = usePersistedState<number>('generate.ganttHeight', 320);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const onDown = useCallback((e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);
  const onMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    setHeight(Math.max(140, Math.min(window.innerHeight - 220, drag.current.h + (drag.current.y - e.clientY))));
  }, [setHeight]);
  const onUp = useCallback(() => { drag.current = null; }, []);

  return (
    <section className="gen-gantt" style={{ height }} aria-label="Gantt">
      <div className="gen-gantt__split" role="separator" aria-orientation="horizontal" title="Drag to resize" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div className="gen-gantt__head">
        <strong>Gantt</strong>
        <span className="scn-dim">{model ? `${model.activities.length.toLocaleString()} activities` : 'Update 4D (tab 1 or 2) to see the programme here.'}</span>
        <button type="button" className="btn btn--small gen-gantt__close" onClick={() => setGantt(false)} aria-label="Hide the Gantt">Hide</button>
      </div>
      <div className="gen-gantt__body">
        {model ? (
          <DockGantt model={model} selectedId={selectedId} highlightedIds={NONE} scrollToId={null} onSelect={(a) => setSelectedId(a.id)} />
        ) : null}
      </div>
    </section>
  );
}

const NONE = new Set<string>();
