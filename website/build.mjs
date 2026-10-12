// Generates the static pages of the website (no dependencies):  node website/build.mjs
// Edit the text and prices here, run it, then copy the website folder (without build.mjs) to the NAS.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { appWindow, building, clash, curves } from './visuals.mjs';
import { EXAMPLES } from './examples.mjs';
import { DOC_GROUPS, docUrl, loadDocs } from './docs.mjs';

const OUT = import.meta.dirname;
const SITE = 'Insight Plan';
const CONTACT = 'support@insight-plan.com'; // <- your contact address
/** Where the contact form posts its answers. On Cloudflare Pages this is the small worker in website/cloudflare/_worker.js, which emails the message to you.
    If the post fails (or the site is hosted somewhere without that worker), the form falls back to opening the visitor's email program with the message filled in.
    Set it to '' to always use the email program. */
const FORM_ENDPOINT = '/api/contact';
/** Optional bot check: the site key of a free Cloudflare Turnstile widget (the secret key goes in the Cloudflare project as TURNSTILE_SECRET). Empty: no check beyond the hidden field. */
const TURNSTILE_SITEKEY = '';
/** Live chat: paste the address of the chat service's script (Tawk.to, Crisp, Tidio and similar give you one) and every page loads it.
    Left empty, no chat appears. A chat service is a third party that sees what visitors type. */
const CHAT_SCRIPT = '';
/** Social profiles: put the address of each page you have. An icon shows only for the ones filled in; the email icon always shows. */
const SOCIAL = { linkedin: '', facebook: '', x: '', youtube: '', instagram: '', github: '' };

/** Indicative prices: confirm them before publishing. */
const PRICING = {
  currency: '£',
  note: 'per user, per year',
  programmes: 1000,
  models: 1000,
  complete: 1800,
  /** The saving the pricing page works through: 200 planning or model days out of 252 working days, 15 minutes saved a day, at these hourly costs. */
  assume: { days: 200, workingDays: 252, minutesPerDay: 15, rates: [25, 30] },
  trialDays: 30,
};

const NAV = [
  ['features.html', 'Features'],
  ['examples.html', 'Examples'],
  ['solutions.html', 'Solutions'],
  ['alternatives.html', 'Compare'],
  ['pricing.html', 'Pricing'],
  ['resources.html', 'Resources'],
];

// The supplied logo for now: the mark (logo-mark.png) and the name (logo-name.png), both with transparent backgrounds.
const LOGO = '<img class="logo__mark" src="logo-mark.png" alt="" width="374" height="363"><img class="logo__name" src="logo-name.png" alt="Insight Plan" width="700" height="147">';

const icon = (d) => `<div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg></div>`;
const ICONS = {
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  gantt: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="12" height="4" rx="1"/><rect x="3" y="16" width="16" height="4" rx="1"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  table: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/>',
  loop: '<path d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2.2-2.2A5 5 0 1 0 17 14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/>',
  clash: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  compare: '<path d="M8 3H4v18h4M16 3h4v18h-4M12 3v18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.7.4-1 .9-1 1.700M12 17h.01"/>',
  folders: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 11h18"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.200"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.500-2"/>',
  users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0"/><path d="M16 4.800a3.500 3.500 0 0 1 0 6.400M18.500 14.500A6.500 6.500 0 0 1 21.500 20"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.500h.01M7 16.500h.01"/>',
  wand: '<path d="M5 19L17 7"/><path d="M15 4v3M19 8h-3M18.500 4.500l-2 2M5 5v2M4 6h2"/>',
  power: '<path d="M12 3v9"/><path d="M6.500 6.500a8 8 0 1 0 11 0"/>',
};

// The Products menu: the three licences, each with what it is for, and a way to choose.
const MENU = [
  ['gantt', 'Programmes', 'programmes', 'Check, compare and analyse your programmes.'],
  ['cube', 'Models', 'models', 'Check, clash-test and review your IFC models, with BCF topics.'],
  ['link', 'Programmes + Models', 'complete', 'Link them for 4D and two-way selection.'],
];
const menu = (file) => `<div class="menu"><button type="button" class="menu__btn" aria-expanded="false" aria-haspopup="true" aria-controls="menu-panel">Products<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.500l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="menu__panel" id="menu-panel"><p class="menu__title">Licences</p>
      <div class="menu__grid">${MENU.map(([ic, name, id, text]) => `<a class="menu__item" href="pricing.html#${id}">${icon(ICONS[ic])}<span><b>${name}</b><span>${text}</span></span></a>`).join('')}
      <a class="menu__help" href="pricing.html#licences">${icon(ICONS.help)}<span><b>Which licence do I need?</b><span>Compare what each includes <i aria-hidden="true">&rarr;</i></span></span></a></div>
    </div></div>`;
