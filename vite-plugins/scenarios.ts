import { modelsDir, scenariosDir } from './projectLayout';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';
import { projectDb } from './db/projectDb';
import { readLegacyWorkbook, type ScenarioContent, type SequenceItem } from './db/scenarioFiles';

/** Dev-server bridge for Scenarios: a project folder holding the buildings'
    models (models/, and 2-enriched-ifc with each one's geometry cache
    when the full CWA workflow has run), scenarios kept in the project
    database (<root>/insight-plan.db, ip_scenario* tables — see
    db/projectDb.ts), and the bundled Python generator (scenario-engine) — a
    long-running process for the pour list and quick updates (serve.py), the
    one-shot main.py for full runs, whose outputs stay in
    <root>/scenarios/<name>. No Excel is needed: the project's legacy
    Overrides workbook (4-schedule-xlsx) is only read, as the base order. */

const ENGINE_MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scenario-engine/main.py');
const ENGINE_SERVE = path.resolve(path.dirname(ENGINE_MAIN), 'serve.py');
/** Working folder for the pour list / automatic order (not a scenario). */
const BASE_DIR = '_base';
const running = new Set<string>();

/** Any existing folder is a project: its models are in models/, made
    when the first one is added from the app (POST model). */
function projectRoot(raw: unknown): string {
  const root = String(raw ?? '').trim();
  if (!root) throw new HttpError(400, 'No project folder given.');
  const abs = path.resolve(root);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new HttpError(400, `There is no folder "${abs}".`);
  return abs;
}

/** Documents\Insight Plan\Default project: where Scenarios works when no
    project folder has been picked. */
function defaultRoot(): string {
  const dir = path.join(os.homedir(), 'Documents', 'Insight Plan', 'Default project');
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  return dir;
}

/** Puts a model loaded in the app into the project (models/<stem>.ifc).
    Replacing one drops what the app built from the old file (its enriched
    copies and caches under scenarios/) and the generator's loaded copy. */
async function addModel(root: string, stem: string, body: NodeJS.ReadableStream) {
  const dir = modelsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stem}.ifc`);
  const tmp = `${file}.uploading`;
  await pipeline(body, fs.createWriteStream(tmp));
  const head = Buffer.alloc(16);
  const fd = fs.openSync(tmp, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (!head.toString('latin1').startsWith('ISO-10303-21')) {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(400, 'That is not an IFC file (it should start with ISO-10303-21).');
  }
  const replaced = fs.existsSync(file);
  fs.renameSync(tmp, file);
  let note: string | null = null;
  if (replaced) {
    worker.stop();
    const scenarios = scenariosDir(root);
    if (fs.existsSync(scenarios)) {
      for (const d of fs.readdirSync(scenarios, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const enriched = path.join(scenarios, d.name, '2-enriched-ifc');
        if (!fs.existsSync(enriched)) continue;
        for (const f of fs.readdirSync(enriched)) if (f.startsWith(`${stem}.`)) fs.rmSync(path.join(enriched, f), { force: true });
      }
    }
    if (fs.existsSync(path.join(root, '2-enriched-ifc', `${stem}.ifc`))) {
      note = `2-enriched-ifc/${stem}.ifc (from the full CWA workflow) is still the older model and is used first — delete it, or run the workflow again, so the new model is used.`;
    }
  }
  return { stem, replaced, note };
}

function safeName(raw: unknown, what: string): string {
  const name = String(raw ?? '').trim();
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new HttpError(400, `Invalid ${what}: "${name}".`);
  return name;
}

const scenarioDirOf = (root: string, scenario: string) => path.join(scenariosDir(root), scenario);
const legacyBaseWorkbook = (root: string, stem: string) => path.join(root, '4-schedule-xlsx', `${stem}_Overrides.xlsx`);

/** Buildings: the models in models/. `cached`: the full workflow's
    enriched IFC + geometry cache exist, so the pour list and updates are
    quick from the start; otherwise the first one builds them (minutes). */
function listModels(root: string) {
  const enriched = (stem: string, dir: string) => fs.existsSync(path.join(dir, `${stem}.ifc`)) && fs.existsSync(path.join(dir, `${stem}.geometry_cache.json`));
  const input = modelsDir(root);
  if (!fs.existsSync(input)) return [];
  return fs
    .readdirSync(input)
    .filter((f) => /\.ifc$/i.test(f))
    .map((f) => f.replace(/\.ifc$/i, ''))
    .sort()
    .map((stem) => ({
      stem,
      hasSource: true,
      cached: enriched(stem, path.join(root, '2-enriched-ifc')) || enriched(stem, path.join(scenariosDir(root), BASE_DIR, '2-enriched-ifc')),
    }));
}

/** The saved scenarios (project database); "generated" is the scenario's
    programme in the database, else the generator's last XML on disk. */
function listScenarios(root: string) {
  return projectDb(root)
    .listScenarios()
    .map((s) => ({
      ...s,
      models: s.models.map((m) => {
        const xml = path.join(scenarioDirOf(root, s.name), '3-schedule-xml', `${m.stem}.xml`);
        return { ...m, generated: m.generated ?? (fs.existsSync(xml) ? fs.statSync(xml).mtimeMs : null) };
      }),
    }));
}

// ---- Scenario content: pour order, manual links, crews ----

const writeScenario = (root: string, scenario: string, stem: string, content: ScenarioContent) => projectDb(root).writeScenario(scenario, stem, content);

/** The generator reads a scenario from a JSON file: a temporary one, written
    from the database for the run. */
function withOverridesFile<T>(content: ScenarioContent, stem: string, fn: (file: string) => Promise<T>): Promise<T> {
  const file = path.join(os.tmpdir(), `insight-plan-${process.pid}-${Date.now()}-${stem}.scenario.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 1, building: stem, sequence: content.sequence, relations: content.relations, crews: content.crews, wbsOrder: content.wbsOrder }));
  return fn(file).finally(() => fs.rmSync(file, { force: true }));
}

