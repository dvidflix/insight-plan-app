/**
 * The Level control of any grouped list (Gantt, Schedule table, Data Table): ‹ 2 › goes a level up or down in one tap
 * ('' = All: every group open). `max` is the deepest group level the list has; `title` names what is being grouped.
 */
export function LevelStepper({ value, onChange, max = 8, title = 'Collapse the groups to this level (All: everything open)' }: { value: string; onChange: (level: string) => void; max?: number; title?: string }) {
  const level = value === '' ? -1 : Math.min(Number(value), max);
  const go = (n: number) => onChange(n < 0 ? '' : String(Math.min(max, n)));
  return (
    <span className="ctx-stepper" role="group" aria-label="Level" title={title}>
      <button type="button" onClick={() => go(level - 1)} disabled={level < 0} aria-label="Fewer levels">‹</button>
      <span className="ctx-stepper__value">{level < 0 ? 'All' : level}</span>
      <button type="button" onClick={() => go(level + 1)} disabled={level >= max} aria-label="More levels">›</button>
    </span>
  );
}
