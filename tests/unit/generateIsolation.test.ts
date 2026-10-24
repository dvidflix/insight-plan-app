import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Generate (the four steps) is the one way to make a programme: nothing in it may lead to classic Generate (page 'scenarios', its eight tabs) or
    show the classic scenario panel, and classic Generate shows only when its experimental flag is on. These read the source, so a change that
    wires a classic tab or page into Generate fails here first. */

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const g3Dir = 'src/components/scenarios/Generate3';
const generateFiles = ['src/pages/Generate3Page.tsx', ...readdirSync(join(root, g3Dir)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${g3Dir}/${f}`)];

describe('Generate never leads to classic Generate', () => {
  it.each(generateFiles)('%s', (file) => {
    const src = read(file);
    // The classic tabs, their store, page and panels.
    expect(src).not.toMatch(/from '[./]*(components\/scenarios\/|\.\.\/)?GenerateTabs'/);
    expect(src).not.toMatch(/useGenerateTab/);
    expect(src).not.toMatch(/ScenariosPage/);
    expect(src).not.toMatch(/\bScenarioPanelBody\b|\bScenarioRulesEditor\b|\bOrderPanel\b|\bPlanTablesScreen\b|\bResourcesScreen\b/);
    // No move to the classic page.
    expect(src).not.toMatch(/detail:\s*'scenarios'/);
    expect(src).not.toMatch(/goTo\('scenarios'\)|onPage\('scenarios'\)/);
  });
});

describe('classic Generate is behind its flag', () => {
  const app = read('src/App.tsx');
  it('the page list leaves it out unless the flag is on', () => {
    expect(app).toMatch(/\(p\.id !== 'scenarios' \|\| classicOn\)/);
  });
  it('a request for its page opens Generate instead', () => {
    expect(app).toMatch(/if \(id === 'scenarios' && !useAppPrefsStore\.getState\(\)\.experimental\.classicGenerate\) id = 'generate3';/);
  });
  it('global search offers Generate’s steps, not the classic tabs, outside classic Generate', () => {
    const search = read('src/components/GlobalSearch.tsx');
    expect(search).toMatch(/const inClassic = classic && /);
    expect(search).toMatch(/if \(!inClassic\) for \(const t of G3_STEPS\)/);
  });
  it('Generate is on by default and classic is off by default', () => {
    const prefs = read('src/state/appPrefsStore.ts');
    expect(prefs).toMatch(/f\.id === 'scenarios' \? readFlagOn\(/);
    expect(prefs).not.toMatch(/classicGenerate'[^\n]*readFlagOn/);
  });
});