/** The SequenceOrder rows the generator uses: Index (numbers only), GUID, Phase. */
function toSequence(headers: string[], rows: string[][]): SequenceItem[] {
  const idx = headers.indexOf('Index');
  const guid = headers.indexOf('GUID');
  const phase = headers.indexOf('Phase') >= 0 ? headers.indexOf('Phase') : headers.indexOf('Activity');
  return rows
    .filter((r) => idx >= 0 && /^\s*\d+(\.\d+)?\s*$/.test(r[idx] ?? '') && (r[guid] ?? '').trim())
    .map((r) => ({ GUID: r[guid].trim(), Index: Math.trunc(Number(r[idx])), Phase: phase >= 0 ? (r[phase] ?? '').trim() : '' }));
}

function contentOf(body: any): ScenarioContent {
  if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) throw new HttpError(400, 'Missing pour list.');
  return {
    sequence: toSequence(body.headers, body.rows),
    relations: Array.isArray(body.relations) ? body.relations : [],
    crews: Array.isArray(body.crews) ? body.crews : [],
    flags: Array.isArray(body.flags) ? body.flags : [],
    wbsOrder: body.wbsOrder && typeof body.wbsOrder === 'object' ? body.wbsOrder : undefined,
  };
}

// ---- Model inputs for the generator ----

/** Gives a working folder the building's enriched IFC + geometry cache:
    the full workflow's (2-enriched-ifc) or, failing that, the one the
    pour-list folder built. The IFC is only read, so it's hard-linked
    (instant) where possible; the cache is copied, and only when newer — a
    folder's own, rebuilt cache must not be replaced by an older copy. */
function stageInputs(root: string, workDir: string, stem: string) {
  const candidates = [path.join(root, '2-enriched-ifc'), path.join(scenariosDir(root), BASE_DIR, '2-enriched-ifc')];
  const ifcDir = path.join(workDir, '2-enriched-ifc');
  const srcDir = candidates.find((d) => d !== ifcDir && fs.existsSync(path.join(d, `${stem}.ifc`)) && fs.existsSync(path.join(d, `${stem}.geometry_cache.json`)));
  if (!srcDir) return;
  fs.mkdirSync(ifcDir, { recursive: true });
  const srcIfc = path.join(srcDir, `${stem}.ifc`);
  const srcCache = path.join(srcDir, `${stem}.geometry_cache.json`);
  const dstIfc = path.join(ifcDir, `${stem}.ifc`);
  const srcStat = fs.statSync(srcIfc);
  const dstStat = fs.existsSync(dstIfc) ? fs.statSync(dstIfc) : null;
  if (!dstStat || dstStat.ino !== srcStat.ino || dstStat.mtimeMs !== srcStat.mtimeMs) {
    fs.rmSync(dstIfc, { force: true });
    try {
      fs.linkSync(srcIfc, dstIfc);
    } catch {
      fs.copyFileSync(srcIfc, dstIfc);
    }
  }
  const dstCache = path.join(ifcDir, `${stem}.geometry_cache.json`);
  if (!fs.existsSync(dstCache) || fs.statSync(srcCache).mtimeMs > fs.statSync(dstCache).mtimeMs) fs.copyFileSync(srcCache, dstCache);
}

