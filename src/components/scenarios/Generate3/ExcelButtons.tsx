import { useRef } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { quantities } from '../../../prs/workPackages';
import { packagesToRows, rowsToPackages } from '../../../prs/packagesWorkbook';
import { readPackagesWorkbook, writePackagesWorkbook } from '../../../prs/packagesWorkbookFile';
import { packageColors, useG3, type useWorkPackages } from './useWorkPackages';

/** Download the work packages as an Excel workbook, edit them in bulk, and upload it back (prs/packagesWorkbook.ts). The upload says what it will
    change before it does, and what it could not read. */

type WP = ReturnType<typeof useWorkPackages>;

export function ExcelButtons({ wp }: { wp: WP }) {
  const recipes = useRecipeStore((s) => s.recipes);
  const scenario = useScenarioStore((s) => s.scenario);
  const input = useRef<HTMLInputElement>(null);
  const download = () => {
    const rows = packagesToRows(wp.packages, { objects: (id) => quantities(wp.contents.objects.get(id) ?? []), method: (id) => wp.methods.get(id) }, recipes);
    writePackagesWorkbook(rows, `${(scenario || 'Scenario').replace(/[\\/:*?"<>|]+/g, '_')} - work packages.xlsx`);
  };
  const upload = async (file: File) => {
    try {
      const read = rowsToPackages(await readPackagesWorkbook(file), wp.packages, recipes, packageColors);
      const what = [`${read.packages.length} packages in the file`, read.added ? `${read.added} new` : '', read.changed ? `${read.changed} changed` : '', read.removed ? `${read.removed} removed (not in the file)` : ''].filter(Boolean).join(', ');
      const notes = read.warnings.length ? `\n\nNot read (${read.warnings.length}):\n${read.warnings.slice(0, 12).join('\n')}${read.warnings.length > 12 ? `\n… and ${read.warnings.length - 12} more` : ''}` : '';
      if (!window.confirm(`Replace the work packages with the ones in “${file.name}”?\n\n${what}.${notes}`)) return;
      wp.save(read.packages);
      useG3.getState().pick(null);
    } catch (e) {
      window.alert(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <span className="g3-list__excel">
      <button type="button" className="btn btn--small" disabled={!wp.packages.length} onClick={download} title="Download every package (order, nesting, what it is made of, links, methods, days, crews, extras) as an Excel workbook to edit in bulk">Download Excel</button>
      <button type="button" className="btn btn--small" onClick={() => input.current?.click()} title="Upload an edited workbook: the packages become the rows of its Packages sheet (you see what changes before it does)">Upload Excel</button>
      <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </span>
  );
}
