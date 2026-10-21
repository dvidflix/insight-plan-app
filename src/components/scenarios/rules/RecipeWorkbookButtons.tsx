import { useRef } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { setPools, setRecipes, useRecipeStore } from '../../../state/recipeStore';
import { STEPS_ID, fromRecipeSheets } from '../../../prs/recipesWorkbook';
import { readRecipeWorkbook, writeRecipeWorkbook } from '../../../prs/recipesWorkbookFile';
import type { LimitRow, ParameterRow, SequenceStep } from '../../../prs/rules';
import { useRuleContext } from './RuleParts';

/** Download workbook / Upload workbook: the recipes, resources, parameters, limits and steps as one Excel workbook, edited there and read back. The same
    two buttons wherever recipes are worked on (the Recipes tab and the Parameters, limits and steps panel). `onNote` gets what the upload did. */
export function RecipeWorkbookButtons({ onNote }: { onNote: (note: { ok: boolean; lines: string[] }) => void }) {
  const ctx = useRuleContext();
  const scenarioOpen = useScenarioStore((s) => !!s.loaded);
  const recipes = useRecipeStore((s) => s.recipes);
  const pools = useRecipeStore((s) => s.pools);
  const fileRef = useRef<HTMLInputElement>(null);
  const { parameters, limits, sequences } = ctx.rules;

  const setParameters = (next: ParameterRow[]) => ctx.change((r) => ({ ...r, parameters: next }));
  const setLimits = (next: LimitRow[]) => ctx.change((r) => ({ ...r, limits: next }));
  const setSteps = (steps: SequenceStep[]) => ctx.change((r) => {
    const others = r.sequences.filter((s) => s.id.toUpperCase() !== STEPS_ID);
    return { ...r, sequences: steps.length ? [{ id: STEPS_ID, name: 'Steps', steps }, ...others] : others };
  });

  const download = () => writeRecipeWorkbook({ recipes, pools, parameters, limits, sequences }, 'insight-plan-recipes.xlsx');
  const upload = async (file: File) => {
    try {
      const sheets = await readRecipeWorkbook(file);
      const applied = fromRecipeSheets(sheets, { recipes, pools, parameters, groupIds: ctx.groupIds });
      const needsScenario = !!(applied.parameters || applied.limits || applied.steps) && !scenarioOpen;
      if (applied.recipes) setRecipes(applied.recipes);
      if (applied.pools) setPools(applied.pools);
      if (scenarioOpen) {
        if (applied.parameters) setParameters(applied.parameters);
        if (applied.limits) setLimits(applied.limits);
        if (applied.steps) setSteps(applied.steps);
      }
      const lines = [...applied.summary, ...(needsScenario ? ['Parameters, Limits and Steps belong to a scenario: open one (Scenarios panel) and upload again to bring them in.'] : []), ...applied.warnings.map((w) => `⚠ ${w}`)];
      onNote({ ok: applied.warnings.length === 0 && !needsScenario, lines: lines.length ? lines : ['Nothing in the workbook to read.'] });
    } catch (e) {
      onNote({ ok: false, lines: [e instanceof Error ? e.message : String(e)] });
    }
  };

  return (
    <>
      <button type="button" className="btn btn--small" onClick={download} title="One Excel workbook: Recipes, Parameters, Limits, Steps and Resources. Edit it there and upload it again.">Download workbook</button>
      <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()} title="Read a workbook made with Download workbook: the recipes, resources and (with a scenario open) the parameters, limits and steps follow it">Upload workbook</button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </>
  );
}