/** One-shot full run (main.py --stage schedule) from a scenario JSON file.
    XML only: nothing in the app reads the Excel report. */
function runEngine(root: string, workDir: string, stem: string, startDate: string | null, overridesJson: string): Promise<{ code: number | null; log: string }> {
  const python = process.env.SCENARIO_PYTHON || 'python';
  const args = [ENGINE_MAIN, '--input', path.join(modelsDir(root), `${stem}.ifc`), '--stage', 'schedule', '--skip-master-excel', '--skip-excel', '--output-dir', workDir, '--workers', '1', '--overrides-json', overridesJson];
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: path.dirname(ENGINE_MAIN),
      // The generator prints emoji progress markers; without UTF-8 stdout a
      // Windows console codepage makes those prints throw.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', CWA_START_DATE: startDate ?? '' },
      windowsHide: true,
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d.toString('utf8')));
    child.stderr.on('data', (d) => (log += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new HttpError(500, `Could not start "${python}": ${e.message}. Install Python 3 with scenario-engine/requirements.txt, or set SCENARIO_PYTHON.`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

/** Full run for a scenario: saves it, runs main.py, returns the XML. What
    Update 4D falls back to the first time, to build a building's geometry cache. */
async function fullRun(root: string, scenario: string, stem: string, content: ScenarioContent, startDate: string | null) {
  const key = `${root}|${scenario}|${stem}`;
  if (running.has(key)) throw new HttpError(409, 'This scenario is already generating.');
  running.add(key);
  try {
    writeScenario(root, scenario, stem, content);
    const workDir = scenarioDirOf(root, scenario);
    stageInputs(root, workDir, stem);
    const xmlPath = path.join(workDir, '3-schedule-xml', `${stem}.xml`);
    const before = fs.existsSync(xmlPath) ? fs.statSync(xmlPath).mtimeMs : 0;
    const { code, log } = await withOverridesFile(content, stem, (file) => runEngine(root, workDir, stem, startDate, file));
    const fresh = fs.existsSync(xmlPath) && fs.statSync(xmlPath).mtimeMs > before;
    if (!fresh) throw new HttpError(500, `The generator produced no XML (exit code ${code}).\n\n${log.slice(-6000)}`);
    return { xml: fs.readFileSync(xmlPath, 'utf8'), log, warning: code === 0 ? null : `Generator exited with code ${code} after writing the XML.` };
  } finally {
    running.delete(key);
  }
}

// ---- The long-running generator (scenario-engine/serve.py) ----

interface WorkerReply {
  id: number;
  ok: boolean;
  xml?: string;
  error?: string;
  trace?: string;
  needsFullRun?: boolean;
  log?: string;
  seconds?: number;
  headers?: string[];
  rows?: string[][];
  trades?: unknown[];
  phases?: string[];
  defaultCrews?: unknown[];
}

/** One Python process kept running, holding each building's opened model
    and pour records (see serve.py): an update takes about a second instead
    of a full run's ~15 s. Requests go one at a time; (re)started on demand. */
class EngineWorker {
  private child: ChildProcess | null = null;
  private buffer = '';
  private stderr = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: WorkerReply) => void; reject: (e: Error) => void }>();
  private chain: Promise<unknown> = Promise.resolve();

  private ensure() {
    if (this.child) return this.child;
    const python = process.env.SCENARIO_PYTHON || 'python';
    const child = spawn(python, [ENGINE_SERVE], {
      cwd: path.dirname(ENGINE_SERVE),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
    });
    this.child = child;
    this.buffer = '';
    this.stderr = '';
    child.stdout!.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8');
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const reply = JSON.parse(line) as WorkerReply;
          this.pending.get(reply.id)?.resolve(reply);
          this.pending.delete(reply.id);
        } catch {
          // not a reply line
        }
      }
    });
    child.stderr!.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString('utf8')).slice(-20000);
    });
    const fail = (why: string) => {
      if (this.child !== child) return;
      this.child = null;
      for (const p of this.pending.values()) p.reject(new HttpError(500, `${why}\n\n${this.stderr.slice(-6000)}`));
      this.pending.clear();
    };
    child.on('error', (e) => fail(`Could not start "${python}": ${e.message}. Install Python 3 with scenario-engine/requirements.txt, or set SCENARIO_PYTHON.`));
    child.on('exit', (code) => fail(`The generator process stopped (exit code ${code}).`));
    return child;
  }

  request(payload: Record<string, unknown>): Promise<WorkerReply> {
    const run = () =>
      new Promise<WorkerReply>((resolve, reject) => {
        const child = this.ensure();
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new HttpError(500, 'The generator did not answer within 10 minutes.'));
        }, 10 * 60 * 1000);
        this.pending.set(id, {
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        child.stdin!.write(JSON.stringify({ ...payload, id }) + '\n');
      });
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }
}

