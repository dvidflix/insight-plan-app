/** Exporting a timeline as a sharp image (PNG) or a PDF, without a library:
    the chart's DOM is copied into an SVG <foreignObject>, with the page's
    styles that apply to it, drawn on a canvas at 2-3 times its size, then
    saved as a PNG; the PDF is that same picture on a page of its own (a
    minimal PDF written here, the image stored as a high-quality JPEG). */

/** What the chart needs on a white page: no grey app colours behind it. */
const EXPORT_CSS = `
  html, body { background: #fff; margin: 0; overflow: visible; display: block; height: auto; font-family: var(--font-body, 'Segoe UI', system-ui, sans-serif); }
  .tl-page { display: block; width: auto; background: #fff; }
  .tl-grid, .tl-head, .tl-axis, .tl-rows, .tl-summaries, .tl-row, .tl-lane, .tl-sumlane, .tl-left, .tl-corner, .tl-sumleft, .tl-hcell { background-image: none; }
  .tl-grid, .tl-head, .tl-axis, .tl-rows, .tl-summaries, .tl-sumlane, .tl-left, .tl-corner, .tl-sumleft, .tl-hcell { background-color: #fff; }
  .tl-row, .tl-lane { background-color: transparent; }
  .tl-row--alt .tl-lane, .tl-row--alt .tl-left { background-color: #f6f7f8; }
  .tl-row--group .tl-left, .tl-row--group .tl-lane { background-color: #f1f3f5; }
  .tl-mergecell { background-color: #f6f7f8; }
  .tl-head, .tl-left, .tl-summaries { position: static; }
  .tl-mergelayer { position: relative; }
  .print-title { font: 600 18px sans-serif; margin: 0 0 10px; color: #111; }
  .print-title small { font-weight: 400; color: #666; margin-left: 12px; font-size: 13px; }
`;

/** The page's CSS rules that can matter to the chart: the timeline's own, and the variables / base rules. */
function relevantCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a stylesheet from another site can't be read
    }
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        const text = rule.cssText;
        if (rule instanceof CSSMediaRule) {
          // Only the print-independent screen rules matter here.
          if (/print/.test(rule.conditionText)) continue;
          walk(rule.cssRules);
        } else if (/tl-|:root|^html|^body|^\*|@font-face|--tl|svg/.test(text.slice(0, 400))) css += `${text}\n`;
      }
    };
    walk(rules);
  }
  return css;
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

export interface RenderOptions {
  /** The chart: the `.tl-grid` element. */
  grid: HTMLElement;
  title: string;
  rowHeight: number;
  /** Times the chart's size, for sharpness (2 is good for screens, 3 for print). */
  scale?: number;
  /** The chart's size in px, when it can't be measured (its view is hidden). */
  size?: { width: number; height: number };
}

/** The chart drawn on a canvas, white behind. */
export async function renderTimelineCanvas({ grid, title, rowHeight, scale = 3, size }: RenderOptions): Promise<HTMLCanvasElement> {
  const width = Math.ceil(size?.width ?? grid.scrollWidth) + 24;
  const titleH = 44;
  const height = Math.ceil(size?.height ?? grid.scrollHeight) + titleH + 16;
  // A canvas can't be larger than the browser allows (about 16,000 px a side, 100 M pixels).
  const s = Math.max(1, Math.min(scale, 15000 / width, 15000 / height, Math.sqrt(90_000_000 / (width * height))));

  const wrap = document.createElement('div');
  wrap.className = 'tl-page';
  wrap.setAttribute('style', `--tl-row-h:${rowHeight}px;--tl-bar-h:${Math.min(28, Math.max(14, rowHeight - 14))}px;padding:12px;background:#fff;width:${width - 24}px`);
  wrap.innerHTML = `<p class="print-title">${esc(title)}<small>${new Date().toLocaleDateString()}</small></p>`;
  wrap.appendChild(grid.cloneNode(true));

  const xhtml = new XMLSerializer().serializeToString(wrap);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#fff">` +
    `<style>${relevantCss().replace(/]]>/g, ']] >')}${EXPORT_CSS}</style>${xhtml}</div></foreignObject></svg>`;

  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The timeline could not be drawn as an image.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be saved.'))), type, quality));

export const canvasToPng = (canvas: HTMLCanvasElement) => toBlob(canvas, 'image/png');

/** A one-page PDF with the canvas on it, as a high-quality JPEG; the page is
    A3-landscape wide (1190 pt) and as tall as the picture needs. */
export async function canvasToPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
  const pageW = 1190;
  const pageH = Math.round((pageW * canvas.height) / canvas.width);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
