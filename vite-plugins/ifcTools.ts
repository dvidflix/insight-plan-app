import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { HttpError, sendError } from './http';
import { engineEnv } from './engineFiles';

/** Dev-server bridge for the IFC clean-up buttons ("Apply changes permanently to IFC"): the bundled IfcOpenShell tool
    (scenario-engine/ifc_tools.py) run on the IFCs the app sends, one process per request.
    POST /api/ifc-tools/<strip|translate|merge|split>
      body: the arguments (JSON) then the IFC(s), one after the other; header x-sizes lists their byte sizes
      reply: the resulting IFC(s) one after the other; header x-parts lists {name, size}, x-result the tool's own JSON
    The app sends the models from memory, so nothing needs to be in the project folder. */

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scenario-engine/ifc_tools.py');
const LIMIT = 2 * 1024 * 1024 * 1024;

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > LIMIT) throw new HttpError(413, 'Files up to 2 GB.');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function runTool(op: string, argsFile: string): Promise<Record<string, any>> {
  const python = process.env.SCENARIO_PYTHON || 'python';
  return new Promise((resolve, reject) => {
    const child = spawn(python, [TOOL, op, argsFile], { cwd: path.dirname(TOOL), env: engineEnv(), windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new HttpError(500, `Could not start "${python}": ${e.message}. Install Python 3 with scenario-engine/requirements.txt (IfcOpenShell), or set SCENARIO_PYTHON.`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').filter(Boolean).pop();
      try {
        const reply = JSON.parse(line ?? '');
        if (reply.ok === false) return reject(new HttpError(500, reply.error));
        resolve(reply);
      } catch {
        reject(new HttpError(500, `The IFC tool stopped (exit ${code}). ${err.trim().split('\n').slice(-3).join(' ')}`));
      }
    });
  });
}

const safe = (name: string) => path.basename(name).replace(/[^A-Za-z0-9._ -]+/g, '-');

export function ifcToolsPlugin(): Plugin {
  return {
    name: 'insight-plan-ifc-tools',
    configureServer(server) {
      server.middlewares.use('/api/ifc-tools', async (req, res) => {
        let dir = '';
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const op = url.pathname.replace(/^\/+/, '');
          if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
          if (!['strip', 'translate', 'merge', 'split'].includes(op)) throw new HttpError(404, `Unknown IFC tool: ${op}`);
          const body = await readRaw(req);
          const all: number[] = String(req.headers['x-sizes'] ?? '').split(',').map(Number);
          if (all.length < 2 || all.some((n) => !Number.isFinite(n)) || all.reduce((a, b) => a + b, 0) !== body.length) throw new HttpError(400, 'The file sizes do not add up to what was sent.');
          const args = JSON.parse(body.subarray(0, all[0]).toString('utf8') || '{}');
          const sizes = all.slice(1);

          dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-ifc-'));
          const inputs: string[] = [];
          let at = all[0];
          sizes.forEach((n, i) => {
            const file = path.join(dir, `in${i}.ifc`);
            fs.writeFileSync(file, body.subarray(at, at + n));
            inputs.push(file);
            at += n;
          });
          const output = path.join(dir, 'out.ifc');
          const outDir = path.join(dir, 'out');
          const call: Record<string, unknown> = { ...args };
          if (op === 'merge') call.inputs = inputs.map((p, i) => ({ ...(args.offsets?.[i] ?? {}), path: p }));
          else call.input = inputs[0];
          if (op !== 'split') call.output = output;
          else call.outputDir = outDir;
          delete call.offsets;
          const argsFile = path.join(dir, 'args.json');
          fs.writeFileSync(argsFile, JSON.stringify(call), 'utf8');

          const result = await runTool(op, argsFile);
          const files = op === 'split' ? fs.readdirSync(outDir).filter((f) => /\.ifc$/i.test(f)).sort().map((f) => path.join(outDir, f)) : [output];
          const parts = files.map((f) => ({ name: op === 'split' ? safe(f) : 'out.ifc', size: fs.statSync(f).size }));
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('x-parts', encodeURIComponent(JSON.stringify(parts)));
          res.setHeader('x-result', encodeURIComponent(JSON.stringify(result)));
          res.end(Buffer.concat(files.map((f) => fs.readFileSync(f))));
        } catch (e) {
          sendError(res, e);
        } finally {
          if (dir) fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    },
  };
}