const worker = new EngineWorker();

/** A building's first preparation run (class fixing, clash detection,
    geometry cache) in progress, by base folder + building: every request
    for its pour list meanwhile waits on the same run instead of starting
    another one that would write the same files. */
const preparing = new Map<string, Promise<void>>();

function prepareOnce(root: string, workDir: string, stem: string): Promise<void> {
  const key = `${workDir}|${stem}`;
  let run = preparing.get(key);
  if (!run) {
    run = (async () => {
      const empty = path.join(workDir, `${stem}.scenario.json`);
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(empty, JSON.stringify({ version: 1, building: stem, sequence: [], relations: [], crews: [] }));
      const { code, log } = await runEngine(root, workDir, stem, null, empty);
      if (code !== 0) throw new HttpError(500, `Preparing ${stem} failed (exit code ${code}).\n\n${log.slice(-6000)}`);
    })().finally(() => preparing.delete(key));
    preparing.set(key, run);
  }
  return run;
}

function checkModel(root: string, stem: string) {
  if (!listModels(root).some((m) => m.stem === stem)) throw new HttpError(404, `No models/${stem}.ifc in the project folder.`);
}

/** The building's pours (with the SequenceOrder columns) and the
    generator's automatic order — built once, in 7-scenarios/_base; a
    building without a geometry cache gets one full run there first. */
async function pourList(root: string, stem: string) {
  checkModel(root, stem);
  const workDir = scenarioDirOf(root, BASE_DIR);
  stageInputs(root, workDir, stem);
  const ask = () => worker.request({ op: 'pours', input: path.join(modelsDir(root), `${stem}.ifc`), scenarioDir: workDir, startDate: null });
  // While a preparation runs, wait for it rather than asking (and starting another).
  await preparing.get(`${workDir}|${stem}`);
  let reply = await ask();
  if (!reply.ok && reply.needsFullRun) {
    await prepareOnce(root, workDir, stem);
    reply = await ask();
  }
  if (!reply.ok) throw new HttpError(500, `${reply.error}\n\n${reply.trace ?? ''}${reply.log ?? ''}`);
  return reply;
}

/** The pour table for a scenario (or, with scenario null, the base order):
    the building's pours, each row's Index from the scenario (project
    database) or the base (legacy project workbook, else the generator's
    automatic order). Plus the manual links and crews. */
async function readSequence(root: string, stem: string, scenario: string | null) {
  const pours = await pourList(root, stem);
  const headers = pours.headers!;
  const indexCol = headers.indexOf('Index');
  const guidCol = headers.indexOf('GUID');
  const own = scenario ? projectDb(root).readScenario(scenario, stem) : null;
  const legacyBase = readLegacyWorkbook(legacyBaseWorkbook(root, stem));
  const base = legacyBase && legacyBase.sequence.length ? legacyBase : null;
  const source = own ? 'scenario' : base ? 'legacy' : 'auto';
  const chosen = own ?? base;
  let rows = pours.rows!;
  if (chosen) {
    const indexOf = new Map(chosen.sequence.map((s) => [s.GUID, String(s.Index)]));
    rows = rows.map((r) => {
      const next = [...r];
      next[indexCol] = indexOf.get(r[guidCol]) ?? '';
      return next;
    });
  }
  return {
    headers,
    rows,
    source,
    relations: (own ?? legacyBase)?.relations ?? [],
    crews: (own ?? legacyBase)?.crews ?? [],
    flags: own?.flags ?? [],
    trades: pours.trades,
    phases: pours.phases,
    defaultCrews: pours.defaultCrews,
  };
}

