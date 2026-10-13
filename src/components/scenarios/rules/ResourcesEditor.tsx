import { freshId, type TradeRow } from '../../../prs/rules';
import { Field, NumberInput, RuleCard, type RuleContext } from './RuleParts';

/** Rule type Trade: a labour trade the crews are made of (code, name, people per day on site). The trades here replace the generator's built-in ones
    of the same code and add new ones; a trade switched off is taken out. */

export function addTrade(ctx: RuleContext, row?: Partial<TradeRow>) {
  ctx.change((r) => ({ ...r, trades: [...r.trades, { id: freshId(row?.id ?? 'TR', r.trades.map((d) => d.id)), name: '', capacity: 0, ...row }] }));
}

export function TradeRowCard({ ctx, i }: { ctx: RuleContext; i: number }) {
  const { rules, change } = ctx;
  const t = rules.trades[i];
  const update = (patch: Partial<TradeRow>) => change((r) => ({ ...r, trades: r.trades.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const crewsUsing = rules.crews.filter((c) => c.trades.some((x) => x.trade.toUpperCase() === t.id.toUpperCase())).length;
  return (
    <RuleCard
      kind="trade"
      id={t.id}
      onId={(id) => update({ id: id.toUpperCase() })}
      enabled={t.enabled !== false}
      onEnabled={(on) => update({ enabled: on ? undefined : false })}
      onDelete={() => change((r) => ({ ...r, trades: r.trades.filter((_, j) => j !== i) }))}
      onCopy={() => change((r) => ({ ...r, trades: [...r.trades.slice(0, i + 1), { ...t, id: freshId(t.id, r.trades.map((x) => x.id)) }, ...r.trades.slice(i + 1)] }))}
      summary={`${t.name || 'unnamed'} · ${t.capacity ? `${t.capacity} people per day` : 'no capacity set'}`}
      note={crewsUsing ? `${crewsUsing} crew rule${crewsUsing === 1 ? '' : 's'}` : undefined}
    >
      <div className="rule-grid">
        <Field label="Name"><input value={t.name} onChange={(e) => update({ name: e.target.value })} placeholder="Steel fixers" spellCheck={false} /></Field>
        <Field label="People per day on site" help="The site's capacity of this trade: written to P6 as the resource's max units per time, and the limit the programme is levelled to">
          <NumberInput value={t.capacity} onChange={(v) => update({ capacity: Number.isFinite(v) ? v : 0 })} />
        </Field>
      </div>
      <div className="scn-dim scn-editor__help">The id is the trade's code in crews (SF, CP ...). The resource in P6 is the project code, -L-, and this code.</div>
    </RuleCard>
  );
}
