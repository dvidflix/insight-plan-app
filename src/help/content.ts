import { renderMarkdown } from '../wiki/render';

/** The Help tab's pages: Markdown files in docs/help, written for the people who use the app (not the team's wiki).
    A page's title is its first "# " heading; a first-line comment <!-- order: n --> places it in the menu. */

const RAW = import.meta.glob('/docs/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface HelpTopic {
  slug: string;
  title: string;
  order: number;
  markdown: string;
}

/** THIRD-PARTY-LICENSES.json (npm run licenses): every production dependency with its licence. Read through the bundler, so no JSON typing is needed. */
const LICENCE_FILE = import.meta.glob('/THIRD-PARTY-LICENSES.json', { import: 'default', eager: true }) as Record<string, unknown>;
interface PackageLicence {
  name: string;
  licenses: string;
  repository: string | null;
}

/** "@scope/pkg@1.2.3" -> its name and version. */
const splitName = (full: string) => {
  const at = full.lastIndexOf('@');
  return at > 0 ? { pkg: full.slice(0, at), version: full.slice(at + 1) } : { pkg: full, version: '' };
};

/** Components that are not npm packages (or that need a word more than their licence line). */
const OTHER_COMPONENTS: { name: string; use: string; licence: string; note: string }[] = [
  { name: 'Modus Icons (Trimble)', use: 'Many of the toolbar and panel icons', licence: 'MIT', note: 'Icons named modus-icon-* in the app.' },
  { name: 'Material Design Icons (Google)', use: 'Some interface icons', licence: 'Apache-2.0', note: 'Drawn from the Material icon set.' },
  { name: 'Phosphor Icons', use: 'A few interface icons', licence: 'MIT', note: 'For example the tree-structure icon.' },
  { name: 'web-ifc WebAssembly files', use: 'Reading IFC files in the browser', licence: 'MPL-2.0', note: 'Shipped with the app (public/wasm); the web-ifc package above.' },
  { name: 'SQLite WebAssembly (sqlite.org)', use: 'The project database in the browser', licence: 'Apache-2.0', note: 'The @sqlite.org/sqlite-wasm package above.' },
  { name: 'IFC, BIM and BCF', use: 'Names of open standards', licence: 'Trademarks', note: 'IFC and BCF are standards of buildingSMART International; the buildingSMART logo belongs to it.' },
];

/** The Licences page, built from the licence file so it never goes out of date: a summary by licence, the packages, and the other components. */
function licencesTopic(): HelpTopic | null {
  const rows = ((Object.values(LICENCE_FILE)[0] ?? []) as PackageLicence[]).filter((r) => r && typeof r.name === 'string');
  if (rows.length === 0) return null;
  const byLicence = new Map<string, number>();
  for (const r of rows) byLicence.set(r.licenses, (byLicence.get(r.licenses) ?? 0) + 1);
  const cell = (s: string) => s.replace(/\|/g, '/');
  const lines: string[] = [
    '<!-- order: 10 -->',
    '# Licences and credits',
    '',
    'Insight Plan is built on open-source software and open standards. This page lists what it uses, under which licence, and where to read the licence in full. The list comes from the build of this version, so it matches what you are running.',
    '',
    '## Summary',
    '',
    '| Licence | Packages |',
    '| --- | --- |',
    ...[...byLicence].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `| ${cell(l)} | ${n} |`),
    '',
    'Where a package offers a choice of licences, for example **(MIT OR GPL-3.0-or-later)**, Insight Plan uses it under the permissive one (MIT, or Apache-2.0 where it is offered). **MPL-2.0** packages (web-ifc, and dompurify where it is used under that licence) keep their own source files open: Insight Plan does not change them, and their source is at the link in the table.',
    '',
    `## Libraries (${rows.length})`,
    '',
    '| Package | Version | Licence | Source |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => {
      const { pkg, version } = splitName(r.name);
      return `| ${cell(pkg)} | ${cell(version)} | ${cell(r.licenses)} | ${r.repository ? `[${cell(r.repository.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, ''))}](${r.repository})` : ''} |`;
    }),
    '',
    '## Other components',
    '',
    '| Component | Used for | Licence | Note |',
    '| --- | --- | --- | --- |',
    ...OTHER_COMPONENTS.map((c) => `| ${c.name} | ${c.use} | ${c.licence} | ${c.note} |`),
    '',
    '## Full licence texts',
    '',
    `Each package's copyright notice and licence text, as the licences ask: [open the notices file](${import.meta.env.BASE_URL}THIRD-PARTY-NOTICES.txt). It is also shipped as THIRD-PARTY-NOTICES.txt with the app.`,
    '',
    '## Your files',
    '',
    'Your IFC models, programmes and everything else you load stay yours. They are read in your own browser or on your own machine, and the licences above do not apply to them.',
    '',
  ];
  const markdown = lines.join('\n');
  return { slug: 'licences', title: 'Licences and credits', order: 10, markdown };
}

export function helpTopics(): HelpTopic[] {
  const extra = licencesTopic();
  return [...pageTopics(), ...(extra ? [extra] : [])].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function pageTopics(): HelpTopic[] {
  return Object.entries(RAW)
    .map(([file, markdown]) => {
      const slug = /\/([^/]+)\.md$/.exec(file)![1];
      return {
        slug,
        title: /^#\s+(.+)$/m.exec(markdown)?.[1].trim() ?? slug,
        order: Number(/^<!--\s*order:\s*(-?\d+)\s*-->/.exec(markdown)?.[1] ?? 1000),
        markdown,
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Links between help pages are written `[text](other-page.md#heading)`. */
export const renderHelp = (markdown: string) => renderMarkdown(markdown, 'help');
