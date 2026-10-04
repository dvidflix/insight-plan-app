import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { useAccessibilityStore } from '../../state/accessibilityStore';
import { buildNetwork, computeCPM, type NetworkNode } from '../../schedule/network';

type GroupBy = 'wbs' | 'resource';

const ROW_H = 26;
const COL_W_PER_DAY = 14;
const LABEL_W = 220;

export function NetworkView({ model }: { model: ScheduleModel }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('wbs');
  const [cpOnly, setCpOnly] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = useAccessibilityStore((s) => s.palette);

  const { network, cpm } = useMemo(() => {
    const network = buildNetwork(model);
    const cpm = computeCPM(network, model.project.dataDate);
    return { network, cpm };
  }, [model]);

  const groupKey = (node: NetworkNode): string => {
    if (groupBy === 'wbs') return node.wbsPath || 'Ungrouped';
    const activity = model.activities.find((a) => a.id === node.id);
    return activity?.resources[0]?.resourceName || 'Unassigned';
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let nodeIds = [...network.nodes.keys()];
    if (cpOnly) nodeIds = nodeIds.filter((id) => cpm.perNode.get(id)?.isCritical);
    const positioned = nodeIds
      .map((id) => ({ id, node: network.nodes.get(id)!, result: cpm.perNode.get(id) }))
      .filter((n) => n.result);

    const groups = new Map<string, typeof positioned>();
    for (const n of positioned) {
      const key = groupKey(n.node);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
    }
    const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const rows = new Map<string, number>();
    let rowCursor = 0;
    const groupLabelY: { label: string; y: number }[] = [];
    for (const [key, list] of sortedGroups) {
      groupLabelY.push({ label: key, y: rowCursor });
      list.sort((a, b) => a.result!.earlyStart.getTime() - b.result!.earlyStart.getTime());
      for (const n of list) {
        rows.set(n.id, rowCursor);
        rowCursor++;
      }
    }

    if (positioned.length === 0) {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const minDate = Math.min(...positioned.map((n) => n.result!.earlyStart.getTime()));
    const maxDate = Math.max(...positioned.map((n) => n.result!.earlyFinish.getTime()));
    const dpr = window.devicePixelRatio || 1;
    const contentWidth = LABEL_W + ((maxDate - minDate) / 86400000) * COL_W_PER_DAY * zoom + 260;
    const width = Math.max(contentWidth, canvas.parentElement?.clientWidth ?? 800);
    const height = Math.max(rowCursor * ROW_H + 40, canvas.parentElement?.clientHeight ?? 200);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const xFor = (d: Date) => LABEL_W + ((d.getTime() - minDate) / 86400000) * COL_W_PER_DAY * zoom;
    const yFor = (id: string) => 24 + (rows.get(id) ?? 0) * ROW_H;

    // group separators + labels
    ctx.strokeStyle = '#232b36';
    ctx.fillStyle = '#8b98a5';
    ctx.font = '10px sans-serif';
    for (const g of groupLabelY) {
      const y = 24 + g.y * ROW_H - 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(truncate(g.label, 30), 4, y + 12);
    }

    const idSet = new Set(positioned.map((n) => n.id));
    const critical = getComputedStyle(document.body).getPropertyValue('--bar-critical').trim() || '#ef4444';
    // edges
    for (const n of positioned) {
      for (const e of network.succs.get(n.id) ?? []) {
        if (!idSet.has(e.otherId)) continue;
        const succCritical = cpm.perNode.get(e.otherId)?.isCritical && n.result!.isCritical;
        ctx.strokeStyle = succCritical ? critical : '#3b4a5a';
        ctx.beginPath();
        ctx.moveTo(xFor(n.result!.earlyFinish), yFor(n.id));
        ctx.lineTo(xFor(cpm.perNode.get(e.otherId)!.earlyStart), yFor(e.otherId));
        ctx.stroke();
      }
    }

    // nodes
    for (const n of positioned) {
      const x1 = xFor(n.result!.earlyStart);
      const x2 = xFor(n.result!.earlyFinish);
      const y = yFor(n.id);
      const w = Math.max(x2 - x1, 4);
      ctx.fillStyle = n.result!.isCritical ? critical : '#7c5cff';
      ctx.fillRect(x1, y - 6, w, 12);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(truncate(n.node.name, 26), x2 + 4, y + 3);
    }
  }, [network, cpm, cpOnly, zoom, groupBy, palette]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="filterbar">
        <button className={`btn${groupBy === 'wbs' ? ' primary' : ''}`} onClick={() => setGroupBy('wbs')}>
          WBS
        </button>
        <button className={`btn${groupBy === 'resource' ? ' primary' : ''}`} onClick={() => setGroupBy('resource')}>
          Resources
        </button>
        <button className={`btn${cpOnly ? ' primary' : ''}`} onClick={() => setCpOnly((v) => !v)}>
          Critical path only
        </button>
        <button className="btn" onClick={() => setZoom((z) => Math.max(0.25, z / 1.4))}>
          Zoom out
        </button>
        <button className="btn" onClick={() => setZoom((z) => Math.min(6, z * 1.4))}>
          Zoom in
        </button>
        <button className="btn" onClick={() => setZoom(1)}>
          Reset
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