/** "Update 4D": the XML for the order on screen from the long-running
    generator (about a second). Not saved (Save does that). A building
    without a geometry cache gets one full run instead, which builds it. */
async function quickGenerate(root: string, scenario: string, stem: string, content: ScenarioContent, startDate: string | null) {
  checkModel(root, stem);
  const workDir = scenarioDirOf(root, scenario);
  stageInputs(root, workDir, stem);
  const reply = await worker.request({ op: 'generate', input: path.join(modelsDir(root), `${stem}.ifc`), scenarioDir: workDir, startDate, sequence: content.sequence, relations: content.relations, crews: content.crews, wbsOrder: content.wbsOrder });
  if (!reply.ok) {
    if (reply.needsFullRun) return { ...(await fullRun(root, scenario, stem, content, startDate)), fast: false, seconds: null };
    throw new HttpError(500, `${reply.error}\n\n${reply.trace ?? ''}${reply.log ?? ''}`);
  }
  return { xml: fs.readFileSync(reply.xml!, 'utf8'), log: reply.log ?? '', warning: null, fast: true, seconds: reply.seconds ?? null };
}

export function scenariosPlugin(): Plugin {
  return {
    name: 'insight-plan-scenarios',
    configureServer(server) {
      server.httpServer?.on('close', () => worker.stop());
      server.middlewares.use('/api/scenarios', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const q = url.searchParams;
          const route = url.pathname.replace(/^\/+/, '');
          if (req.method === 'GET' && route === 'default-root') return send(res, 200, { root: defaultRoot() });
          if (req.method === 'POST' && route === 'model') {
            return send(res, 200, await addModel(projectRoot(q.get('root')), safeName(q.get('stem'), 'model'), req));
          }
          if (req.method === 'GET' && route === 'project') {
            const root = projectRoot(q.get('root'));
            return send(res, 200, { root, models: listModels(root), scenarios: listScenarios(root) });
          }
          if (req.method === 'GET' && route === 'sequence') {
            const root = projectRoot(q.get('root'));
            const scenario = q.get('scenario') ? safeName(q.get('scenario'), 'scenario name') : null;
            return send(res, 200, await readSequence(root, safeName(q.get('stem'), 'model'), scenario));
          }
          if (req.method === 'GET' && route === 'xml') {
            const root = projectRoot(q.get('root'));
            const file = path.join(scenarioDirOf(root, safeName(q.get('scenario'), 'scenario name')), '3-schedule-xml', `${safeName(q.get('stem'), 'model')}.xml`);
            if (!fs.existsSync(file)) throw new HttpError(404, 'This scenario has not been generated for that model yet.');
            return send(res, 200, { xml: fs.readFileSync(file, 'utf8') });
          }
          if (req.method === 'POST' && route === 'delete') {
            const body = await readBody(req);
            const root = projectRoot(body.root);
            const scenario = safeName(body.scenario, 'scenario name');
            projectDb(root).deleteScenario(scenario);
            // The generator's files for it (XML, caches) go too — only inside the project's scenarios folder.
            const dir = path.resolve(scenarioDirOf(root, scenario));
            if (dir.startsWith(path.resolve(scenariosDir(root)) + path.sep) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && route === 'warm') {
            const body = await readBody(req);
            const root = projectRoot(body.root);
            const stem = safeName(body.stem, 'model');
            const workDir = scenarioDirOf(root, safeName(body.scenario, 'scenario name'));
            stageInputs(root, workDir, stem);
            const reply = await worker.request({ op: 'warm', input: path.join(modelsDir(root), `${stem}.ifc`), scenarioDir: workDir }).catch(() => ({ ok: false }));
            return send(res, 200, { ok: reply.ok });
          }
          if (req.method === 'POST' && (route === 'save' || route === 'update')) {
            const body = await readBody(req);
            const root = projectRoot(body.root);
            const scenario = safeName(body.scenario, 'scenario name');
            if (scenario.startsWith('_')) throw new HttpError(400, 'Scenario names cannot start with "_".');
            const stem = safeName(body.stem, 'model');
            const content = contentOf(body);
            if (route === 'save') {
              writeScenario(root, scenario, stem, content);
              return send(res, 200, { ok: true });
            }
            const startDate = typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
            return send(res, 200, await quickGenerate(root, scenario, stem, content, startDate));
          }
          throw new HttpError(404, `Unknown scenarios endpoint: ${req.method} ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
