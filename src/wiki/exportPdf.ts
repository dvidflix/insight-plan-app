import { renderPage, wikiSections } from './content';

/** Wiki › Export PDF: every page, in the order of the side list, as one
    printable document — a cover, a contents list, then each page starting
    on a new sheet — opened in a new window with the print dialog, where
    "Save as PDF" makes the file. Links between pages jump within it. */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pageId = (slug: string) => `p-${slug.replace(/[^\w-]/g, '-')}`;

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10.5pt/1.55 "Segoe UI", system-ui, -apple-system, sans-serif; color: #1f2328; }
a { color: #007a5f; text-decoration: none; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover__mark { width: 18mm; height: 18mm; border-radius: 4mm; background: #008d6e; margin-bottom: 10mm; }
.cover h1 { font-size: 30pt; margin: 0 0 4mm; border: 0; padding: 0; }
.cover p { margin: 0; font-size: 12pt; color: #59636e; }
.toc { break-before: page; }
.toc h1 { font-size: 20pt; }
.toc h2 { font-size: 13pt; margin: 8mm 0 2mm; color: #008d6e; border: 0; }
.toc ol { margin: 0; padding-left: 6mm; }
.toc li { margin: 1mm 0; }
.section-title { break-before: page; height: 240mm; display: flex; align-items: center; }
.section-title h1 { font-size: 26pt; color: #008d6e; border: 0; }
.wp { break-before: page; }
.wp__crumb { font-size: 8.5pt; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2mm; }
h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 5mm; padding-bottom: 2mm; border-bottom: 1.5pt solid #008d6e; }
h2 { font-size: 14pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: .5pt solid #d0d7de; }
h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; }
h2, h3, h4 { break-after: avoid; }
p, ul, ol { margin: 0 0 2.5mm; }
li { margin: .5mm 0; }
code { font: 9pt Consolas, "Cascadia Mono", monospace; background: #f3f4f6; padding: .2mm 1mm; border-radius: 1mm; }
pre { background: #f6f8fa; border: .5pt solid #d0d7de; border-radius: 1.5mm; padding: 3mm; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9pt; break-inside: auto; }
th, td { border: .5pt solid #d0d7de; padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
th { background: #f0f7f5; }
tr { break-inside: avoid; }
blockquote { margin: 0 0 3mm; padding: 1mm 4mm; border-left: 1mm solid #008d6e; color: #444c56; background: #f6faf9; }
img { max-width: 100%; height: auto; break-inside: avoid; border: .5pt solid #e5e7eb; }
hr { border: 0; border-top: .5pt solid #d0d7de; margin: 5mm 0; }
.video-note { font-style: italic; color: #59636e; }
@media screen { body { max-width: 190mm; margin: 0 auto; padding: 10mm; } .wp, .toc, .section-title { border-top: 1px dashed #d0d7de; margin-top: 10mm; padding-top: 10mm; } .cover, .section-title { height: auto; min-height: 60mm; } }
`;

export function exportWikiPdf() {
  const sections = wikiSections();
  const slugs = new Set(sections.flatMap((s) => s.pages.map((p) => p.slug)));
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const toc = sections
    .map((s) => `<h2>${esc(s.title)}</h2><ol>${s.pages.map((p) => `<li><a href="#${pageId(p.slug)}">${esc(p.title)}</a></li>`).join('')}</ol>`)
    .join('');

  const body = sections
    .map((s) => {
      const pages = s.pages
        .map((p) => {
          const doc = new DOMParser().parseFromString(`<div>${renderPage(p.markdown, p.section)}</div>`, 'text/html');
          const root = doc.body.firstElementChild!;
          // Heading ids repeat across pages: make them unique to this page.
          for (const el of root.querySelectorAll('[id]')) el.id = `${pageId(p.slug)}--${el.id}`;
          for (const a of root.querySelectorAll('a')) {
            const wiki = a.getAttribute('data-wiki');
            const anchor = a.getAttribute('data-anchor');
            if (wiki && slugs.has(wiki)) a.setAttribute('href', `#${pageId(wiki)}${anchor ? `--${anchor}` : ''}`);
            else if (!wiki && anchor) a.setAttribute('href', `#${pageId(p.slug)}--${anchor}`);
          }
          for (const v of root.querySelectorAll('video')) {
            const note = doc.createElement('p');
            note.className = 'video-note';
            note.textContent = '(A video here: see this page in the app.)';
            v.replaceWith(note);
          }
          return `<section class="wp" id="${pageId(p.slug)}"><div class="wp__crumb">${esc(s.title)}</div>${root.innerHTML}</section>`;
        })
        .join('');
      return `<div class="section-title"><h1>${esc(s.title)}</h1></div>${pages}`;
    })
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/"><title>Insight Plan Wiki — ${esc(date)}</title><style>${CSS}</style></head><body>
<div class="cover"><div class="cover__mark"></div><h1>Insight Plan Wiki</h1><p>Standards and app guide · ${esc(date)}</p></div>
<div class="toc"><h1>Contents</h1>${toc}</div>
${body}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) throw new Error('The browser blocked the new window: allow pop-ups for this page and try again.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Print once the images have loaded (a missing one must not hold it up).
  const images = [...win.document.images];
  void Promise.all(images.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))).then(() => {
    win.focus();
    win.print();
  });
}