// The Resources menu: where to learn, and who we are.
const RESOURCES_MENU = [
  ['Learn', [['docs.html', 'Documentation'], ['resources.html', 'Questions and answers'], ['resources.html#requirements', 'System requirements'], ['resources.html#data', 'Data handling'], ['alternatives.html', 'Compare with other tools']]],
  [SITE, [['about.html', 'About us'], ['contact.html', 'Contact']]],
];
const resourcesMenu = () => `<div class="menu menu--list"><button type="button" class="menu__btn" aria-expanded="false" aria-haspopup="true">Resources<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="menu__panel menu__panel--list">${RESOURCES_MENU.map(([t, links]) => `<p class="menu__title">${t}</p><div class="menu__links">${links.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>`).join('')}</div></div>`;
const MENU_SCRIPT = `<script>(() => { const hdr = document.querySelector('header.top'), tg = hdr.querySelector('.navtoggle'); tg.addEventListener('click', () => { const o = !hdr.classList.contains('nav-open'); hdr.classList.toggle('nav-open', o); tg.setAttribute('aria-expanded', String(o)); }); const menus = [...document.querySelectorAll('.menu')]; const set = (m, o) => { m.classList.toggle('open', o); m.querySelector('.menu__btn').setAttribute('aria-expanded', String(o)); }; menus.forEach((m) => m.querySelector('.menu__btn').addEventListener('click', () => { const open = !m.classList.contains('open'); menus.forEach((x) => set(x, false)); set(m, open); })); document.addEventListener('click', (e) => menus.forEach((m) => { if (!m.contains(e.target)) set(m, false); })); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menus.forEach((m) => set(m, false)); }); })();</script>`;

// Social icons, drawn here (no external files). Only the profiles with an address in SOCIAL are shown.
const SOC = {
  linkedin: ['LinkedIn', '<rect x="3" y="9" width="4" height="12" rx=".5"/><circle cx="5" cy="5" r="2"/><path d="M10 9h4v2c.8-1.400 2.200-2.300 4-2.300 3 0 4 2 4 5V21h-4v-6c0-1.500-.5-2.500-2-2.500S14 13.500 14 15v6h-4z"/>', 'fill'],
  facebook: ['Facebook', '<path d="M14 21v-8h3l.5-3.500H14V7.500c0-1 .4-1.800 1.900-1.800H17.700V2.600C17.300 2.500 16.300 2.400 15.200 2.400 12.500 2.400 10.600 4 10.600 7v2.500H7.500V13h3.100v8z"/>', 'fill'],
  x: ['X', '<path d="M4 4l16 16M20 4L4 20"/>', 'line'],
  youtube: ['YouTube', '<rect x="2.500" y="5.500" width="19" height="13" rx="4"/><path d="M10 9.500v5l4.500-2.500z" class="solid"/>', 'line'],
  instagram: ['Instagram', '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.200" cy="6.800" r=".6" class="solid"/>', 'line'],
  github: ['GitHub', '<circle cx="6" cy="5.500" r="2.200"/><circle cx="6" cy="18.500" r="2.200"/><circle cx="18" cy="9" r="2.200"/><path d="M6 7.700v8.600M18 11.200c0 3-3 4-7 4.300-2 .2-5 .6-5 .8"/>', 'line'],
};
const social = () => `<div class="social" aria-label="Find us online">${Object.entries(SOC).filter(([k]) => SOCIAL[k]).map(([k, [name, d, mode]]) => `<a href="${SOCIAL[k]}" rel="noopener me" aria-label="${name}" title="${name}"><svg viewBox="0 0 24 24" class="social__${mode}" aria-hidden="true">${d}</svg></a>`).join('')}<a href="mailto:${CONTACT}" aria-label="Email us" title="Email us"><svg viewBox="0 0 24 24" class="social__line" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.500"/><path d="M3.500 7.500l8.500 6 8.500-6"/></svg></a></div>`;

const page = ({ file, title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="favicon.png" type="image/png">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="logo" href="index.html" aria-label="Insight Plan home">${LOGO}</a>
    <button type="button" class="navtoggle" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="navtoggle__bars" d="M4 6.500h16M4 12h16M4 17.500h16"/><path class="navtoggle__x" d="M6 6l12 12M18 6L6 18"/></svg></button>
    <nav id="site-nav">
      ${menu(file)}
      ${NAV.filter(([href]) => href !== 'resources.html').map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
      ${resourcesMenu()}
      <a href="contact.html"${file === 'contact.html' ? ' aria-current="page"' : ''}>Contact</a>
      <a class="btn" href="contact.html">Free trial</a>
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="sitefoot">
  <div class="wrap sitefoot__top">
    <div class="sitefoot__brand"><a class="logo" href="index.html" aria-label="Insight Plan home">${LOGO}</a><p>4D planning for complex construction.<br>Works offline, and keeps your data on your machine.</p>${social()}</div>
    <nav class="sitefoot__cols" aria-label="Footer">
      <div><strong>Product</strong><a href="features.html">Features</a><a href="examples.html">Examples</a><a href="solutions.html">Solutions</a><a href="alternatives.html">Compare</a><a href="pricing.html">Pricing</a></div>
      <div><strong>Resources</strong><a href="docs.html">Documentation</a><a href="resources.html">Questions and answers</a><a href="resources.html#requirements">System requirements</a><a href="resources.html#data">Data handling</a></div>
      <div><strong>Company</strong><a href="about.html">About us</a><a href="contact.html">Contact</a><a href="contact.html">Start a free trial</a></div>
    </nav>
  </div>
  <div class="wrap sitefoot__bottom"><span>&copy; <span id="y">2026</span> ${SITE}</span><span>Primavera and P6 are trademarks of Oracle; ${SITE} is not affiliated with Oracle.</span></div>
</footer>
${MENU_SCRIPT}
<script>document.getElementById('y').textContent = new Date().getFullYear();</script>
${CHAT_SCRIPT ? `<script src="${CHAT_SCRIPT}" async></script>` : ''}
</body>
</html>
`;

const head = (tag, h1, lead) => `<div class="wrap pagehead">${tag ? `<span class="tag">${tag}</span>` : ''}<h1>${h1}</h1><p class="lead">${lead}</p></div>`;
const cta = `<section class="contact"><div class="wrap"><h2>Try it free on a real project</h2><p class="sub">Bring a live programme and its model. We will send you a trial key, help you set up if you like, and show what it finds.</p><a class="btn" href="contact.html">Start a free trial</a></div></section>`;


const card = (ic, h, p, extra = '') => `<div class="card">${icon(ICONS[ic])}<h3>${h}${extra}</h3><p>${p}</p></div>`;
const exp = ' <span class="soon">Experimental</span>';

const pages = [];

// ---------------------------------------------------------------- Home
const row = (flip, kicker, h, p, bullets, visual) => `<section class="feature${flip ? ' flip' : ''}"><div class="wrap split">
  <div><span class="kicker">${kicker}</span><h2>${h}</h2><p class="sub" style="margin-bottom:0">${p}</p>${bullets ? `<ul class="ticks">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}</div>
  <div class="visual">${visual}</div>
</div></section>`;



// The four key advantages, as a light strip right under the hero. Thin outline icons that say what each one is about.
const UI = (d) => `<svg class="usp__icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const USPS = [
  // a programme (bars) and a model (cube) that can be used apart or joined
  [UI('<rect x="3" y="6" width="12" height="4" rx="2"/><rect x="5" y="14" width="12" height="4" rx="2"/><rect x="8" y="22" width="9" height="4" rx="2"/><path d="M24 14l5 3v6l-5 3-5-3v-6z"/><path d="M24 20v6M19 17l5 3 5-3"/>'), 'Together or on their own', 'Use a programme or a model alone, or link them so the model tests the programme.'],
  // a checklist
  [UI('<rect x="6" y="4" width="20" height="24" rx="3"/><path d="M11 11l2 2 3-3.5M11 19l2 2 3-3.5M19 12h3M19 20h3"/>'), 'The checks planners need', 'DCMA programme checks, IDS model checks and clash detection, in one place.'],
  // one building, two views side by side
  [UI('<rect x="3" y="6" width="26" height="20" rx="3"/><path d="M16 6v20"/><path d="M7 21v-6l3-2 3 2v6M20 21v-9l3-2 3 2v9"/>'), 'Two sequences, one building', 'Two scenarios side by side at the same date, so you see where they differ.'],
  // a shield with a lock: private, on your machine
  [UI('<path d="M16 3l11 4v8c0 7-4.5 11.5-11 14C9.5 26.500 5 22 5 15V7z"/><rect x="12" y="14" width="8" height="7" rx="1.5"/><path d="M14 14v-2.500a2 2 0 014 0V14"/>'), 'Yours alone', 'Works offline. Programmes and models never leave your machine.'],
];
const usps = () => `<section class="usps"><div class="wrap usps__grid">${USPS.map(([ic, h, p]) => `<div class="usp">${ic}<h3>${h}</h3><p>${p}</p></div>`).join('')}</div></section>`;


// How it works: four steps for a first-time visitor, and the file formats it reads.
const STEPS = [
  ['Load', 'Drop in a programme, a model, or both.'],
  ['Check', 'Programme checks, IDS model checks and clash detection.'],
  ['Link', 'Join activities to objects by rules. The model then shows which predecessors are missing.'],
  ['Play', 'Step through the build date by date, or compare two sequences.'],
];
// Supported file formats: our own file icons (a page with a corner fold and a small picture of what is inside), coloured by kind.
// The format names are plain text; the logos of other companies are not used.
const FMT_GLYPH = {
  gantt: '<rect x="8" y="14" width="9" height="2.600" rx="1.300"/><rect x="11" y="19" width="9" height="2.600" rx="1.300"/><rect x="14" y="24" width="7" height="2.600" rx="1.300"/>',
  table: '<path d="M9 15h14M9 20h14M9 25h14M15 12v15"/>',
  cube: '<path d="M16 12l7 3.500v8L16 27l-7-3.500v-8z"/><path d="M9 15.500l7 3.500 7-3.500M16 19v8"/>',
  site: '<path d="M8 26l5-8 4 5 3-3 4 6z"/>',
  text: '<path d="M9 15h14M9 20h14M9 25h9"/>',
};
const fmtIcon = (kind, glyph) => `<svg class="fmt__icon fmt__icon--${kind}" viewBox="0 0 32 36" aria-hidden="true"><path class="fmt__page" d="M5 2h15l8 8v24H5z"/><path class="fmt__fold" d="M20 2v8h8"/><g class="fmt__glyph">${FMT_GLYPH[glyph]}</g></svg>`;
const FORMATS = [
  ['Programmes', 'prog', [['P6 XER', '.xer', 'gantt'], ['P6 XML', '.xml', 'gantt'], ['MS Project XML', '.xml', 'gantt'], ['Excel', '.xlsx', 'table'], ['CSV', '.csv', 'text']]],
  ['Models', 'model', [['IFC', '.ifc', 'cube'], ['FRAG', '.frag', 'cube']]],
  ['Site context', 'site', [['glTF', '.glb', 'site']]],
];
const formats = () => `<div class="fmts" aria-label="Supported file formats">
    <span class="fmts__label">Reads the files you already have</span>
    <div class="fmts__groups">${FORMATS.map(([name, kind, items]) => `<div class="fmts__group"><i>${name}</i><div class="fmts__items">${items.map(([n, ext, g]) => `<span class="fmt">${fmtIcon(kind, g)}<b>${n}</b><code>${ext}</code></span>`).join('')}</div></div>`).join('')}</div>
  </div>`;
const steps = () => `<section class="steps"><div class="wrap">
  <h2 class="steps__title">How it works</h2>
  <ol class="steps__list">${STEPS.map(([h, p], i) => `<li><span class="steps__n">${i + 1}</span><div><b>${h}</b><span>${p}</span></div></li>`).join('')}</ol>
  ${formats()}
</div></section>`;


// Small pictures for the revision tiles: links that re-run, and what a revision changed.
const linkViz = () => `<div class="miniviz" role="img" aria-label="Links re-run after a revision and list what is left unlinked">
  <div class="miniviz__head">After revision C <b>re-run</b></div>
  <div class="miniviz__row"><span>Wall W-031</span><i>&rarr;</i><span>Pour 14</span><em class="ok">Linked</em></div>
  <div class="miniviz__row"><span>Slab S-012</span><i>&rarr;</i><span>Pour 15</span><em class="ok">Linked</em></div>
  <div class="miniviz__row"><span>Wall W-044</span><i>&rarr;</i><span>Pour 16</span><em class="ok">Linked</em></div>
  <div class="miniviz__row warn"><span>Beam B-204</span><i>&rarr;</i><span>&mdash;</span><em class="warn">Unlinked</em></div>
</div>`;
const changeViz = () => `<div class="miniviz" role="img" aria-label="Dates that a revision moved, compared with the baseline">
  <div class="miniviz__head">Baseline <b>against</b> revision C</div>
  <div class="miniviz__row"><span>Pour 14 finish</span><i>12 Mar</i><span>19 Mar</span><em class="warn">+7 d</em></div>
  <div class="miniviz__row"><span>Pour 15 finish</span><i>26 Mar</i><span>2 Apr</span><em class="warn">+7 d</em></div>
  <div class="miniviz__row"><span>Pour 21 finish</span><i>14 May</i><span>14 May</span><em class="ok">same</em></div>
  <div class="miniviz__row"><span>Practical completion</span><i>9 Jul</i><span>23 Jul</span><em class="warn">+14 d</em></div>
</div>`;


// The main difference: the model's geometry used as evidence about the programme's logic.
const geoViz = () => `<div class="miniviz" role="img" aria-label="Missing predecessors for an activity, with the contact found in the model">
  <div class="miniviz__head">Level 3 slab pour: <b>missing predecessors (2)</b></div>
  <div class="miniviz__row"><span>Level 2 slab pour</span><i>3 pairs</i><span>gap 0.00 m</span><em class="warn">Pour below</em></div>
  <div class="miniviz__row"><span>Wall W-12 pour</span><i>2 pairs</i><span>gap 0.00 m</span><em class="warn">Wall beside</em></div>
  <div class="miniviz__head" style="margin-top:8px">The programme has no link for either.</div>
</div>`;
const geoBlock = () => `<section class="tiles tiles--key"><div class="wrap tiles__grid tiles__grid--solo">${tile('The difference', 'Check the programme against the model, not just against itself.', 'Insight Plan reads where objects sit in the model: which pour is below, which wall stands beside. Where the model says one thing depends on another and the programme has no link, it lists the missing predecessor with the contact it found.', ['Missing predecessors for each activity, with the evidence: below or beside, pairs touching, closest gap', 'Built for concrete pours and walls; the same contacts also feed clash detection', 'Play the corrected sequence in 4D so everyone sees the consequence'], geoViz(), true)}</div></section>`;

// Two feature tiles side by side, as rounded rectangles: text on the left of each, the picture on the right (or under it when narrow).
const tile = (kicker, h, p, bullets, visual, wide = false) => `<article class="tile${wide ? ' tile--wide' : ''}"><div class="tile__body">
  <div class="tile__text"><span class="kicker">${kicker}</span><h2>${h}</h2><p>${p}</p>${bullets ? `<ul class="ticks">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}</div>
  <div class="tile__visual">${visual}</div>
</div></article>`;
const tileSolo = (a) => `<section class="tiles"><div class="wrap tiles__grid tiles__grid--solo">${a}</div></section>`;
const tilePair = (a, b) => `<section class="tiles"><div class="wrap tiles__grid">${a}${b}</div></section>`;

// Two sequences of the same building at the same date, side by side with a divider.
const splitViz = () => `<div class="splitviz" role="img" aria-label="Two sequences of the same building at the same date, side by side">
  <figure>${building({ phase: 4, width: 220 })}<figcaption>Baseline</figcaption></figure>
  <i class="splitviz__bar"></i>
  <figure>${building({ phase: 7, width: 220 })}<figcaption>New sequence</figcaption></figure>
  <span class="splitviz__date">14 Oct 2029</span>
</div>`;

// ---- How it compares: where Insight Plan overlaps with the tools planners already use.
const YES = '<span class="cmp-yes">Yes</span>';
const COMPARE_ROWS = [
  ['Built for', 'Investigating programmes and models, together or on their own', 'Building and controlling the programme', 'Model review and coordination', 'Cloud collaboration on shared models and documents'],
  ['Runs offline, data stays on your machine', YES, 'Desktop edition: yes', YES, 'Cloud service'],
  ['Programme and model in one view', YES, 'Programme only', 'Programme imported into the timeline', 'Models and documents'],
  ['Programme analysis: DCMA checks, float, what-if', YES, YES, 'Not its focus', 'Not its focus'],
  ['Risk (Monte Carlo) finish dates', YES, 'Separate risk product', 'Not its focus', 'Not its focus'],
  ['4D playback of the build', YES, 'Not included', YES, 'Not its focus'],
  ['Clash detection within and between models', YES, 'Not included', YES, 'Depends on plan'],
  ['Rules that re-link activities after each revision', YES, 'Not included', 'Rules by selection set name', 'Not its focus'],
  ['Concrete and rebar peaks from programme resources', YES, 'Resource histograms, no model link', 'Not its focus', 'Not its focus'],
  ['Anonymise a programme to share it', YES, 'Not included', 'Not applicable', 'Not applicable'],
];
const compareTable = () => `<section class="alt"><div class="wrap">
  <h2>How it compares</h2>
  <p class="sub">Primavera P6, Navisworks and Trimble Connect each do far more than is listed here. This is where ${SITE} overlaps with them, and where it goes further for planners.</p>
  <div class="cmp-wrap"><table class="cmp">
    <thead><tr><th scope="col"></th><th scope="col" class="cmp-us">${SITE}</th><th scope="col">Primavera P6</th><th scope="col">Navisworks</th><th scope="col">Trimble Connect</th></tr></thead>
    <tbody>${COMPARE_ROWS.map(([what, ...cells]) => `<tr><th scope="row">${what}</th>${cells.map((c, i) => `<td${i === 0 ? ' class="cmp-us"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="note" style="margin-top:18px">Based on the vendors' published features. Editions, plans and add-ons differ, so check each vendor for your set-up. Primavera, P6, Navisworks and Trimble Connect are trademarks of their owners; ${SITE} is not affiliated with them.</p>
</div></section>`;

const stat = (big, small) => `<div class="stat"><b>${big}</b><span>${small}</span></div>`;

// ---- The case for the price: time, reassurance, ease of use, upkeep. Used on the home and pricing pages.
const money = (v) => `${PRICING.currency}${Number(v).toLocaleString('en-GB')}`;
const WORTH = [
  ['clock', 'Hours back, every revision', 'Comparing two programmes, re-linking a model, finding the resource peak and building the 4D sequence are all done by hand today, in spreadsheets and across several tools. Here each one is a few clicks, and it re-runs when the next revision arrives.'],
  ['shield', 'Know before the site does', 'Programme checks to the DCMA 14 points, model checks to IDS, clash detection, and a check of the programme against the model itself. Every finding shows its evidence, so you can stand behind it in a meeting.'],
  ['wand', 'Easy from the first hour', 'Drop in the files you already have: P6 XER or XML, MS Project XML, Excel, IFC. Filters, grouping, sorting and colour work the same way everywhere. The guide is inside the app, and there is no scripting and no set-up project.'],
  ['power', 'Nothing to look after', 'No server, no database to administer, no sign-in and no IT project. Install it from Chrome or Edge, and it works offline. Each project is one open SQLite file. Updates arrive when you open the app.'],
];
const worth = (lead = 'Why it is worth it') => `<section class="alt worth"><div class="wrap">
  <h2>${lead}</h2>
  <p class="sub">A planner's time is the expensive part of a project. ${SITE} takes the slow, error-prone work out of it, and gives you something you can show to prove it.</p>
  <div class="grid grid--four">${WORTH.map(([ic, h, p]) => card(ic, h, p)).join('')}</div>
</div></section>`;

// ---- The working pattern, today and with Insight Plan: the same six stages in two rows, with the gain between them.
const FLOW = [
  ['loop', 'A revision arrives', 'Export from the scheduler and from the model tool.', 'Drop the new files in.', 'No exports'],
  ['compare', 'What changed?', 'Put two exports side by side in Excel and compare by eye.', 'Overlay the programmes: the dates that moved, ranked.', 'Hours back'],
  ['link', 'Link programme and model', 'Match activities to objects by hand in a spreadsheet.', 'Rules link them, and list what is left over.', 'No re-matching'],
  ['shield', 'Check it', 'Programme checks, model checks and clashes in separate tools.', 'Programme, model and the two together, in one pass.', 'One pass'],
  ['film', 'Show the sequence', 'Rebuild the timeline in another tool, step by step.', 'Play it in 4D, split two options, export video.', 'Same window'],
  ['lock', 'Share it', 'Strip names by hand, paste screenshots.', 'Anonymise, export images, video or a TimeLiner pack.', 'Safe and quick'],
];
const flowNode = (ic) => `<span class="flow__node"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[ic]}</svg></span>`;
const workflow = () => `<section class="flow-sec"><div class="wrap">
  <span class="kicker">The working pattern</span>
  <h2>The same job, and where the time goes.</h2>
  <p class="sub">Every revision sends a planner round the same six steps. Most of the time goes on moving things between tools by hand. Insight Plan does those steps in one place, and does them again when the next revision arrives.</p>
  <div class="flow" role="group" aria-label="The same six stages, done by hand and with ${SITE}">
    <p class="flow__label flow__label--today" style="grid-row:1"><b>Today</b><span>by hand, across tools</span></p>
    <p class="flow__label flow__label--gain" style="grid-row:3"><b>The gain</b></p>
    <p class="flow__label flow__label--plan" style="grid-row:4"><b>With ${SITE}</b><span>in one place</span></p>
    ${FLOW.map(([ic, stage, today, plan, gain], i) => `<div class="flow__stage${i === FLOW.length - 1 ? " flow__stage--last" : ""}" style="grid-column:${i + 2}">
      <div class="flow__cell flow__cell--today" data-tag="Today" style="grid-row:1">${flowNode(ic)}<b>${stage}</b><span>${today}</span></div>
      <div class="flow__cell flow__cell--gain" style="grid-row:3"><em>${gain}</em></div>
      <div class="flow__cell flow__cell--plan" data-tag="With ${SITE}" style="grid-row:4">${flowNode(ic)}<b>${stage}</b><span>${plan}</span></div>
    </div>`).join('')}
    <div class="flow__loop flow__loop--today" style="grid-row:2"><span>Next revision: every step again, by hand</span></div>
    <div class="flow__loop flow__loop--plan" style="grid-row:5"><span>Next revision: drop in the files, the rest re-runs</span></div>
  </div>
</div></section>`;

// What changes, task by task. Described in words, not invented timings.
const BEFORE_AFTER = [
  ['A revision arrives: what moved?', 'Export both programmes to Excel and compare by eye, for days, and still miss something.', 'Overlay the two programmes and their curves. The dates that moved are ranked by size.'],
  ['The programme says one thing, the model another', 'Nobody finds out until the work reaches that place on site.', 'Where the model shows a pour below or a wall beside and the programme has no link, the missing predecessor is listed with the contact it found.'],
  ['Linking activities to model objects', 'Match them by hand in a spreadsheet, and do it again after every revision.', 'Rules on properties link them. After a revision they re-run and list exactly what is left unlinked.'],
  ['Concrete and rebar peaks', 'A histogram with no link to the model, or a manual take-off.', 'Weekly and cumulative quantities from the programme resources, with a baseline overlaid.'],
  ['Showing the sequence to the client', 'Build a timeline in a separate tool, step by step.', 'Play the build in 4D, split two options side by side, and export an MP4 from the same window.'],
  ['The model is not ready for planning', 'Send it back to the modeller and wait.', 'Check it against IDS, preview a fix, and write a corrected copy. The original is never touched.'],
  ['Sending a programme to a third party', 'Strip names and codes by hand and hope nothing is left.', 'Anonymise: consistent neutral labels, with the dates shifted if you wish.'],
];
const beforeAfter = () => `<section><div class="wrap">
  <h2>What stops being a chore</h2>
  <p class="sub">The same jobs, with and without ${SITE}.</p>
  <div class="cmp-wrap"><table class="cmp cmp--ba">
    <thead><tr><th scope="col">The job</th><th scope="col">Without it</th><th scope="col" class="cmp-us">With ${SITE}</th></tr></thead>
    <tbody>${BEFORE_AFTER.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td><td class="cmp-us">${c}</td></tr>`).join('')}</tbody>
  </table></div>
</div></section>`;

// The reassurance that you can trust what it tells you.
const trust = () => `<section class="alt"><div class="wrap split">
  <div><h2>You can check its working</h2><p class="sub" style="margin-bottom:0">A tool that planners rely on has to be one they can audit. Nothing here is a black box, and nothing changes your source files behind your back.</p></div>
  <ul class="ticks">
    <li>Every finding shows its evidence: the objects, the gap, the pairs touching, the threshold that was applied.</li>
    <li>Fixes are previewed first and written to a new copy, with a change log. Your original IFC is never changed.</li>
    <li>P6 databases are read-only. Nothing is ever written into P6.</li>
    <li>Programme checks use the published DCMA 14 points, with thresholds you can set.</li>
    <li>Open formats throughout: XER, XML, IFC, CSV, and SQLite for the project, so there is no lock-in.</li>
    <li>Your programmes and models stay on your machine.</li>
  </ul>
</div></section>`;

// ---- The products. A licence is per user, per year, for Programmes, for Models, or for both.
const PRODUCTS = {
  programmes: ['Programmes', PRICING.programmes, 'For planners who work in the programme.', ['Gantt, table, WBS, calendars and resource loading on P6, MS Project and Excel programmes', 'DCMA 14-point and extra quality checks, float and critical path', 'Compare revisions: delay events, critical-path drag, concrete and rebar curves', 'Resource levelling, look-ahead, bulk edit with preview, anonymise', 'Write programmes back to P6 as XER or XML']],
  models: ['Models', PRICING.models, 'For people who work in the model.', ['View, colour, filter and isolate IFC models of any size', 'Search sets, selection sets and the set player', 'IDS model checks, with previewed patches written to a new IFC', 'Clash detection within and between models', 'Section, measure, saved views and fly-throughs', 'Topics: BCF issues with status, priority, assignee and comments, imported and exported as BCF']],
  complete: ['Programmes + Models', PRICING.complete, 'Everything, and what only the two together can do.', ['Everything in Programmes and in Models', 'Link activities to objects by rules that re-run after each revision', 'Play the build in 4D, split two sequences, export images and video', 'Check the programme against the model: missing predecessors with evidence', 'Navisworks TimeLiner export and import, and renumbering to a new model']],
};
const productsBand = () => `<section class="alt"><div class="wrap">
  <h2>Pay for what you use</h2>
  <p class="sub">Use ${SITE} for programmes, for models, or for both. A licence is per user, per year.</p>
  <div class="tiers">${[['programmes', ''], ['models', ''], ['complete', 'featured']].map(([k, cls]) => { const [name, price, blurb] = PRODUCTS[k]; return `<div class="tier${cls ? ` ${cls}` : ''}">${cls ? '<span class="badge">Everything</span>' : ''}<h3>${name}</h3><div class="price">${money(price)}<span>${PRICING.note}</span></div><p class="blurb">${blurb}</p></div>`; }).join('')}</div>
  <p style="text-align:center;margin-top:28px"><a class="btn" href="pricing.html">See what is included</a></p>
</div></section>`;

pages.push({
  file: 'index.html',
  title: `${SITE}: investigate your programme and model`,
  description: 'Insight Plan lets planners investigate construction programmes (P6, XER, XML, Excel) and IFC models, together or on their own, and play the build in 4D. Built from years of experience on site. Works offline and keeps your data on your machine.',
  body: `<div class="hero hero--split">
  <div class="hero__text">
  <span class="tag">Built from years of experience on site</span>
  <h1>Investigate the programme.<br><span class="grad">Investigate the model.</span></h1>
  <div class="hero__row"><p class="lead"><span>Open programmes and IFC models on their own or together.</span> <span>Check the logic and resources, search and clash-check the model,</span> <span>then link them and play the build in 4D.</span></p>
  <div class="cta"><a class="btn" href="features.html">Find out more</a></div></div>
  </div>
  <div class="hero__shot">
  ${appWindow()}
  <p class="note">Illustration with generic data. Real screenshots will replace it once they are cleared for publishing.</p>
  </div>
</div>
${steps()}
${worth()}
${workflow()}
${geoBlock()}
${beforeAfter()}
${usps()}
${tilePair(tile('4D sequencing', 'Watch the build happen.', 'Link each activity to the objects it builds and play the programme forward, date by date. Anyone can see what is built, what is being poured and what comes next.', ['Colour by stage, level or any property', 'Export images, video or a Navisworks TimeLiner pack'], building({ phase: 6, width: 480 })), tile('Split view', 'Compare two sequences of the same building.', 'Put two scenarios of one model side by side, or under a slider, at the same date, so the difference in sequence is plain to see.', ['Same date and camera in both views', 'Option A against option B, or planned against actual'], splitViz()))}
${tilePair(tile('Resource peaks', 'Find the peaks before the site does.', "Weekly and cumulative concrete and rebar from the programme's own resources. Overlay a new draft on the baseline and see exactly where they part company.", ['By week, month, quarter or year', 'Export the chart as an image or the data as CSV'], curves()), tile('Clash detection', 'Catch clashes inside a model and between models.', 'Check every model against itself and against the others, and see which objects overlap or touch. Results are stored in the project and update when a model changes.', ['Architecture, structure and services in one check', 'Click a pair to see it in 3D'], clash()))}
${tilePair(tile('Revisions', 'Links that survive a revision.', 'Rules join activities to model objects by their properties. When either the programme or the model is revised, the rules run again and list exactly what is now unlinked.', ['No re-matching by hand in spreadsheets', 'A check shows every activity and object left unlinked'], linkViz()), tile('Revisions', 'See what a revision changed.', 'Overlay two programmes and their curves, compare dates, and try what-if changes before you commit to one. The shift shows up in days, not in a meeting.', ['Weekly and cumulative curves, baseline against draft', 'Dates that moved, ranked by size'], changeViz()))}
${tileSolo(tile('Private by design', 'Your data stays on your machine.', `${SITE} runs in your browser, installs like an app and works with no internet connection. No account, no sign-in, no telemetry.`, ['Programmes and models stay in your project folder', 'Installs from Chrome or Edge and works offline'], `<div class="lockcard"><div class="lockring">${icon(ICONS.lock)}</div><b>Nothing leaves this computer</b><span>Models are converted and drawn in the app.</span></div>`, true))}
${trust()}
${productsBand()}
<section class="need"><div class="wrap need__grid">
  <div><h2>When you need this</h2><ul class="ticks">
    <li>A revision arrives and you must know what moved in the programme and in the model.</li>
    <li>You need to show the sequence to people who do not read Gantt charts.</li>
    <li>Your programmes and models cannot go to a cloud service.</li>
  </ul></div>
  <div><h2>What it is not</h2><ul class="ticks">
    <li>Not a replacement for P6 when you build and control the programme. It reads and writes your P6 files.</li>
    <li>Not a safety system. It supports planning and review.</li>
  </ul></div>
</div></section>
<section class="stats"><div class="wrap">
  ${stat('P6 + IFC', 'the files you already have')}
  ${stat('0 bytes', 'sent to a cloud service')}
  ${stat('1 click', 'to install from Chrome or Edge')}
  ${stat('Offline', 'no internet needed to run')}
</div></section>
<section class="alt"><div class="wrap split">
  <div><h2>A planning tool, not a safety system</h2><p class="sub" style="margin-bottom:0">${SITE} supports planning and review. It does not replace your safety case or approved engineering processes. It sits alongside your programme and model as decision support, built for projects where data handling matters, such as nuclear and other regulated heavy civil work.</p></div>
  <div class="card"><span class="soon">In development</span><h3>Weekly planning for the site team</h3><p>A simple, tablet-friendly way to look ahead, commit to the week's work and track percentage planned complete, working from the activities already in your programme.</p></div>
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Features
pages.push({
  file: 'features.html',
  title: `Features | ${SITE}`,
  description: 'What Insight Plan does: 4D sequencing, clash detection, programme analysis, concrete and rebar distribution, model colouring and filtering, reports and exports.',
  body: `${head('Features', 'Everything between the programme and the model', 'One tool to load, link, analyse and present. Nothing to install on a server, nothing sent to the cloud.')}
${geoBlock()}
${row(false, 'Link', 'Activities and objects, joined by rules.', 'Link groups connect activities to model objects by rules on their properties, so a programme revision re-links without starting over, and a check lists what is left unlinked.', ['Works on the properties your model already has', 'Re-runs after every revision'], building({ phase: 8, colourBy: 'level', width: 460 }))}
${row(true, 'Sequence', '4D, with the programme beside it.', 'Play the build forward date by date, with the Gantt chart and the weekly numbers in the same window. Compare two sequences side by side or with a slider.', ['Images and video with date labels and captions', 'Save a scene: camera, split view and filters'], appWindow())}
${row(false, 'Analyse', 'Concrete and rebar by week.', 'Quantities come straight from the resources in the programme. Overlay a baseline and a new draft, group by week, month, quarter or year, and colour the lines as you like.', ['Weekly bars and cumulative lines', 'Export the chart as an image, the data as CSV'], curves())}
${row(false, 'Clash detection', 'Find what touches, within a model or across models.', 'Every model is checked against itself and against every other loaded model, on the real geometry and where the models are placed. Each result names both objects, says whether they overlap or only touch, and shows the gap. Click a pair to see it in 3D.', ['Within one model, or between two models', 'Set the tolerance, test real triangles or boxes only', 'Results are saved in the project and refresh only when a model or its placement changes', 'The same pairs feed the programme generator, which uses them to order pours'], clash())}
<section><div class="wrap">
  <h2>Works with your scheduler, or without one</h2>
  <p class="sub">Use ${SITE} alongside the tools you have, or on its own.</p>
  <div class="grid">
    ${card('loop', 'Round trip with Primavera P6', 'Reads P6 XER and XML, and a P6 Professional database live and read-only. Writes P6 XER and XML back, so your changes return to P6 by import. Nothing is ever written into P6 directly.')}
    ${card('gantt', 'Reads MS Project', 'Open a programme saved from Microsoft Project as XML, with its tasks and links, and use it for 4D, resources and checks.')}
    ${card('table', 'Excel and CSV', 'No scheduler at all? Drop a spreadsheet with names and dates and it becomes a programme you can link to the model.')}
    ${card('cube', 'Or no programme at all', 'Models alone work too: clashes, IDS checks and patches, search sets, the set player, colouring and measuring.')}
  </div>
  <p class="note" style="margin-top:18px">MS Project files are read, not written. Save from MS Project as XML. P6 and Microsoft Project are trademarks of their owners.</p>
</div></section>
<section class="alt"><div class="wrap">
  <h2>Beyond Primavera P6</h2>
  <p class="sub">${SITE} reads and writes P6 programmes, and adds what P6 does not do on its own.</p>
  <div class="grid">
    ${card('cube', '3D and 4D in one place', 'P6 holds the programme only. Here the programme is linked to the IFC model and played forward date by date.')}
    ${card('clash', 'Clash detection', 'Overlaps and contacts within a model and between models, kept up to date as models change.')}
    ${card('link', 'Rules-based linking', 'Link activities to model objects by property rules that re-run after each revision, with a check for what is left unlinked.')}
    ${card('table', 'Model checks (IDS) and BCF topics', 'Check a model against IDS requirements and fix failures. Raise topics (BCF issues) with status, priority, an assignee and comments with viewpoints, place them in the model, and exchange them as BCF files.')}
    ${card('chart', 'Concrete and rebar peaks', 'Weekly and cumulative quantities from the programme resources, overlaid on a baseline.')}
    ${card('gantt', 'Look-ahead and PPC', 'Look-ahead windows and Percent Plan Complete with reasons for misses, from the activities already in the programme.')}
    ${card('loop', 'Risk and what-if on your own computer', 'Monte Carlo finish dates and what-if changes, with no extra risk product.')}
    ${card('lock', 'Anonymise and share', 'Mask names and codes consistently so a programme can leave the company safely.')}
    ${card('compare', 'DCMA quality checks', 'The DCMA 14-point check with editable thresholds, plus extra checks and reports.')}
  </div>
  <p class="note" style="margin-top:18px">Comparison is with P6 as a stand-alone scheduler. Other Oracle products and add-ons may cover some of these. Primavera and P6 are trademarks of Oracle.</p>
</div></section>
${compareTable()}
<section class="alt"><div class="wrap">
  <h2>And the rest of the toolbox</h2>
  <p class="sub">Programme analysis, model tools and exports, working on the same files.</p>
  <div class="grid">
    ${card('gantt', 'Programme analysis', 'Gantt, WBS, calendars, critical path, resource loading and checks, on XER and XML programmes. Group, filter, sort and colour with the same rules throughout.')}
    ${card('compare', 'Programme comparison', 'Overlay programmes and their curves to see what a revision changed, and try what-if changes to see their effect.')}
    ${card('palette', 'Colour, filter and isolate', 'Colour the model by any property, hide or isolate parts, and order the legend the way you want it.')}
    ${card('table', 'Reports and data exports', 'Excel, CSV, P6 XER and XML, and a Navisworks TimeLiner pack, so your data goes out in formats other tools read.')}
    ${card('film', 'Images and video', 'Export 4D sequences as images or video, from one or two views.')}
  </div>
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Examples
pages.push({
  file: 'examples.html',
  title: `Examples | ${SITE}`,
  description: 'Concrete examples of what Insight Plan does beyond ordinary tools: sets that convert and play, IDS checks with patches, clash detection, 4D and programme analysis.',
  body: `${head('Examples', 'Where it goes further than ordinary tools', 'Specific things you can do on day one, grouped by the job they help with.')}
${EXAMPLES.map(([h, sub, items], i) => `<section${i % 2 === 0 ? ' class="alt"' : ''}><div class="wrap">
  <h2>${h}</h2>
  <p class="sub">${sub}</p>
  <div class="grid">
    ${items.map(([t, d]) => `<div class="card"><h3>${t}</h3><p>${d}</p></div>`).join('\n    ')}
  </div>
</div></section>`).join('\n')}
<section><div class="wrap"><p class="note" style="text-align:center">Experimental and in-development features are marked on the Features page. Primavera, P6 and Navisworks are trademarks of their owners; ${SITE} is not affiliated with them.</p></div></section>
${cta}`,
});

// ---------------------------------------------------------------- Solutions
const problem = (n, h, p, how) => `<div class="problem"><div class="num">${n}</div><div><h3>${h}</h3><p>${p}</p><p class="how"><strong>How ${SITE} helps:</strong> ${how}</p></div></div>`;
pages.push({
  file: 'solutions.html',
  title: `Solutions | ${SITE}`,
  description: 'Problems Insight Plan solves for planners on complex construction projects: programme and model out of step, resource peaks, comparing revisions, explaining the sequence, sharing data safely.',
  body: `${head('Solutions', 'Problems it solves', 'The recurring questions planners are asked, and where the answer usually gets lost between a programme, a model and a spreadsheet.')}
<section class="alt"><div class="wrap problems">
  ${problem(1, 'The programme and the model say different things', 'Activities and model objects are matched by hand, in spreadsheets, and the match breaks the moment the programme is revised.', 'Link groups connect activities to objects by rules on their properties. After a revision they re-run, and a check shows the activities and objects left unlinked.')}
  ${problem(2, 'Nobody sees the concrete and rebar peaks until the site does', 'A programme can look sensible while asking for twice the normal pour or rebar volume in a few weeks.', 'Weekly and cumulative concrete and rebar charts come straight from the programme\'s resources. Overlay a baseline and a new draft to see where they differ.')}
  ${problem(3, 'What did the latest revision actually change?', 'Comparing two programmes by eye, or by exporting both to Excel, takes days and still misses things.', 'Overlay two programmes and their curves, compare dates, and try what-if changes to see their effect before you commit to one.')}
  ${problem(4, 'The sequence is hard to explain to people who do not read Gantt charts', 'Project managers, clients and construction teams need to see the order of work, not a bar chart.', 'Play the build forward in 4D and export images or video. Show two options side by side in the same view, or use the compare slider.')}
  ${problem(5, 'The tools want your data on someone else\'s server', 'Sensitive projects cannot upload models and programmes to a cloud service, or wait for IT to approve one.', 'It runs in your browser and works without an internet connection once installed. No account, no telemetry, and your files stay in your project folder.')}
  ${problem(6, 'Sharing a programme without sharing the project', 'A programme often has to go to a third party with names, codes and people removed.', 'An anonymise tool replaces names and codes consistently so a programme can be shared safely.')}
  ${problem(7, 'Models from different teams collide on site', 'Structure, architecture and services are modelled separately, and the overlaps only show up when the work reaches the same place.', 'Every model is checked against itself and against the others, on the real geometry. Overlaps and contacts are listed with both objects and the gap, and open in 3D.')}
  ${problem(8, 'You need more than P6 offers, without another server', 'P6 gives the programme, but not the model, the quantities, the look-ahead or the checks planners are asked for.', 'One desktop tool adds 4D, clash detection, concrete and rebar peaks, look-ahead, PPC, risk and quality checks on the same P6 files.')}
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Pricing
const tier = (cls, name, price, per, blurb, items, button, btnClass = '') => `<div class="tier${cls ? ` ${cls}` : ''}">
  ${cls ? '<span class="badge">Best value</span>' : ''}
  <h3>${name}</h3>
  <div class="price">${price}<span>${per}</span></div>
  <p class="blurb">${blurb}</p>
  <ul class="ticks">${items.map((i) => `<li>${i}</li>`).join('')}</ul>
  <a class="btn ${btnClass}" href="contact.html">${button}</a>
</div>`;
const prodTier = (k, cls, button, btnClass) => { const [name, price, blurb, items] = PRODUCTS[k]; return tier(cls, name, money(price), ` ${PRICING.note}`, blurb, items, button, btnClass).replace('<div class="tier', `<div id="${k}" class="tier`); };

// Which product has which capability.
const INC = '<span class="cmp-yes">Yes</span>';
const NO = '<span class="cmp-no">&ndash;</span>';
const MATRIX = [
  ['Programmes'],
  ['Read P6 XER and XML, MS Project XML, Excel and CSV; write P6 XER and XML', INC, NO, INC],
  ['Gantt, table, WBS, calendars, activity codes, resource loading', INC, NO, INC],
  ['DCMA 14-point checks, float, critical path, reports', INC, NO, INC],
  ['Compare programmes: delay events, drag, concrete and rebar curves', INC, NO, INC],
  ['Resource levelling, look-ahead, bulk edit with preview, anonymise', INC, NO, INC],
  ['PPC, Monte Carlo risk, what-if (experimental)', INC, NO, INC],
  ['Models'],
  ['View, colour, filter, isolate and search IFC models', NO, INC, INC],
  ['Search sets, selection sets, set player', NO, INC, INC],
  ['IDS checks, previewed patches, corrected IFC copy', NO, INC, INC],
  ['Clash detection within and between models', NO, INC, INC],
  ['Section, measure, saved views, fly-throughs', NO, INC, INC],
  ['Topics (BCF issues): status, priority, assignee, comments with viewpoints, a point in the model, import and export of BCF files (experimental)', NO, INC, INC],
  ['Programme and model together'],
  ['Link activities to objects by rules that re-run after a revision', NO, NO, INC],
  ['4D playback, split view and slider, image and MP4 export', NO, NO, INC],
  ['Missing predecessors found from the model, with evidence', NO, NO, INC],
  ['Navisworks TimeLiner export and import', NO, NO, INC],
  ['Renumber a programme to a new model', NO, NO, INC],
  ['Model data on the programme: level, pour type, volume, height, any property as Gantt and table columns', NO, NO, INC],
  ['Group, filter, sort and colour the Gantt by model properties, and add calculated columns across both (tonnes per hour, say)', NO, NO, INC],
  ['Select in the programme to select in the model, and the other way round', NO, NO, INC],
  ['Select an activity with its predecessors, successors or driving path in 3D, to check the logic on the model', NO, NO, INC],
  ['Isolate or open the objects of any activity in 3D or 4D from the Gantt', NO, NO, INC],
  ['Suggested links the model implies and the programme lacks, and links generated by rule', NO, NO, INC],
  ['Write Activity ID and name onto the model objects, back to the IFC', NO, NO, INC],
  ['Markers in the model tied to activities', NO, NO, INC],
  ['Topics that follow the programme: a topic can start and finish with activities, and shows in 4D while its dates are on (experimental)', NO, NO, INC],
];
const matrix = () => `<div class="cmp-wrap"><table class="cmp cmp--matrix">
  <thead><tr><th scope="col">What you can do</th><th scope="col">Programmes</th><th scope="col">Models</th><th scope="col" class="cmp-us">Programmes + Models</th></tr></thead>
  <tbody>${MATRIX.map(([what, ...c]) => c.length === 0 ? `<tr class="cmp-group"><th colspan="4" scope="colgroup">${what}</th></tr>` : `<tr><th scope="row">${what}</th>${c.map((x, i) => `<td${i === 2 ? ' class="cmp-us"' : ''}>${x}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;

// How it saves money: the sum is shown for 200 planning or model days out of 252 working days, 15 minutes saved a day, at £25 and £30 an hour.
const nf = (n) => Math.round(n).toLocaleString('en-GB');
const payback = () => {
  const A = PRICING.assume;
  const hours = (A.days * A.minutesPerDay) / 60;
  const [low, high] = A.rates;
  const breakEven = (price, rate) => Math.ceil(((price / rate) * 60) / A.days - 1e-9); // the small allowance stops 10.000000000000002 rounding up to 11
  const rows = [['Programmes', PRICING.programmes], ['Models', PRICING.models], ['Programmes + Models', PRICING.complete]];
  return `<section id="saving"><div class="wrap split split--top">
  <div>
    <span class="kicker">How it saves money</span>
    <h2>Fifteen minutes a day pays for it.</h2>
    <p class="sub">Think of the days you spend on planning or on interrogating a model. Saving a quarter of an hour on each, on checks, comparisons, links and answers, is easy to do and adds up.</p>
    <ol class="sum" aria-label="The sum">
      <li><b>${A.days}</b><span>days of planning or model work, out of ${A.workingDays} working days</span></li>
      <li><i>&times;</i><b>${A.minutesPerDay} min</b><span>saved each day</span></li>
      <li><i>=</i><b>${nf(hours)} hours</b><span>a year (${nf(A.days * A.minutesPerDay)} minutes)</span></li>
      <li><i>&times;</i><b>${money(low)}</b><span>an hour</span></li>
      <li class="sum__total"><i>=</i><b>${money(Math.round(hours * low))}</b><span>saved per user, every year</span></li>
    </ol>
    <p class="note" style="text-align:left;margin-top:14px">At ${money(high)} an hour the same ${nf(hours)} hours are worth ${money(Math.round(hours * high))}. Illustrative arithmetic: use your own days and rate.</p>
  </div>
  <div class="cmp-wrap"><table class="cmp cmp--narrow cmp--calc">
    <thead><tr><th scope="col">Licence</th><th scope="col">Cost a year</th><th scope="col">Paid back at ${money(low)} an hour</th><th scope="col" class="cmp-us">Paid back at ${money(high)} an hour</th></tr></thead>
    <tbody>
      <tr class="cmp-group"><th scope="row" colspan="2">15 minutes a day saves</th><td><b>${money(Math.round(hours * low))}</b></td><td class="cmp-us"><b>${money(Math.round(hours * high))}</b></td></tr>
      ${rows.map(([n, p]) => `<tr><th scope="row">${n}</th><td>${money(p)}</td><td>${breakEven(p, low)} min a day</td><td class="cmp-us">${breakEven(p, high)} min a day</td></tr>`).join('')}
    </tbody>
  </table>
  <p class="note" style="text-align:left;margin:12px 4px 0">Minutes saved each day, over ${A.days} days, to cover the licence. Use both programmes and models, and 15 minutes on each side covers the combined licence.</p></div>
</div></section>`;
};

// Worked examples, in the Catenda manner: what real teams would pay. Plain arithmetic on the licence prices.
const EXAMPLES_PRICE = [
  ['One planner on the programme', `1 × Programmes`, PRICING.programmes],
  ['One planner, programme and model', `1 × Programmes + Models`, PRICING.complete],
  ['A project team of five', `2 × Programmes, 3 × Programmes + Models`, 2 * PRICING.programmes + 3 * PRICING.complete],
];
const priceExamples = () => `<section><div class="wrap">
  <h2>Priced per user, by what they use.</h2>
  <p class="sub">Add up the people and the licence each one needs. There is nothing else to add: no per-project fee, no module charges, no usage meter.</p>
  <div class="grid">${EXAMPLES_PRICE.map(([who, what, total]) => `<div class="card price-ex"><h3>${who}</h3><p>${what}</p><div class="price-ex__total">${money(total)}<span> per year</span></div></div>`).join('')}</div>
  <p class="note" style="margin-top:18px;text-align:left">Prices exclude tax. Larger teams and several projects are quoted as one agreement.</p>
</div></section>`;

const PRICE_PROMISES = [
  ['folders', 'Unlimited projects', `A licence covers a person, not a project. Open as many programmes and models as you like, on as many projects as you run.`],
  ['tag', 'No hidden costs', `One price per user per year. Updates, the in-app guide and email support are included. There is no server to buy, no database to run and no consultant needed.`],
  ['unlock', 'No lock-in', `Your programmes and models stay in your own folder, in open formats: XER, XML, IFC, CSV and a SQLite database. If you stop, you keep everything.`],
];
const iconTitle = (ic, h) => `<h3 class="ic-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[ic]}</svg>${h}</h3>`;
const promises = () => `<div class="grid pagehead__cards">${PRICE_PROMISES.map(([ic, h, p]) => `<div class="card">${iconTitle(ic, h)}<p>${p}</p></div>`).join('')}</div>`;

const BIGGER = [
  ['users', 'Several projects or a bigger team', ['Volume terms across users and projects', 'One agreement, one renewal date', 'Multi-year options']],
  ['server', 'Your IT and security teams', ['Host the files on your own intranet', 'Help with security questionnaires', 'A list of the third-party software in each release']],
  ['wand', 'Getting started', ['Set-up and training for your team', 'Priority support and onboarding', 'Help importing your first programmes and models']],
];
const bigger = () => `<section class="alt"><div class="wrap">
  <h2>Need something more?</h2>
  <p class="sub">Most teams need nothing beyond the licence. For larger roll-outs, these are available on request.</p>
  <div class="grid">${BIGGER.map(([ic, h, items]) => `<div class="card">${iconTitle(ic, h)}<ul class="ticks">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('')}</div>
  <p style="margin-top:28px"><a class="btn" href="contact.html">Talk to us</a></p>
</div></section>`;

pages.push({
  file: 'pricing.html',
  title: `Pricing | ${SITE}`,
  description: `Insight Plan pricing: Programmes ${money(PRICING.programmes)}, Models ${money(PRICING.models)}, or both for ${money(PRICING.complete)}, per user per year. No per-project fee, no server, no lock-in.`,
  body: `${head('Pricing', 'Simple and predictable.', `Per user, per year. Programmes ${money(PRICING.programmes)}, Models ${money(PRICING.models)}, or both for ${money(PRICING.complete)}. No per-project fees, no server, no lock-in.`).slice(0, -'</div>'.length)}${promises()}</div>
<section style="padding-top:8px;padding-bottom:12px"><div class="wrap" style="padding-top:0;padding-bottom:0">
  <div class="tiers">
    ${prodTier('programmes', '', 'Start a free trial', 'ghost')}
    ${prodTier('complete', 'featured', 'Start a free trial', '')}
    ${prodTier('models', '', 'Start a free trial', 'ghost')}
  </div>
</div></section>
<div class="wrap"><p class="note" style="margin:0 0 28px">Every licence includes updates for the term, the in-app guide and email support. Prices exclude tax.</p></div>
${priceExamples()}
${payback()}
<section class="alt"><div class="wrap">
  <h2 id="licences">What is in each licence</h2>
  <p class="sub">Programmes and Models each stand on their own. Together they add what only both can do: linking, 4D, and checking the programme against the model.</p>
  ${matrix()}
  <p class="note" style="margin-top:18px">The list under Programme and model together is where a Programmes + Models licence pays back: each is a small gain on its own, and together they remove the copying between two tools. Features marked experimental can be switched on and are still being refined.</p>
</div></section>
${worth('What a licence gets you')}
${bigger()}
<section><div class="wrap">
  <h2>Pricing questions</h2>
  <div class="faq">
    <details><summary>Why per user, not per project?</summary><p>The tool is used by individual planners, so the cost follows the people who use it. There is no fee to add a project, no limit on models or programmes, and nothing to renegotiate when the next project starts.</p></details>
    <details><summary>Which licence do I need?</summary><p>Programmes if your work is in the schedule: checks, comparison, resources and look-ahead. Models if it is in the IFC model: checks, clashes, sets and review. Both if you want to link them, play the build in 4D, or check the programme against the model. You can upgrade at any time.</p></details>
    <details><summary>Can we try it first?</summary><p>Yes. Start a free ${PRICING.trialDays}-day trial on your own programme and model, with set-up help if you want it. That tells you more than a demo. A trial key works like a licence key and runs out on its own.</p></details>
    <details><summary>Do you need a server or an IT project?</summary><p>No. It is a web app: open it in Chrome or Edge, install it from the browser, and it works offline. A licence key is checked on your computer, so there is no sign-in and no licence server. If you prefer, your organisation can host the files on its own intranet.</p></details>
    <details><summary>Where is our data kept?</summary><p>In the project folder you choose, on your computer. The app does not send programmes or models anywhere, and has no account or telemetry.</p></details>
    <details><summary>What happens when the licence ends?</summary><p>The app shows a warning in the last 30 days, and you can renew with a new key. If you do not renew, the app stops opening, but your files are still yours: programmes and models are in your folder in open formats, and the project database is an ordinary SQLite file.</p></details>
    <details><summary>What if a colleague only needs to look at results?</summary><p>Viewer-only access is planned. Tell us if it matters to you.</p></details>
    <details><summary>What support is included?</summary><p>Updates for the licence term, the in-app guide, and email support. Priority support and onboarding are available for larger roll-outs.</p></details>
  </div>
</div></section>
<section class="contact"><div class="wrap"><h2>Now let's see it on your project.</h2><p class="sub">Bring a programme and a model. That's it.</p><a class="btn" href="contact.html">Start a free trial</a> <a class="btn btn--line" href="contact.html">Talk to us</a></div></section>`,
});

// ---------------------------------------------------------------- Compare (alternatives)
// What each alternative says about itself comes from the vendors' published pages (checked Oct 2026). Keep claims to what they publish.
const ALT = [
  ['Bentley SYNCHRO 4D', 'A full desktop 4D construction planning platform.',
    'Bentley lists 4D scheduling and simulation, what-if scenarios, baseline against actual progress, clash detection, and schedules built in the tool or brought in from P6 and Asta Powerproject. It is a subscription product sold through Bentley and its resellers.',
    `${SITE} is analysis-first: it checks the programme and the model, re-runs links after a revision, and finds missing predecessors from the model's geometry, in a browser with no server. It costs less per user and needs no model-preparation project.`,
    'Choose SYNCHRO when 4D simulation is a managed discipline across a large team. Use both when you want the programme and model checked before they go in.'],
  ['Autodesk Navisworks', 'The standard tool for model review and coordination.',
    'TimeLiner links a model to a schedule for 4D playback, and Clash Detective is in Manage but not in Simulate. It reads many model formats and is widely used by coordinators.',
    `${SITE} works on the programme itself: DCMA checks, comparison, resource peaks, risk and look-ahead, which Navisworks does not cover. Links are rules that re-run after a revision rather than selection sets you keep by hand. It writes a TimeLiner pack, so it can feed Navisworks.`,
    'Keep Navisworks for federated model coordination. Use us to prepare and check the programme and links that go into TimeLiner.'],
  ['Asta Powerproject 4D', 'A scheduler with a 4D module of its own.',
    'Elecosoft describes a module that reads IFC, links tasks to model elements, compares planned and actual in 4D, filters by subcontractor, repositions site objects such as cranes and records camera paths.',
    `${SITE} does not ask you to move your scheduling into a new tool. It reads P6, MS Project and Excel programmes and adds checks, comparison and resource analysis. It also covers model checks (IDS), clash detection and fixes, which a scheduler does not.`,
    'Powerproject suits teams who build and control the programme in it. Use us to analyse it, or to do the same for programmes that come from elsewhere.'],
  ['Fuzor', 'A visual construction simulation tool.',
    'Kalloc lists 4D sequence animation, clash analysis, VR viewing and method statements, P6, MS Project and Powerproject schedule import, and an AI-assisted workflow for linking models to schedules in the 2024 release.',
    `${SITE} is not a visualisation studio. It is for the planner who must be sure the programme and model agree: quality checks, model-based predecessors, concrete and rebar peaks, and revision comparison, with nothing leaving the computer.`,
    'Choose Fuzor for immersive presentation and method statements. Use us for the checking behind the story.'],
  ['Oracle Primavera P6 and Risk Analysis', 'The scheduling tool most programmes are built in.',
    'P6 builds and controls the programme. Oracle sells Primavera Risk Analysis as a separate product for Monte Carlo risk, with P6 data exported to it.',
    `${SITE} reads and writes P6 XER and XML, and adds the model link, 4D, clash detection and quality checks P6 does not do. Monte Carlo risk and what-if are included, and are still marked experimental.`,
    'Not a replacement. Keep P6 to build the programme and use us to investigate it.'],
  ['Solibri', 'A dedicated model-checking product.',
    'Solibri checks models against rule sets and supports IDS from release 9.13.6. Which licence tier includes IDS depends on Solibri, so check the current plans.',
    `${SITE}'s IDS checks come with fixes: preview a patch, then write a corrected copy of the IFC and keep the original. They sit beside the programme, so a failed check can be traced to the activities it affects.`,
    'Choose Solibri for a deep, rule-driven model quality programme. Use us when the question is how model quality affects the programme.'],
  ['Spreadsheets and doing it by hand', 'What most teams do today.',
    'Free, flexible and familiar. Matching activities to objects, comparing revisions and building the story for a meeting is manual, slow and easy to get wrong.',
    `${SITE} keeps your files and formats, and replaces the repetitive part: links by rule, revisions compared in minutes, checks with evidence.`,
    'The easiest comparison to make. The pricing page shows the break-even time.'],
];
const BETTER = [
  ['You build and control the programme', 'Primavera P6, Asta Powerproject or MS Project. Insight Plan reads and writes the files, it does not replace them.'],
  ['You need photoreal visuals, VR or crane animation for a bid', 'Fuzor, SYNCHRO or a rendering tool. Insight Plan plays the sequence, with images and video, but it is built for checking, not for show.'],
  ['You run federated coordination across many disciplines and formats', 'Navisworks or a common data environment. Insight Plan reads IFC.'],
  ['You need many people editing the same live project in the cloud', 'Trimble Connect or a similar cloud platform. Insight Plan keeps your data on your machine and is single-user by design.'],
];
pages.push({
  file: 'alternatives.html',
  title: `Compare | ${SITE}`,
  description: 'How Insight Plan compares with Bentley SYNCHRO 4D, Navisworks, Asta Powerproject, Fuzor, Primavera P6, Solibri and doing it by hand, and when another tool is the better choice.',
  body: `${head('Compare', 'Where it fits next to the tools you know', `Honest differences with ${ALT.length - 1} alternatives and with doing it by hand, and the cases where another tool is the better choice.`)}
<section class="alt"><div class="wrap">
  <h2>In short</h2>
  <p class="sub">${SITE} is the tool that checks the programme against the model. Most of the alternatives build the programme, play the sequence or review the model. That makes it a good partner to them as well as a substitute for some of their work.</p>
  <div class="cmp-wrap"><table class="cmp cmp--alt">
    <thead><tr><th scope="col">Tool</th><th scope="col">Best at</th><th scope="col" class="cmp-us">What ${SITE} adds</th></tr></thead>
    <tbody>${ALT.map(([n, best, , add]) => `<tr><th scope="row">${n}</th><td>${best}</td><td class="cmp-us">${add}</td></tr>`).join('')}</tbody>
  </table></div>
</div></section>
<section><div class="wrap">
  <h2>One by one</h2>
  <div class="alts">${ALT.map(([n, , they, us, together]) => `<article class="alt-card"><h3>${n}</h3><div class="alt-card__cols"><div><span class="kicker">What it offers</span><p>${they}</p></div><div><span class="kicker">How ${SITE} differs</span><p>${us}</p></div></div><p class="alt-card__use"><b>In practice:</b> ${together}</p></article>`).join('')}</div>
  <p class="note" style="margin-top:22px">Based on each vendor's published information at the time of writing. Products, editions and prices change, so check each vendor for your set-up. All product names are trademarks of their owners; ${SITE} is not affiliated with them.</p>
</div></section>
<section class="alt"><div class="wrap">
  <h2>When another tool is the better choice</h2>
  <p class="sub">We would rather you picked the right tool.</p>
  <div class="grid">${BETTER.map(([h, p]) => `<div class="card"><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>
</div></section>
<section><div class="wrap">
  <h2>Where the vendors say it themselves</h2>
  <ul class="ticks"><li><a href="https://www.bentley.com/products/synchro-4d" rel="noopener">Bentley SYNCHRO 4D</a></li><li><a href="https://www.autodesk.co.uk/products/navisworks/compare/compare-products" rel="noopener">Autodesk: compare Navisworks products</a></li><li><a href="https://elecosoft.com/events/4d-pp-next-level/" rel="noopener">Elecosoft: Powerproject 4D</a></li><li><a href="https://fuzor-manual.atlassian.net/wiki/x/ISY1EQ" rel="noopener">Fuzor manual: 4D construction</a></li><li><a href="https://www.solibri.com/articles/release-highlights-release-9-13-6" rel="noopener">Solibri: IDS in release 9.13.6</a></li></ul>
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Resources
const res = (h, p, tag) => `<div class="card"><h3>${h}</h3><p>${p}</p>${tag ? `<p class="note" style="margin-top:10px">${tag}</p>` : ''}</div>`;
pages.push({
  file: 'resources.html',
  title: `Resources | ${SITE}`,
  description: 'Documentation, getting started, system requirements and data-handling notes for Insight Plan.',
  body: `${head('Resources', 'Documentation and answers', 'The guide ships inside the app (the Wiki tab). These are the topics it covers, and what you need to run it.')}
<section class="alt"><div class="wrap">
  <h2>In the app guide</h2>
  <p class="sub">The full text is in the <a href="docs.html">documentation</a>.</p>
  <div class="grid">
    ${res('Inputs', 'Loading IFC models and programmes, and what the file list tells you.')}
    ${res('Models', 'Viewing, colouring, filtering and isolating, search sets and saved views.')}
    ${res('Programmes', 'Gantt, WBS, calendars, resources, checks and comparing programmes.')}
    ${res('4D sequencing', 'Linking activities to objects, playing the sequence and exporting images and video.')}
    ${res('Scheduling logic', 'How dates, calendars and float are calculated.')}
    ${res('Data, persistence and limitations', 'Where your data is kept and what the tool does not do.')}
  </div>
</div></section>
<section><div class="wrap split">
  <div>
    <h2 id="requirements">System requirements</h2>
    <ul class="ticks">
      <li>Chrome or Edge, a recent version</li>
      <li>A secure (HTTPS) address for the app: ours, or your own intranet</li>
      <li>16 GB of memory recommended for large models</li>
      <li>No internet connection needed to run</li>
    </ul>
  </div>
  <div>
    <h2 id="data">Data handling</h2>
    <p class="sub" style="margin-bottom:0">Programmes, models and results are read and saved in the project folder you choose, on your computer. The app does not send them anywhere and has no account or telemetry. A third-party software list ships with each release.</p>
  </div>
</div></section>
<section class="alt"><div class="wrap">
  <h2>Frequently asked</h2>
  <div class="faq">
    <details><summary>Which programme formats can it read?</summary><p>Primavera P6 XER and XML, MS Project XML (File &gt; Save As &gt; XML), and Excel and CSV. It writes P6 XER and XML, and Excel. MS Project .mpp files are not read directly: save them as XML first.</p></details>
    <details><summary>Which model formats?</summary><p>IFC, and FRAG (an already converted model). glTF can be added as site context. Models are converted and drawn in your browser, on your own machine.</p></details>
    <details><summary>Can it be used for safety-related decisions?</summary><p>No. It is a planning and review tool. It does not replace your safety case or approved engineering processes.</p></details>
    <details><summary>How do updates work?</summary><p>A new version is picked up the next time the app is opened, from wherever it is hosted. If your organisation hosts it on its own intranet, your IT team decides when a new version goes live.</p></details>
    <details><summary>Will there be a multi-user, cloud version?</summary><p>The weekly planning module for site teams is in development and is designed for tablets and several users at once. The planning workbench stays offline.</p></details>
  </div>
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Contact
pages.push({
  file: 'contact.html',
  title: `Contact | ${SITE}`,
  description: 'Start a free trial of Insight Plan on your own programme and model.',
  body: `${head('Contact', 'Start a free trial or ask us anything', 'Tell us about your project and what you need to answer. We will reply with a trial key and a short plan.')}
<section class="alt"><div class="wrap split split--top">
  <form id="contact-form" class="form" novalidate>
    <h2>Send us a message</h2>
    <div class="form__row">
      <label>Your name<input name="name" autocomplete="name" required></label>
      <label>Work email<input name="email" type="email" autocomplete="email" required></label>
    </div>
    <div class="form__row">
      <label>Company<input name="company" autocomplete="organization"></label>
      <label>Your role<input name="role" autocomplete="organization-title"></label>
    </div>
    <div class="form__row">
      <label>I am interested in
        <select name="interest"><option>A free trial</option><option>Programmes licence</option><option>Models licence</option><option>Programmes + Models licence</option><option>Several users or projects</option><option>Something else</option></select>
      </label>
      <label>Users
        <select name="users"><option>1</option><option>2 to 4</option><option>5 to 10</option><option>More than 10</option></select>
      </label>
    </div>
    <label>Programme and model formats you use<input name="formats" placeholder="e.g. P6 XER, IFC"></label>
    <label>What do you want to answer?<textarea name="message" rows="5" required placeholder="e.g. Compare revisions faster, or link the programme to the model"></textarea></label>
    <label>Any limits on data handling we should know about?<input name="data"></label>
    <label class="form__hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
    ${TURNSTILE_SITEKEY ? `<div class="cf-turnstile" data-sitekey="${TURNSTILE_SITEKEY}"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
    <p class="form__status" id="form-status" role="status"></p>
    <button class="btn" type="submit">Send message</button>
    <p class="note" style="text-align:left;margin-top:12px">We use what you send only to reply to you.</p>
  </form>
  <div>
    <div class="card"><h3>What happens next</h3><ul class="ticks"><li>A reply within one working day</li><li>A short call to understand the project</li><li>A trial key for ${PRICING.trialDays} days, free of charge</li><li>Set-up help if you want it, with your data staying with you</li></ul></div>
    <p style="margin-top:22px">Prefer email? Write to <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
  </div>
</div></section>
<script>
(() => {
  const form = document.getElementById('contact-form'), status = document.getElementById('form-status');
  const endpoint = ${JSON.stringify(FORM_ENDPOINT)}, to = ${JSON.stringify(CONTACT)};
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form__status';
    const d = Object.fromEntries(new FormData(form));
    if (d.website) return; // a bot filled the hidden field
    if (!d.name.trim() || !/^\\S+@\\S+\\.\\S+$/.test(d.email) || !d.message.trim()) { status.textContent = 'Please give your name, a valid email and a message.'; status.classList.add('is-error'); return; }
    const viaEmail = (note) => {
      const body = ['Name: ' + d.name, 'Email: ' + d.email, 'Company: ' + d.company, 'Role: ' + d.role, 'Interested in: ' + d.interest, 'Users: ' + d.users, 'Formats: ' + d.formats, 'Data handling: ' + d.data, '', d.message].join('\\n');
      location.href = 'mailto:' + to + '?subject=' + encodeURIComponent('${SITE}: ' + d.interest) + '&body=' + encodeURIComponent(body);
      status.textContent = note; status.classList.add('is-ok');
    };
    if (endpoint) {
      try {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(d) });
        if (r.ok) { form.reset(); if (window.turnstile) try { window.turnstile.reset(); } catch {} status.textContent = 'Thank you. We will reply within one working day.'; status.classList.add('is-ok'); return; }
        // A message the visitor can fix (a missing field, a failed bot check) is shown as it is.
        if (r.status === 400 || r.status === 403) { const j = await r.json().catch(() => ({})); status.textContent = j.error || 'The message could not be sent.'; status.classList.add('is-error'); if (window.turnstile) try { window.turnstile.reset(); } catch {} return; }
      } catch { /* no network, or the site is not on Cloudflare: use the email program */ }
      viaEmail('Sending from this page did not work, so your email program should open with the message ready to send.');
      return;
    }
    viaEmail('Your email program should open with the message ready to send.');
  });
})();
</script>`,
});

// ---------------------------------------------------------------- Documentation (generated from docs/help, the app's own Help)
const DOCS = loadDocs();
const docsNav = (current) => `<aside class="docs__nav" aria-label="Documentation">
  <label class="docs__search"><span class="sr">Search the documentation</span><input type="search" placeholder="Search" id="docs-search" autocomplete="off"></label>
  <a class="docs__home${current === 'index' ? ' is-current' : ''}" href="docs.html">Overview</a>
  ${DOC_GROUPS.map((g) => { const items = DOCS.filter((d) => d.group === g); return items.length ? `<div class="docs__group"><b>${g}</b>${items.map((d) => `<a href="${docUrl(d.slug)}"${d.slug === current ? ' class="is-current" aria-current="page"' : ''}>${d.title}</a>${d.slug === current ? `<div class="docs__sub">${d.toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('')}</div>` : ''}`).join('')}</div>` : ''; }).join('')}
</aside>`;
const docsScript = `<script>(() => { const q = document.getElementById('docs-search'), links = [...document.querySelectorAll('.docs__nav .docs__group a, .docs__nav .docs__sub a')]; q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); links.forEach((a) => { a.hidden = !!t && !a.textContent.toLowerCase().includes(t); }); document.querySelectorAll('.docs__group').forEach((g) => { g.hidden = !!t && ![...g.querySelectorAll('a')].some((a) => !a.hidden); }); }); })();</script>`;

pages.push({
  file: 'docs.html',
  title: `Documentation | ${SITE}`,
  description: 'The Insight Plan documentation: getting started, loading files, models, programmes, planning tools, 4D sequencing, settings and where your data is kept.',
  body: `<div class="docs">
${docsNav('index')}
<article class="docs__main">
  <h1>Documentation</h1>
  <p class="docs__lead">The same guide that ships inside the app. Start with <a href="${docUrl('getting-started')}">Getting started</a>, then load your first programme and model.</p>
  ${DOC_GROUPS.map((g) => { const items = DOCS.filter((d) => d.group === g); return items.length ? `<h2 id="${g.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${g}</h2><div class="grid">${items.map((d) => `<a class="card docs__card" href="${docUrl(d.slug)}"><h3>${d.title}</h3><p>${d.summary}</p></a>`).join('')}</div>` : ''; }).join('')}
  <p class="note" style="text-align:left;margin-top:34px">Can't find what you need? <a href="contact.html">Ask us</a>, or see the <a href="resources.html">questions and answers</a>.</p>
</article>
<aside class="docs__toc"></aside>
</div>
${docsScript}`,
});
DOCS.forEach((d, i) => {
  const prev = DOCS[i - 1], next = DOCS[i + 1];
  pages.push({
    file: docUrl(d.slug),
    title: `${d.title} | Documentation | ${SITE}`,
    description: d.summary.slice(0, 200),
    body: `<div class="docs">
${docsNav(d.slug)}
<article class="docs__main">
  <p class="docs__crumb"><a href="docs.html">Documentation</a> / ${d.group}</p>
  <h1>${d.title}</h1>
  ${d.html}
  <div class="docs__pager">${prev ? `<a href="${docUrl(prev.slug)}"><small>Previous</small>${prev.title}</a>` : '<span></span>'}${next ? `<a class="next" href="${docUrl(next.slug)}"><small>Next</small>${next.title}</a>` : ''}</div>
</article>
<aside class="docs__toc">${d.toc.length ? `<b>On this page</b>${d.toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('')}` : ''}</aside>
</div>
${docsScript}`,
  });
});

// ---------------------------------------------------------------- About us
pages.push({
  file: 'about.html',
  title: `About us | ${SITE}`,
  description: 'Why Insight Plan exists, what we believe, and how to reach us.',
  body: `${head('About us', 'Built from years of experience on site', 'Insight Plan is made for the planners who have to explain, check and defend a construction programme.')}
<section class="alt"><div class="wrap split">
  <div><h2>Why it exists</h2><p class="sub" style="margin-bottom:0">Programmes and models describe the same building, and they drift apart. Matching them by hand costs days, and the mismatch usually shows up on site. The tools that could help often want your data on someone else's server. We built the tool we wanted: one that reads the files you already have, checks them against each other, and keeps everything on your machine.</p></div>
  <div class="card"><h3>Who it is for</h3><p>Planners and project controls teams on complex construction, and the engineers and managers who rely on what they say. Particularly where data handling matters, such as nuclear and other regulated heavy civil work.</p></div>
</div></section>
<section><div class="wrap">
  <h2>What we hold to</h2>
  <div class="grid">
    ${card('lock', 'Your data stays yours', 'No account, no telemetry, and no upload. Programmes and models stay in your project folder, in open formats.')}
    ${card('shield', 'Show the evidence', 'Every finding comes with the objects, the gap or the threshold behind it, so you can check it and stand behind it.')}
    ${card('compare', 'Honest about limits', 'It is a planning and review tool, not a safety system. Features still being refined are marked experimental, and we say when another tool is the better choice.')}
    ${card('power', 'Simple to run', 'No server and no IT project. Install it from the browser, and it works offline.')}
  </div>
</div></section>
<section class="alt"><div class="wrap split">
  <div><h2>What is next</h2><ul class="ticks"><li>Weekly planning for the site team: a tablet-friendly look-ahead with percentage planned complete, working from the activities already in your programme.</li><li>Viewer-only access for colleagues who only need to look at results.</li></ul></div>
  <div><h2>Get in touch</h2><p class="sub">We read every message. Tell us about your project, or what you wish the tool did.</p><a class="btn" href="contact.html">Contact us</a> <a class="btn ghost" href="mailto:${CONTACT}">${CONTACT}</a></div>
</div></section>
${cta}`,
});

for (const p of pages) writeFileSync(path.join(OUT, p.file), page(p));
console.log(`${pages.length} pages written to ${OUT}`);
