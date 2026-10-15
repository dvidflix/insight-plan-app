/** The Level control of the Gantt and the Table: ‹ 2 › goes a level up or down in one tap ('' = All: every group open). */
export function LevelStepper({ value, onChange, max = 8 }: { value: string; onChange: (level: string) => void; max?: number }) {
  const level = value === '' ? -1 : Number(value);
  const go = (n: number) => onChange(n < 0 ? '' : String(Math.min(max, n)));
  return (
    <span className="ctx-stepper" role="group" aria-label="Level" title="Collapse the WBS groups to this level (All: everything open)">
      <button type="button" onClick={() => go(level - 1)} disabled={level < 0} aria-label="Fewer levels">‹</button>
      <span className="ctx-stepper__value">{level < 0 ? 'All' : level}</span>
      <button type="button" onClick={() => go(level + 1)} disabled={level >= max} aria-label="More levels">›</button>
    </span>
  );
}
