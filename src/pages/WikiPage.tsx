import { FEATURES } from '../features';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersistedState, usePersistedStringSet } from '../utils/persistedState';
import { anchorOf, renderPage, wikiSections, type WikiPage as Page } from '../wiki/content';
import { exportWikiPdf } from '../wiki/exportPdf';
import { queryMatcher } from '../schedule/search';
import { ResizeHandle, useResizableWidth } from '../components/ResizeHandle';
import { IconExpander } from '../components/icons';

/** Wiki: the team's standards and the app guide — Markdown pages in the
    repo (docs/wiki, see wiki/content.ts), read here and edited here with a
    live preview; screenshots and videos are pasted or dropped in. Saved
    pages are files in this copy of the app: commit and push them to share
    them with the team (they then arrive with the app's updates). */

async function post<T>(path: string, body: BodyInit, json = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/wiki/${path}`, { method: 'POST', headers: json ? { 'Content-Type': 'application/json' } : undefined, body });
  } catch {
    throw new Error('Editing needs the app running with Autorun.bat / npm run dev.');
  }
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? (res.status === 404 ? 'Editing needs the app running with Autorun.bat / npm run dev.' : `Request failed (${res.status}).`));
  return out as T;
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export function WikiPage() {
  // Not memoised: a saved page comes back through Vite's hot update of the page files.
  const sections = wikiSections();
  const navWidth = useResizableWidth('wiki.navWidth', 300, 200, 560);
  const [slug, setSlug] = usePersistedState('wiki.page', 'standards/index');
  const [search, setSearch] = useState('');
  // Collapsed sections ("app-guide") and groups ("app-guide/Scheduling").
  const [collapsed, setCollapsed] = usePersistedStringSet('wiki.collapsed');
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingAnchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const all = sections.flatMap((s) => s.pages);
  const page: Page | undefined = all.find((p) => p.slug === slug) ?? all[0];
  const editing = draft !== null;
  const dirty = editing && draft !== page?.markdown;
  const html = useMemo(() => (page ? renderPage(editing ? draft! : page.markdown, page.section) : ''), [page, editing, draft]);

  const q = search.trim().toLowerCase();
  const hit = queryMatcher(search);
  const matches = (p: Page) => !q || hit(p.title) || hit(p.markdown);

  const go = (next: string, anchor?: string) => {
    if (dirty && !window.confirm('Discard the unsaved changes to this page?')) return;
    setDraft(null);
    setMessage(null);
    pendingAnchor.current = anchor ?? null;
    setSlug(next);
    if (!anchor) bodyRef.current?.scrollTo({ top: 0 });
  };

  // After navigating to "page#anchor", scroll the heading into view.
  useEffect(() => {
    const a = pendingAnchor.current;
    if (!a) return;
    pendingAnchor.current = null;
    requestAnimationFrame(() => document.getElementById(a)?.scrollIntoView({ block: 'start' }));
  }, [slug, html]);

  const onContentClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const wiki = a.getAttribute('data-wiki');
    const anchor = a.getAttribute('data-anchor');
    if (wiki) {
      e.preventDefault();
      if (all.some((p) => p.slug === wiki)) go(wiki, anchor ?? undefined);
      else setMessage({ kind: 'error', text: `There is no page "${wiki}" yet.` });
    } else if (anchor) {
      e.preventDefault();
      document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  const save = async () => {
    if (!page || draft === null) return;
    setBusy(true);
    try {
      await post('save', JSON.stringify({ slug: page.slug, markdown: draft }));
      setDraft(null);
      setMessage({ kind: 'ok', text: `Saved to docs/wiki/${page.slug}.md. Commit and push it to share it with the team.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const newPage = async (section: string) => {
    const title = window.prompt('Title of the new page:')?.trim();
    if (!title) return;
    const next = `${section}/${slugify(title) || 'page'}`;
    if (all.some((p) => p.slug === next)) return go(next);
    try {
      await post('save', JSON.stringify({ slug: next, markdown: `# ${title}\n\n` }));
      pendingAnchor.current = null;
      setSlug(next);
      setDraft(`# ${title}\n\n`);
      setMessage(null);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const remove = async () => {
    if (!page || page.page === 'index' || !window.confirm(`Delete the page "${page.title}"?`)) return;
    try {
      await post('delete', JSON.stringify({ slug: page.slug }));
      setDraft(null);
      setSlug(`${page.section}/index`);
      setMessage({ kind: 'ok', text: `Deleted docs/wiki/${page.slug}.md.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Pasted / dropped images and videos go to docs/wiki/media and into the page at the cursor. */
  const addMedia = async (files: File[]) => {
    const el = editorRef.current;
    if (!el || !files.length) return;
    setBusy(true);
    try {
      let insert = '';
      for (const f of files) {
        const res = await post<{ path: string }>(`media?name=${encodeURIComponent(f.name || `screenshot.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`)}`, f, false);
        const alt = (f.name || 'screenshot').replace(/\.[^.]+$/, '');
        insert += f.type.startsWith('video/') ? `\n<video controls src="${res.path}"></video>\n` : `![${alt}](${res.path})`;
      }
      const at = el.selectionStart;
      setDraft((d) => (d ?? '').slice(0, at) + insert + (d ?? '').slice(el.selectionEnd));
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const mediaFiles = (list: DataTransferItemList | FileList | null) =>
    [...(list ?? [])].map((x) => (x instanceof File ? x : x.kind === 'file' ? x.getAsFile() : null)).filter((f): f is File => !!f && /^(image|video)\//.test(f.type));

  // Headings of the page, for the "On this page" list.
  const headings = useMemo(() => [...(editing ? draft! : page?.markdown ?? '').matchAll(/^(##|###) (.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '') })), [page, editing, draft]);

  return (
    <div className="wiki">
      <nav className="wiki__nav" style={{ width: navWidth.width }}>
        <input className="wiki__search" type="search" placeholder="Search the wiki…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {sections.map((s) => {
          const pages = s.pages.filter(matches);
          if (q && !pages.length) return null;
          // Searching, or holding the open page, keeps a section / group open.
          const open = (key: string, holdsPage: boolean) => !!q || holdsPage || !collapsed.has(key);
          const sectionOpen = open(s.id, page?.section === s.id);
          const groups = [...new Set(pages.map((p) => p.group))];
          const link = (p: Page) => (
            <button key={p.slug} type="button" className={`wiki__link${p.slug === page?.slug ? ' active' : ''}${p.page === 'index' ? ' wiki__link--home' : ''}`} onClick={() => go(p.slug)}>
              {p.page === 'index' ? 'Overview' : p.title}
            </button>
          );
          return (
            <div key={s.id} className="wiki__section">
              <div className="wiki__section-head">
                <button type="button" className="wiki__toggle" aria-expanded={sectionOpen} onClick={() => toggle(s.id)}>
                  <span className="wiki__chevron"><IconExpander open={sectionOpen} /></span>
                  {s.title}
                </button>
                {FEATURES.serverFiles && <button type="button" className="wiki__new" onClick={() => void newPage(s.id)} title={`New page in ${s.title}`}>+ New page</button>}
              </div>
              {sectionOpen &&
                groups.map((g) => {
                  const inGroup = pages.filter((p) => p.group === g);
                  if (!g) return inGroup.map(link);
                  const key = `${s.id}/${g}`;
                  const groupOpen = open(key, inGroup.some((p) => p.slug === page?.slug));
                  return (
                    <div key={key} className="wiki__group">
                      <button type="button" className="wiki__group-head" aria-expanded={groupOpen} onClick={() => toggle(key)}>
                        <span className="wiki__chevron"><IconExpander open={groupOpen} /></span>
                        {g}
                        <span className="wiki__count">{inGroup.length}</span>
                      </button>
                      {groupOpen && <div className="wiki__group-pages">{inGroup.map(link)}</div>}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </nav>
      <ResizeHandle onMouseDown={navWidth.startDrag(false)} />

      <main className="wiki__main">
        <div className="wiki__bar">
          <span className="wiki__crumb">
            {sections.find((s) => s.id === page?.section)?.title} {page && page.page !== 'index' && <>› {page.title}</>}
          </span>
          {message && <span className={`wiki__msg wiki__msg--${message.kind}`}>{message.text}</span>}
          <span className="wiki__actions">
            {editing ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => (!dirty || window.confirm('Discard the unsaved changes?')) && setDraft(null)}>Cancel</button>
                <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>Save</button>
              </>
            ) : (
              page && (
                <>
                  <button
                    type="button"
                    className="btn"
                    title="Every wiki page as one document (cover, contents, a page per sheet): opens the print dialog — choose Save as PDF"
                    onClick={() => {
                      try {
                        exportWikiPdf();
                      } catch (e) {
                        setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
                      }
                    }}
                  >
                    Export PDF
                  </button>
                  {FEATURES.seatable && (page.section === 'assumptions' || page.section === 'calculations') && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      title="Copy this section into its SeaTable table (Assumptions: the rows with an ASM-nnn Ref; Calculations: one row per calculation page): existing rows are updated by Ref, new ones added"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await fetch(`/api/seatable/${page.section}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                          const out = await r.json().catch(() => ({}));
                          if (!r.ok) throw new Error(out.error ?? `SeaTable bridge: ${r.status}`);
                          setMessage({ kind: 'ok', text: `SeaTable ${page.section === 'calculations' ? 'Calculations' : 'Assumptions'}: ${out.added} added, ${out.updated} updated.` });
                        } catch (e) {
                          setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Sync to SeaTable
                    </button>
                  )}
                  {FEATURES.serverFiles && page.page !== 'index' && <button type="button" className="btn" onClick={() => void remove()}>Delete</button>}
                  {FEATURES.serverFiles && <button type="button" className="btn primary" onClick={() => { setDraft(page.markdown); setMessage(null); }}>Edit</button>}
                </>
              )
            )}
          </span>
        </div>

        <div className={`wiki__body${editing ? ' wiki__body--editing' : ''}`} ref={bodyRef}>
          {editing && (
            <div className="wiki__editor">
              <textarea
                ref={editorRef}
                value={draft!}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const files = mediaFiles(e.clipboardData.items);
                  if (files.length) {
                    e.preventDefault();
                    void addMedia(files);
                  }
                }}
                onDrop={(e) => {
                  const files = mediaFiles(e.dataTransfer.files);
                  if (files.length) {
                    e.preventDefault();
                    void addMedia(files);
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    void save();
                  }
                }}
                spellCheck
              />
              <div className="wiki__hint">
                Markdown: # Heading, **bold**, - list, | table |, [link](other-page.md). A &lt;!-- group: Name --&gt; line files the page under that group in the menu. Paste or drop screenshots and videos. Ctrl+S saves. Saved pages are files in this copy of the app (docs/wiki): commit and push to share them — a copy with unshared edits is not updated from the app.
              </div>
            </div>
          )}
          {page ? (
            <article className="wiki__content md" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="wiki__content">No pages yet.</div>
          )}
          {!editing && headings.length > 2 && (
            <aside className="wiki__toc">
              <div className="wiki__toc-title">On this page</div>
              {headings.map((h, i) => (
                <a key={i} href={`#${anchorOf(h.text)}`} className={h.level === 3 ? 'wiki__toc-sub' : undefined} onClick={(e) => { e.preventDefault(); document.getElementById(anchorOf(h.text))?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
                  {h.text}
                </a>
              ))}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
