// Generates the static pages of the website (no dependencies):  node website/build.mjs
// Edit the text and prices here, run it, then copy the website folder (without build.mjs) to the NAS.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { appWindow, building, curves, logoMark } from './visuals.mjs';

const OUT = import.meta.dirname;
const SITE = 'Insight Plan';
const CONTACT = 'hello@example.com'; // <- your contact address

/** Indicative prices: confirm them before publishing. */
const PRICING = {
  currency: '£',
  pilot: { price: '15,000', note: 'fixed fee, 3 months' },
  project: { price: '40,000', note: 'per project, per year' },
  seat: { price: '2,400', note: 'per planner, per year' },
};

const NAV = [
  ['features.html', 'Features'],
  ['solutions.html', 'Solutions'],
  ['pricing.html', 'Pricing'],
  ['resources.html', 'Resources'],
];

const LOGO = logoMark('lg');
const WORDMARK = '<span><b>Insight</b> <i>Plan</i></span>';

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
  compare: '<path d="M8 3H4v18h4M16 3h4v18h-4M12 3v18"/>',
};

const page = ({ file, title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="logo" href="index.html">${LOGO}${WORDMARK}</a>
    <nav>
      ${NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
      <a class="btn" href="contact.html">Request a pilot</a>
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer>
  <div class="wrap foot">
    <div><a class="logo" href="index.html">${LOGO}${WORDMARK}</a><p class="note">4D planning for complex construction. Works offline.</p></div>
    <div><strong>Product</strong>${NAV.slice(0, 3).map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>
    <div><strong>Company</strong><a href="resources.html">Resources</a><a href="contact.html">Contact</a></div>
    <div class="legal">&copy; <span id="y">2026</span> ${SITE}. Primavera and P6 are trademarks of Oracle; ${SITE} is not affiliated with Oracle.</div>
  </div>
</footer>
<script>document.getElementById('y').textContent = new Date().getFullYear();</script>
</body>
</html>
`;

const head = (tag, h1, lead) => `<div class="wrap pagehead">${tag ? `<span class="tag">${tag}</span>` : ''}<h1>${h1}</h1><p class="lead">${lead}</p></div>`;
const cta = `<section class="contact"><div class="wrap"><h2>Run a pilot on a real project</h2><p class="sub">Bring a live programme and its model. We will set up a short, fixed-price pilot and show what it finds.</p><a class="btn" href="contact.html">Request a pilot</a></div></section>`;


const card = (ic, h, p, extra = '') => `<div class="card">${icon(ICONS[ic])}<h3>${h}${extra}</h3><p>${p}</p></div>`;
const exp = ' <span class="soon">Experimental</span>';

const pages = [];

// ---------------------------------------------------------------- Home
const row = (flip, kicker, h, p, bullets, visual) => `<section class="feature${flip ? ' flip' : ''}"><div class="wrap split">
  <div><span class="kicker">${kicker}</span><h2>${h}</h2><p class="sub" style="margin-bottom:0">${p}</p>${bullets ? `<ul class="ticks">${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}</div>
  <div class="visual">${visual}</div>
</div></section>`;
const stat = (big, small) => `<div class="stat"><b>${big}</b><span>${small}</span></div>`;

pages.push({
  file: 'index.html',
  title: `${SITE}: 4D planning that works on your laptop`,
  description: 'Insight Plan turns Primavera programmes and IFC models into a 4D construction sequence. Works offline, keeps your data on your machine, built for heavy civil and nuclear projects.',
  body: `<div class="hero">
  <span class="tag">Planning and 4D for complex construction</span>
  <h1>See the programme.<br><span class="grad">Build it before you build it.</span></h1>
  <p class="lead">${SITE} links your Primavera P6 programme to the IFC model and plays the build forward in 4D, so you can test a better sequence before it costs anything.</p>
  <div class="cta"><a class="btn" href="contact.html">Request a pilot</a><a class="btn ghost" href="features.html">See the features</a></div>
  ${appWindow()}
  <p class="note">Illustration with generic data. Real screenshots will replace it once they are cleared for publishing.</p>
</div>
<section class="stats"><div class="wrap">
  ${stat('P6 + IFC', 'the files you already have')}
  ${stat('0 bytes', 'sent to a cloud service')}
  ${stat('1 folder', 'installs on a Windows laptop')}
  ${stat('Offline', 'no internet needed to run')}
</div></section>
${row(false, '4D sequencing', 'Watch the build happen.', 'Link each activity to the objects it builds and play the programme forward, date by date. Anyone can see what is built, what is being poured and what comes next.', ['Compare two sequences side by side', 'Export images, video or a Navisworks TimeLiner pack'], building({ phase: 6, width: 480 }))}
${row(true, 'Resource peaks', 'Find the peaks before the site does.', "Weekly and cumulative concrete and rebar from the programme's own resources. Overlay a new draft on the baseline and see exactly where they part company.", ['By week, month, quarter or year', 'Export the chart as an image or the data as CSV'], curves())}
${row(false, 'Private by design', 'Your data stays on your machine.', `${SITE} runs on the planner's own Windows laptop and works with no internet connection. No account, no sign-in, no telemetry.`, ['Programmes and models stay in your project folder', 'Installed from a single folder, updated when you choose'], `<div class="lockcard"><div class="lockring">${icon(ICONS.lock)}</div><b>Nothing leaves this computer</b><span>Models are converted and drawn in the app.</span></div>`)}
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
  description: 'What Insight Plan does: 4D sequencing, programme analysis, concrete and rebar distribution, model colouring and filtering, reports and exports.',
  body: `${head('Features', 'Everything between the programme and the model', 'One tool to load, link, analyse and present. Nothing to install on a server, nothing sent to the cloud.')}
${row(false, 'Link', 'Activities and objects, joined by rules.', 'Link groups connect activities to model objects by rules on their properties, so a programme revision re-links without starting over, and a check lists what is left unlinked.', ['Works on the properties your model already has', 'Re-runs after every revision'], building({ phase: 8, colourBy: 'level', width: 460 }))}
${row(true, 'Sequence', '4D, with the programme beside it.', 'Play the build forward date by date, with the Gantt chart and the weekly numbers in the same window. Compare two sequences side by side or with a slider.', ['Images and video with date labels and captions', 'Save a scene: camera, split view and filters'], appWindow())}
${row(false, 'Analyse', 'Concrete and rebar by week.', 'Quantities come straight from the resources in the programme. Overlay a baseline and a new draft, group by week, month, quarter or year, and colour the lines as you like.', ['Weekly bars and cumulative lines', 'Export the chart as an image, the data as CSV'], curves())}
<section class="alt"><div class="wrap">
  <h2>And the rest of the toolbox</h2>
  <p class="sub">Programme analysis, model tools and exports, working on the same files.</p>
  <div class="grid">
    ${card('gantt', 'Programme analysis', 'Gantt, WBS, calendars, critical path, resource loading and checks, on XER and XML programmes. Group, filter, sort and colour with the same rules throughout.')}
    ${card('compare', 'Programme comparison', 'Overlay programmes and their curves to see what a revision changed, and try what-if changes to see their effect.')}
    ${card('palette', 'Colour, filter and isolate', 'Colour the model by any property, hide or isolate parts, and order the legend the way you want it.')}
    ${card('table', 'Reports and data exports', 'Excel, CSV, P6 XER and XML, and a Navisworks TimeLiner pack, so your data goes out in formats other tools read.')}
    ${card('film', 'Images and video', 'Export 4D sequences as images or video, from one or two views.')}
    ${card('loop', 'Programme generator', 'Generate a pour-by-pour programme from the model, your crews and rules, then adjust it by hand and compare the options. Switched on in Settings.', exp)}
  </div>
</div></section>
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
  ${problem(5, 'The tools want your data on someone else\'s server', 'Sensitive projects cannot upload models and programmes to a cloud service, or wait for IT to approve one.', 'It runs on the planner\'s own laptop with no internet connection. No account, no telemetry, and your files stay in your project folder.')}
  ${problem(6, 'Sharing a programme without sharing the project', 'A programme often has to go to a third party with names, codes and people removed.', 'An anonymise tool replaces names and codes consistently so a programme can be shared safely.')}
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Pricing
const tier = (cls, name, price, per, blurb, items, button, btnClass = '') => `<div class="tier${cls ? ` ${cls}` : ''}">
  ${cls ? '<span class="badge">Most popular</span>' : ''}
  <h3>${name}</h3>
  <div class="price">${price}<span>${per}</span></div>
  <p class="blurb">${blurb}</p>
  <ul class="ticks">${items.map((i) => `<li>${i}</li>`).join('')}</ul>
  <a class="btn ${btnClass}" href="contact.html">${button}</a>
</div>`;
const money = (v) => `${PRICING.currency}${v}`;
pages.push({
  file: 'pricing.html',
  title: `Pricing | ${SITE}`,
  description: 'Insight Plan pricing: a fixed-fee pilot, a per-project licence with planner seats, and enterprise agreements.',
  body: `${head('Pricing', 'Start with a pilot. Grow by project.', 'Priced per project, because that is how construction work is budgeted. Prices are indicative and exclude tax.')}
<section class="alt"><div class="wrap">
  <div class="tiers">
    ${tier('', 'Pilot', money(PRICING.pilot.price), ` ${PRICING.pilot.note}`, 'Try it on one live project with our help setting it up.', ['One project, up to 3 planners', 'Set-up and training included', 'Import of your programme and models', 'Credited against a project licence if you continue'], 'Request a pilot', 'ghost')}
    ${tier('featured', 'Project', money(PRICING.project.price), ` ${PRICING.project.note}`, 'For a project team using it as part of its planning routine.', ['Unlimited models and programmes on the project', `${money(PRICING.seat.price)} ${PRICING.seat.note}`, 'Installer and updates for the licence term', 'Standard support, by email', 'Concrete and rebar analysis, 4D, comparison, exports'], 'Talk to us')}
    ${tier('', 'Enterprise', 'Custom', '', 'For organisations running several projects.', ['All projects under one agreement', 'Priority support and onboarding', 'Validation pack and security questionnaire support', 'Volume terms and multi-year options'], 'Contact us', 'ghost')}
  </div>
  <p class="note" style="margin-top:26px;text-align:center">Viewer-only access for colleagues who only need to look at results is planned. The experimental programme generator can be switched on for any tier.</p>
</div></section>
<section><div class="wrap">
  <h2>Common questions</h2>
  <div class="faq">
    <details><summary>Why price per project?</summary><p>Construction budgets are set per project. A project licence matches how you buy, and avoids counting every person who looks at a result.</p></details>
    <details><summary>What happens after the pilot?</summary><p>You keep your files, since they stay on your machine. If you continue, the pilot fee is credited against the first project licence.</p></details>
    <details><summary>Do you need a server or an IT project?</summary><p>No. It installs from a single folder on a Windows laptop and works offline.</p></details>
    <details><summary>Is a free trial available?</summary><p>The pilot is the trial: a short, fixed-fee engagement on your own data, which tells you more than a demo.</p></details>
  </div>
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
    <h2>System requirements</h2>
    <ul class="ticks">
      <li>Windows 10 or 11</li>
      <li>Chrome or Edge</li>
      <li>16 GB of memory recommended for large models</li>
      <li>Python 3.12 only if you use the experimental programme generator</li>
      <li>No internet connection needed to run</li>
    </ul>
  </div>
  <div>
    <h2>Data handling</h2>
    <p class="sub" style="margin-bottom:0">Programmes, models and results are read and saved in the project folder you choose, on your computer. The app does not send them anywhere and has no account or telemetry. A third-party software list ships with each release.</p>
  </div>
</div></section>
<section class="alt"><div class="wrap">
  <h2>Frequently asked</h2>
  <div class="faq">
    <details><summary>Which programme formats can it read?</summary><p>Primavera P6 XER and XML, and spreadsheet and CSV exports. It also writes XER and XML.</p></details>
    <details><summary>Which model formats?</summary><p>IFC. Models are converted and drawn in the app on your own machine.</p></details>
    <details><summary>Can it be used for safety-related decisions?</summary><p>No. It is a planning and review tool. It does not replace your safety case or approved engineering processes.</p></details>
    <details><summary>How do updates work?</summary><p>You receive a new version as a folder or installer and install it when you choose. The app does not update itself over the internet.</p></details>
    <details><summary>Will there be a multi-user, cloud version?</summary><p>The weekly planning module for site teams is in development and is designed for tablets and several users at once. The planning workbench stays offline.</p></details>
  </div>
</div></section>
${cta}`,
});

// ---------------------------------------------------------------- Contact
pages.push({
  file: 'contact.html',
  title: `Contact | ${SITE}`,
  description: 'Request a pilot of Insight Plan on a live project.',
  body: `${head('Contact', 'Request a pilot', 'Tell us about your project and what you need to answer. We will reply with a short plan and a fixed price.')}
<section class="alt"><div class="wrap split">
  <div>
    <h2>Send us a note</h2>
    <p class="sub">Write to <a href="mailto:${CONTACT}?subject=${encodeURIComponent(`${SITE} pilot`)}">${CONTACT}</a> and include:</p>
    <ul class="ticks">
      <li>The kind of project, and your role</li>
      <li>The programme format you use (XER, XML) and the model format (IFC)</li>
      <li>The main question you want to answer, such as resource peaks or comparing revisions</li>
      <li>Any restrictions on data handling we should know about</li>
    </ul>
    <p style="margin-top:22px"><a class="btn" href="mailto:${CONTACT}?subject=${encodeURIComponent(`${SITE} pilot`)}">Email us</a></p>
  </div>
  <div class="card"><h3>What happens next</h3><ul class="ticks"><li>A short call to understand the project</li><li>A fixed-fee pilot plan</li><li>Set-up on your machines, with your data staying with you</li></ul></div>
</div></section>`,
});

for (const p of pages) writeFileSync(path.join(OUT, p.file), page(p));
console.log(`${pages.length} pages written to ${OUT}`);
