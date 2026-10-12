import { patches as libraryPatches, patchesFor, rules as libraryRules } from '../ids/library';
import { RULES_FILE, type Rule } from '../ids/rules';

/** The rule in words: what the check does, from its type and settings. */
function explain(r: Rule): string {
  switch (r.type) {
    case 'single-building':
      return `Each model has one IfcBuilding, named from its elements' ${r.unit ? `${r.unit} + ` : ''}${r.building} (property sets: ${r.psets.join(', ')}).`;
    case 'name-matches-property':
      return `An element's Name equals one of its properties: ${r.properties.join(', ')} (the first found).`;
    case 'property-digits':
      return `The property ${r.properties.join(' / ')} has exactly ${r.digits} digits (leading zeros kept).`;
    case 'aveva-storeys':
      return 'In an AVEVA model the objects\' names give its levels: one site, one building and one storey per level, named by its code.';
    default:
      return '';
  }
}

const TYPE_LABEL: Record<string, string> = {
  'single-building': 'One building per model',
  'name-matches-property': 'Name matches a property',
  'property-digits': 'Property has N digits',
  'aveva-storeys': 'AVEVA storeys',
};

/** Model checks › Custom rules: the checks IDS cannot express (docs/ids/rules), as readable cards: what each checks,
    its settings and the patches that fix it. They are JSON files in the library; the settings show as they are in the file. */
export function RulesViewer({ onClose }: { onClose: () => void }) {
  const rules = libraryRules();
  const patches = libraryPatches();
  return (
    <div className="model-checks ids-editor">
      <div className="model-checks__bar">
        <button type="button" className="btn" onClick={onClose}>‹ Back</button>
        <span className="ids-editor__state">{rules.length} custom rule{rules.length === 1 ? '' : 's'} · {RULES_FILE}</span>
      </div>
      <div className="ids-editor__body">
        <div className="model-checks__hint">Custom rules check what IDS cannot say: counting, or comparing one value with another. They live as JSON files in docs/ids/rules (they ship with the app) and run with the IDS files when &ldquo;{RULES_FILE}&rdquo; is ticked.</div>
        {rules.map((r) => {
          const { id, name, description, instructions, ...rest } = r;
          const fixes = patchesFor(patches, RULES_FILE, { name: id });
          return (
            <section key={id} className="ge-sec rule-card">
              <div className="ge-sec__bar"><span>{name}</span><span className="rule-card__type">{TYPE_LABEL[r.type] ?? r.type}</span></div>
              <div className="rule-card__body">
                <p><b>Checks:</b> {explain(r) || description}</p>
                {description && explain(r) && <p>{description}</p>}
                {instructions && <p><b>To fix:</b> {instructions}</p>}
                {fixes.length > 0 && <p><b>Patches:</b> {fixes.map((p) => p.name).join(', ')}</p>}
                <details>
                  <summary>Settings ({id})</summary>
                  <pre className="rule-card__json">{JSON.stringify(rest, null, 2)}</pre>
                </details>
              </div>
            </section>
          );
        })}
        {rules.length === 0 && <div className="model-checks__hint">No custom rules in docs/ids/rules.</div>}
      </div>
    </div>
  );
}
