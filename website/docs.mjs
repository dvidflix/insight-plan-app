// Reads the customer help (docs/help/*.md, the same text as the app's Help tab) and turns it into website pages, so the two never drift apart.
// Used by build.mjs. No dependencies: the Markdown the help uses is small (headings, paragraphs, lists, tables, bold, code, links).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HELP_DIR = path.join(import.meta.dirname, '..', 'docs', 'help');

/** The groups of the side menu, in order: [group title, [file names]]. A file not listed lands in "More". */
const GROUPS = [
  ['Start here', ['getting-started', 'inputs']],
  ['Models', ['models', 'models-side-pane']],
  ['Programmes', ['programmes', 'planning-tools']],
  ['Programme and model together', ['4d-sequencing']],
  ['Reference', ['settings-and-tips', 'your-data']],
];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugify = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const docUrl = (slug) => `docs-${slug}.html`;

/** Bold, italic, code and links inside one line of text. Links to another .md file become links to its page. */
function inline(text) {
  const codes = [];
  let t = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const md = href.match(/^([\w-]+)\.md(#.*)?$/);
      return `<a href="${md ? docUrl(md[1]) + (md[2] ?? '') : href}">${label}</a>`;
    });
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** One Markdown file -> { title, html, toc }. The first "# " is the title; each "## " becomes a section of the page contents. */
export function renderMarkdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  const toc = [];
  let title = '';
  let para = [];
  let list = []; // open lists: { tag, indent }
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const closeLists = (toIndent = -1) => { while (list.length && list[list.length - 1].indent > toIndent) out.push(`</li></${list.pop().tag}>`); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    if (!line.trim()) { flushPara(); closeLists(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); closeLists();
      const level = h[1].length, text = h[2].trim();
      if (level === 1) { title = text.replace(/[*`]/g, ''); continue; }
      const id = slugify(text);
      if (level === 2) toc.push({ id, text: text.replace(/[*`]/g, '') });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }

    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      flushPara(); closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      let rows = '';
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows += `<tr>${cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`; i++; }
      i--;
      out.push(`<div class="doc-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flushPara();
      const indent = li[1].length, tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      const top = list[list.length - 1];
      if (!top || indent > top.indent) { out.push(`<${tag}><li>`); list.push({ tag, indent }); }
      else { closeLists(indent); const cur = list[list.length - 1]; if (cur && cur.indent === indent) out.push('</li><li>'); else { out.push(`<${tag}><li>`); list.push({ tag, indent }); } }
      out.push(inline(li[3]));
      continue;
    }

    if (list.length && /^\s+\S/.test(line)) { out.push(' ' + inline(line.trim())); continue; } // a wrapped list item
    closeLists();
    para.push(line.trim());
  }
  flushPara(); closeLists();
  return { title, html: out.join('\n'), toc };
}

/** Every help page, in reading order, with the group it belongs to. */
export function loadDocs() {
  const docs = readdirSync(HELP_DIR).filter((f) => f.endsWith('.md')).map((f) => {
    const src = readFileSync(path.join(HELP_DIR, f), 'utf8');
    const slug = f.replace(/\.md$/, '');
    const order = Number(src.match(/<!--\s*order:\s*(\d+)\s*-->/)?.[1] ?? 99);
    const { title, html, toc } = renderMarkdown(src);
    const summary = (html.match(/<p>(.*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g, '');
    return { slug, order, title, html, toc, summary, group: GROUPS.find(([, files]) => files.includes(slug))?.[0] ?? 'More' };
  });
  return docs.sort((a, b) => a.order - b.order);
}

export const DOC_GROUPS = [...GROUPS.map(([g]) => g), 'More'];
