import * as OBC from '@thatopen/components';
import { evaluateSpec, type ModelContext } from './evaluate';

/** Runs an IDS file against the loaded models: That Open's
    IDSSpecifications parses it, evaluate.ts judges each specification per
    model, and the results are boiled down to what the Model checks tab
    shows — per specification, how many elements it applied to, how many
    passed, and each failure with its reasons. */

export interface IdsFailure {
  modelId: string;
  localId: number;
  guid: string;
  reasons: string[];
}

export interface SpecResult {
  /** "file#identifier-or-name", stable across runs. */
  key: string;
  file: string;
  name: string;
  identifier?: string;
  description?: string;
  instructions?: string;
  applicable: number;
  passed: number;
  failures: IdsFailure[];
  error?: string;
}

export async function runIdsFile(components: OBC.Components, file: string, xml: string, models: ModelContext[]): Promise<SpecResult[]> {
  const manager = components.get(OBC.IDSSpecifications);
  manager.list.clear();
  let specs: OBC.IDSSpecification[];
  try {
    specs = manager.load(xml);
  } catch (e) {
    return [{ key: `${file}#`, file, name: file, applicable: 0, passed: 0, failures: [], error: `Could not read the IDS file: ${e instanceof Error ? e.message : String(e)}` }];
  }
  const out: SpecResult[] = [];
  for (const spec of specs) {
    const result: SpecResult = {
      key: `${file}#${spec.identifier || spec.name}`,
      file,
      name: spec.name,
      identifier: spec.identifier,
      description: spec.description,
      instructions: spec.instructions,
      applicable: 0,
      passed: 0,
      failures: [],
    };
    try {
      for (const ctx of models) {
        const e = await evaluateSpec(spec, ctx);
        result.applicable += e.applicable;
        result.passed += e.applicable - e.failures.length;
        result.failures.push(...e.failures.map((f) => ({ ...f, modelId: ctx.modelId })));
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    out.push(result);
  }
  manager.list.clear();
  return out;
}
