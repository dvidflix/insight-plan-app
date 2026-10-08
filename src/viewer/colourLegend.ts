import { NO_VALUE } from './bimTables';

/** The legend of Models > Colour: one row per coloured value, the values left on the palette's
    "other" colour (or on their own colours) gathered into one last row. Pure, so it can be tested. */

export interface LegendValue { value: string; count: number }

export interface LegendRow {
  kind: 'value' | 'other' | 'own';
  /** The value, or the label of a gathered row. */
  label: string;
  /** The value a row stands for (kind 'value'); undefined for gathered rows. */
  value?: string;
  /** Swatch colour; null for objects that keep their own colours. */
  color: string | null;
  count: number;
}

export const OTHER_LABEL = 'Other values';
export const OWN_LABEL = 'Own colours';

/** `values` are most common first (as Models > Colour lists them); `colours` is the per-value colour. */
export function legendRows(values: LegendValue[], colours: { value: string; color: string }[], others: string | null): LegendRow[] {
  const colourOf = new Map(colours.map((c) => [c.value, c.color]));
  const rows: LegendRow[] = [];
  let restCount = 0;
  let restKinds = 0;
  for (const v of values) {
    if (v.count <= 0) continue;
    const color = colourOf.get(v.value);
    if (color) rows.push({ kind: 'value', label: v.value === NO_VALUE ? 'No value' : v.value, value: v.value, color, count: v.count });
    else { restCount += v.count; restKinds++; }
  }
  if (restCount > 0) {
    rows.push(others === null
      ? { kind: 'own', label: `${OWN_LABEL} (${restKinds})`, color: null, count: restCount }
      : { kind: 'other', label: `${OTHER_LABEL} (${restKinds})`, color: others, count: restCount });
  }
  return rows;
}

/** The values a legend row stands for: its own, or every value that has no colour of its own. */
export function valuesOfRow(row: LegendRow, values: LegendValue[], colours: { value: string }[]): string[] {
  if (row.kind === 'value') return row.value === undefined ? [] : [row.value];
  const coloured = new Set(colours.map((c) => c.value));
  return values.filter((v) => !coloured.has(v.value)).map((v) => v.value);
}
