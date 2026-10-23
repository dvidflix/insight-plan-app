import * as XLSX from 'xlsx';
import { CREW_SHEET_HEAD, RATE_SHEET_HEAD, TRADE_SHEET_HEAD, RECIPE_README, RECIPE_SHEET_NAMES, toRecipeSheets, type BookSource, type RecipeSheets, type Row } from './recipesWorkbook';

/** The recipes workbook as an .xlsx file: written for the recipes and the scenario's tables, and read back into sheets of rows (recipesWorkbook.ts says what a row means). */

const HEADS: Record<keyof RecipeSheets, string[]> = {
  recipes: ['Recipe*', 'Logical Group', 'Folder', 'Order', 'Activity*', 'Name', 'Suffix', 'Material', 'Follows', 'Days', 'Duration Formula', 'Quantity driver (read only)', 'Rate', 'Rebar rate', 'Crew', 'Calendar', 'Equipment', 'Cranes', 'Materials', 'Priority', 'Finish after', 'Gates'],
  parameters: ['Name*', 'Value*', 'Unit', 'Notes'],
  limits: ['Activity*', 'Logical Group', 'Max at once', 'Notes'],
  steps: ['Step', 'Search set / group*', 'Per level', 'Link into it', 'Lag (h)', 'Notes'],
  resources: ['Kind', 'ID*', 'Name', 'Quantity', 'Notes'],
  rates: RATE_SHEET_HEAD,
  crews: CREW_SHEET_HEAD,
  trades: TRADE_SHEET_HEAD,
};

export function writeRecipeWorkbook(src: BookSource, fileName: string) {
  const s = toRecipeSheets(src);
  const book = XLSX.utils.book_new();
  for (const key of ['recipes', 'parameters', 'limits', 'steps', 'resources', 'rates', 'crews', 'trades'] as const) {
    const rows = s[key];
    const headers = HEADS[key];
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = headers.map((h) => ({ wch: Math.min(48, Math.max(12, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(book, sheet, RECIPE_SHEET_NAMES[key]);
  }
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(RECIPE_README.map((line) => [line])), RECIPE_SHEET_NAMES.readme);
  XLSX.writeFile(book, fileName);
}

/** The rows of each sheet of an uploaded workbook; a sheet that is not there is left out (so it is not read as an empty list). */
export async function readRecipeWorkbook(file: File): Promise<RecipeSheets> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = (name: string): Row[] | undefined => {
    const sheet = book.Sheets[book.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase()) ?? ''];
    if (!sheet) return undefined;
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true }).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v : String(v ?? '')])));
  };
  const out: RecipeSheets = { recipes: rows(RECIPE_SHEET_NAMES.recipes), parameters: rows(RECIPE_SHEET_NAMES.parameters), limits: rows(RECIPE_SHEET_NAMES.limits), steps: rows(RECIPE_SHEET_NAMES.steps) ?? rows('Steps'), resources: rows(RECIPE_SHEET_NAMES.resources), rates: rows(RECIPE_SHEET_NAMES.rates), crews: rows(RECIPE_SHEET_NAMES.crews), trades: rows(RECIPE_SHEET_NAMES.trades) };
  if (!out.recipes && !out.parameters && !out.limits && !out.steps && !out.resources && !out.rates && !out.crews && !out.trades) throw new Error('The workbook has none of the sheets Recipes, Parameters, Limits, Work breakdown, Resources, Rates, Crews or Trades. Use a file made with Download workbook.');
  return out;
}
