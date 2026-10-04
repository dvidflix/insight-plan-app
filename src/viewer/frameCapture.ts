import { accentColor } from '../state/accentPaletteStore';
import type { ViewerEngine } from './ViewerEngine';

/** Composes one image of the 4D view as shown on screen: the 3D view(s)
    plus the overlays drawn over them (date label, tag chips / callouts with
    their leader lines) and, optionally, a TimeLiner-style progress bar. */

/** The Tasks table drawn beside the 3D view in exported frames. */
export interface TasksFrame {
  title: string;
  subtitle: string;
  columns: { label: string; width: number; align?: 'right' }[];
  rows: ({ kind: 'group'; label: string; count: number } | { kind: 'row'; cells: string[]; color: string | null })[];
  /** Width of the panel as a fraction of the 3D view's width. */
  widthFraction: number;
}

export interface TimelineBar {
  /** 0..1 through the programme. */
  progress: number;
  left: string;
  right: string;
  label: string;
}

const px = (v: string) => parseFloat(v) || 0;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Redraws an HTML text box (background, border, left accent, text). */
function drawBox(ctx: CanvasRenderingContext2D, el: HTMLElement, origin: DOMRect) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cs = getComputedStyle(el);
  const x = r.left - origin.left;
  const y = r.top - origin.top;
  const radius = px(cs.borderTopLeftRadius);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 6;
  roundRect(ctx, x, y, r.width, r.height, radius);
  ctx.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = cs.borderTopColor;
  ctx.lineWidth = px(cs.borderTopWidth) || 1;
  roundRect(ctx, x, y, r.width, r.height, radius);
  ctx.stroke();
  const accent = px(cs.borderLeftWidth);
  if (accent > 1) {
    ctx.fillStyle = cs.borderLeftColor;
    ctx.save();
    roundRect(ctx, x, y, r.width, r.height, radius);
    ctx.clip();
    ctx.fillRect(x, y, accent, r.height);
    ctx.restore();
  }
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textBaseline = 'top';
  const lineH = px(cs.lineHeight) || px(cs.fontSize) * 1.3;
  const padL = px(cs.paddingLeft) + accent;
  let ty = y + px(cs.paddingTop);
  for (const line of el.innerText.split('\n')) {
    ctx.fillText(line, x + padL, ty + (lineH - px(cs.fontSize)) / 2, r.width - padL - px(cs.paddingRight));
    ty += lineH;
  }
}

function drawSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, origin: DOMRect) {
  const r = svg.getBoundingClientRect();
  const ox = r.left - origin.left;
  const oy = r.top - origin.top;
  svg.querySelectorAll('line').forEach((l) => {
    ctx.strokeStyle = l.getAttribute('stroke') ?? '#333';
    ctx.lineWidth = Number(l.getAttribute('stroke-width') ?? 1);
    ctx.beginPath();
    ctx.moveTo(ox + Number(l.getAttribute('x1')), oy + Number(l.getAttribute('y1')));
    ctx.lineTo(ox + Number(l.getAttribute('x2')), oy + Number(l.getAttribute('y2')));
    ctx.stroke();
  });
  svg.querySelectorAll('circle').forEach((c) => {
    ctx.fillStyle = c.getAttribute('fill') ?? '#333';
    ctx.beginPath();
    ctx.arc(ox + Number(c.getAttribute('cx')), oy + Number(c.getAttribute('cy')), Number(c.getAttribute('r') ?? 3), 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, bar: TimelineBar) {
  const band = 44;
  const y = h - band;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, y, w, band);
  ctx.strokeStyle = '#c9ced1';
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(w, y + 0.5);
  ctx.stroke();
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1f2328';
  ctx.fillText(bar.label, 14, y + band / 2);
  const labelW = ctx.measureText(bar.label).width + 30;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#66757b';
  const leftW = ctx.measureText(bar.left).width;
  const rightW = ctx.measureText(bar.right).width;
  ctx.fillText(bar.left, labelW, y + band / 2);
  ctx.fillText(bar.right, w - rightW - 14, y + band / 2);
  const bx = labelW + leftW + 10;
  const bw = w - bx - rightW - 28;
  if (bw < 20) return;
  roundRect(ctx, bx, y + band / 2 - 5, bw, 10, 5);
  ctx.fillStyle = '#e3e7e9';
  ctx.fill();
  roundRect(ctx, bx, y + band / 2 - 5, Math.max(10, bw * Math.min(1, Math.max(0, bar.progress))), 10, 5);
  ctx.fillStyle = accentColor();
  ctx.fill();
}

function drawTasks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: TasksFrame) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#d3d7d4';
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y);
  ctx.lineTo(x + 0.5, y + h);
  ctx.stroke();
  const pad = 12;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1f2328';
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillText(t.title, x + pad, y + 20);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#66757b';
  ctx.fillText(t.subtitle, x + pad, y + 40);

  // Columns scaled to the panel width (the Tasks panel's own widths as ratios).
  const chip = 6;
  const tableX = x + pad;
  const tableW = w - pad * 2;
  const total = t.columns.reduce((s, c) => s + c.width, 0) || 1;
  const widths = t.columns.map((c) => ((tableW - chip - 4) * c.width) / total);
  const rowH = 20;
  let ry = y + 58;
  ctx.fillStyle = '#f3f4f5';
  ctx.fillRect(tableX, ry, tableW, rowH + 2);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = '#3c4448';
  const cellText = (text: string, cx: number, cw: number, align?: 'right') => {
    let s = text;
    if (ctx.measureText(s).width > cw - 8) {
      while (s.length > 1 && ctx.measureText(`${s}…`).width > cw - 8) s = s.slice(0, -1);
      s = `${s}…`;
    }
    const tx = align === 'right' ? cx + cw - 4 - ctx.measureText(s).width : cx + 4;
    ctx.fillText(s, tx, ry + rowH / 2 + 1);
  };
  let cx = tableX + chip + 4;
  t.columns.forEach((c, i) => {
    cellText(c.label, cx, widths[i], c.align);
    cx += widths[i];
  });
  ry += rowH + 2;

  const maxRows = Math.floor((y + h - ry - 22) / rowH);
  const shown = t.rows.slice(0, Math.max(0, maxRows));
  shown.forEach((r, i) => {
    if (r.kind === 'group') {
      ctx.fillStyle = '#e9eef2';
      ctx.fillRect(tableX, ry, tableW, rowH);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = '#1f2328';
      cellText(`${r.label}  (${r.count})`, tableX, tableW);
    } else {
      if (i % 2) {
        ctx.fillStyle = '#fafbfb';
        ctx.fillRect(tableX, ry, tableW, rowH);
      }
      if (r.color) {
        ctx.fillStyle = r.color;
        ctx.fillRect(tableX, ry + 3, chip, rowH - 6);
      }
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#1f2328';
      let x0 = tableX + chip + 4;
      r.cells.forEach((text, ci) => {
        cellText(text, x0, widths[ci], t.columns[ci]?.align);
        x0 += widths[ci];
      });
    }
    ctx.strokeStyle = '#eef0f1';
    ctx.beginPath();
    ctx.moveTo(tableX, ry + rowH + 0.5);
    ctx.lineTo(tableX + tableW, ry + rowH + 0.5);
    ctx.stroke();
    ry += rowH;
  });
  if (t.rows.length > shown.length) {
    ctx.font = 'italic 11px system-ui, sans-serif';
    ctx.fillStyle = '#66757b';
    ctx.fillText(`+ ${t.rows.length - shown.length} more`, tableX + 4, ry + 11);
  }
  ctx.restore();
}

