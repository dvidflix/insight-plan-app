import fs from 'node:fs';
import path from 'node:path';

/** What is where in a project folder:

      <project>/
        insight-plan.db          programmes, scenarios, link groups, settings
        insight-plan-models.db   the stored models (IFC + converted copy)
        models/                  your IFC files
          edited/                IFCs the app wrote back (<name>_FIXED.ifc) with their change logs
        scenarios/               one folder per scenario: the generated programme and the caches it needs

    Folders made by earlier versions (1-input-ifc, fixed-models, 7-scenarios) keep working: an
    existing project uses the names it already has until it is tidied (migrateLayout). */

const NEW = { models: 'models', edited: 'edited', scenarios: 'scenarios' };
const OLD = { models: '1-input-ifc', edited: 'fixed-models', scenarios: '7-scenarios' };

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

export function modelsDir(root: string): string {
  if (isDir(path.join(root, NEW.models))) return path.join(root, NEW.models);
  if (isDir(path.join(root, OLD.models))) return path.join(root, OLD.models);
  return path.join(root, NEW.models);
}

export function scenariosDir(root: string): string {
  if (isDir(path.join(root, NEW.scenarios))) return path.join(root, NEW.scenarios);
  if (isDir(path.join(root, OLD.scenarios))) return path.join(root, OLD.scenarios);
  return path.join(root, NEW.scenarios);
}

export function editedDir(root: string): string {
  const inModels = path.join(modelsDir(root), NEW.edited);
  if (isDir(inModels)) return inModels;
  if (isDir(path.join(root, OLD.edited))) return path.join(root, OLD.edited);
  return inModels;
}

/** The folders of an earlier layout that are still in use. */
export function legacyFolders(root: string): string[] {
  const out: string[] = [];
  if (isDir(path.join(root, OLD.models)) && !isDir(path.join(root, NEW.models))) out.push(OLD.models);
  if (isDir(path.join(root, OLD.edited))) out.push(OLD.edited);
  if (isDir(path.join(root, OLD.scenarios)) && !isDir(path.join(root, NEW.scenarios))) out.push(OLD.scenarios);
  return out;
}

/** Renames the earlier folders to the current names. Nothing is overwritten: a folder whose new name is taken stays. */
export function migrateLayout(root: string): { renamed: string[]; skipped: string[] } {
  const renamed: string[] = [];
  const skipped: string[] = [];
  const move = (from: string, to: string) => {
    const a = path.join(root, from);
    const b = path.join(root, to);
    if (!isDir(a)) return;
    if (fs.existsSync(b)) {
      skipped.push(`${from} (${to} already exists)`);
      return;
    }
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
    renamed.push(`${from} → ${to}`);
  };
  move(OLD.models, NEW.models);
  move(OLD.edited, path.join(NEW.models, NEW.edited));
  move(OLD.scenarios, NEW.scenarios);
  return { renamed, skipped };
}