/** The element the 3D view(s) and the overlays share (ViewerWorkspace's
    relative wrapper around ViewerCanvas + overlay). */
export function viewerArea(engine: ViewerEngine): HTMLElement | null {
  const canvas = engine.world.renderer?.three.domElement;
  return (canvas?.closest('.viewer-canvas')?.parentElement as HTMLElement | null) ?? null;
}

/** Draws the current frame into `out` (resized to the view area x scale). */
export function captureFrame(engine: ViewerEngine, out: HTMLCanvasElement, opts: { scale: number; timeline: TimelineBar | null; tasks?: TasksFrame | null }) {
  const area = viewerArea(engine);
  const mainCanvas = engine.world.renderer?.three.domElement;
  if (!area || !mainCanvas) throw new Error('The 3D view is not available.');
  const origin = area.getBoundingClientRect();
  // The Tasks table (optional) sits to the right of the view.
  const panelW = opts.tasks ? Math.round(origin.width * opts.tasks.widthFraction) : 0;
  const cssW = origin.width + panelW;
  // H.264 needs even dimensions.
  const w = Math.floor((cssW * opts.scale) / 2) * 2;
  const h = Math.floor((origin.height * opts.scale) / 2) * 2;
  if (out.width !== w) out.width = w;
  if (out.height !== h) out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(w / cssW, 0, 0, h / origin.height, 0, 0);

  const blit = (canvas: HTMLCanvasElement) => {
    const r = canvas.getBoundingClientRect();
    if (r.width && r.height) ctx.drawImage(canvas, r.left - origin.left, r.top - origin.top, r.width, r.height);
  };
  // Render then read in the same task, before the buffer is presented.
  engine.world.renderer?.update();
  blit(mainCanvas);
  const second = engine.secondary?.renderNow();
  const cut = engine.compareSlider;
  if (second && cut !== null) {
    // Compare slider: the right view covers the main one right of the divider only.
    const r = second.getBoundingClientRect();
    const x = r.left - origin.left + r.width * cut;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, r.top - origin.top, r.width * (1 - cut), r.height);
    ctx.clip();
    blit(second);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1, r.top - origin.top, 2, r.height);
  } else if (second) blit(second);

  area.querySelectorAll<SVGSVGElement>('.tag-callouts__lines').forEach((svg) => drawSvg(ctx, svg, origin));
  area.querySelectorAll<HTMLElement>('.sequence-label-overlay, .tag-overlay__chip, .tag-callouts__label').forEach((el) => drawBox(ctx, el, origin));
  if (opts.timeline) drawTimeline(ctx, origin.width, origin.height, opts.timeline);
  if (opts.tasks) drawTasks(ctx, origin.width, 0, panelW, origin.height, opts.tasks);
}
