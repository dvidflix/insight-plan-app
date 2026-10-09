import { describe, expect, it } from 'vitest';
import { applyAvevaStoreys, planPatch, type AvevaStoreysOperation, type Patch } from '../../src/ids/patches';
import { runRules, type Rule } from '../../src/ids/rules';
import { originatingSystem, readEntities } from '../../src/ids/step';
import type { Candidate, ModelContext } from '../../src/ids/evaluate';

const op: AvevaStoreysOperation = { type: 'aveva-storeys', originatingSystem: 'AVEVA', nameStart: 4, nameLength: 2, writeLocation: 'ePset_LocationTool.Location 0' };
const rule = { id: 'R', name: 'r', ...op } as Rule;

// Two sites, a building holding a building, storeys named like the objects (-HDA0B---B), a wall on 07 and one on 0B.
const IFC = `ISO-10303-21;
HEADER;
FILE_NAME('a.ifc','2026-01-01',(''),(''),'pp','AVEVA E3D Design','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0000000000000000000001',$,'P',$,$,$,$,$,$);
#2=IFCSITE('0000000000000000000002',$,'S',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);
#3=IFCBUILDING('0000000000000000000003',$,'-HD',$,$,$,$,$,.ELEMENT.,$,$,$);
#4=IFCWALL('0000000000000000000004',$,'ABCD07-1',$,$,$,$,$,$);
#5=IFCWALL('0000000000000000000005',$,'ABCD0B-1',$,$,$,$,$,$);
#7=IFCSITE('0000000000000000000007',$,'S2',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);
#8=IFCRELAGGREGATES('0000000000000000000008',$,$,$,#1,(#2,#7));
#9=IFCBUILDINGSTOREY('0000000000000000000009',$,'-HDA0B---B',$,$,$,$,$,.ELEMENT.0.);
#10=IFCBUILDING('0000000000000000000010',$,'-HD------B',$,$,$,$,$,.ELEMENT.,$,$,$);
#11=IFCRELAGGREGATES('0000000000000000000011',$,$,$,#3,(#10));
#12=IFCRELAGGREGATES('0000000000000000000012',$,$,$,#10,(#9));
#13=IFCRELAGGREGATES('0000000000000000000013',$,$,$,#2,(#3));
#14=IFCRELCONTAINEDINSPATIALSTRUCTURE('0000000000000000000014',$,$,$,(#4,#5),#9);
#15=IFCSTAIR('0000000000000000000015',$,'Stair',$,$,$,$,$,$);
#16=IFCRELCONTAINEDINSPATIALSTRUCTURE('0000000000000000000016',$,$,$,(#15),#9);
ENDSEC;
END-ISO-10303-21;
`;

const walls: Candidate[] = [
  { localId: 4, category: 'IFCWALL', guid: '0000000000000000000004', name: 'ABCD07-1', description: '', props: {} },
  { localId: 5, category: 'IFCWALL', guid: '0000000000000000000005', name: 'ABCD0B-1', description: '', props: {} },
];
const node = (localId: number, category: string, name: string): Candidate => ({ localId, category, guid: '', name, description: '', props: {} });
const ctx = (system: string, extra: Candidate[] = []): ModelContext => ({ modelId: 'm', candidates: [...walls, ...extra], originatingSystem: system, ancestors: new Map(), attributes: async () => new Map() });
const good = [node(2, 'IFCSITE', 'S'), node(3, 'IFCBUILDING', 'B'), node(20, 'IFCBUILDINGSTOREY', '07'), node(21, 'IFCBUILDINGSTOREY', '0B')];
const reasons = (c: ModelContext) => runRules([rule], [c])[0].failures.map((f) => f.reasons[0]);

describe('AVEVA storeys', () => {
  it('reads the originating system from the header', () => {
    expect(originatingSystem(IFC)).toBe('AVEVA E3D Design');
  });

  it('is N/A outside AVEVA and passes a tidy model', () => {
    expect(runRules([rule], [ctx('Revit')])[0].applicable).toBe(0);
    expect(reasons(ctx('AVEVA E3D', good))).toEqual([]);
  });

  it('flags missing, misnamed and duplicate storeys, extra buildings and sites', () => {
    expect(reasons(ctx('AVEVA', [node(2, 'IFCSITE', 'S'), node(3, 'IFCBUILDING', 'B')])).join('|')).toContain('No IfcBuildingStorey named 07');
    const odd = reasons(ctx('AVEVA', [...good, node(22, 'IFCBUILDINGSTOREY', '-HDA01---B'), node(23, 'IFCBUILDINGSTOREY', '07'), node(7, 'IFCSITE', 'S2'), node(10, 'IFCBUILDING', 'B2')])).join('|');
    expect(odd).toContain('-HDA01---B is not a level');
    expect(odd).toContain('07 is a duplicate');
    expect(odd).toContain('One of 2 IfcSites');
    expect(odd).toContain('One of 2 IfcBuildings');
  });

  it('rebuilds one site, one building and a storey per level', () => {
    const patch: Patch = { id: 'p', name: 'p', fixes: [], operation: op };
    const elements = new Map(walls.map((c) => [c.localId, c]));
    const plan = planPatch(patch, [{ modelId: 'm', localId: 0 }], () => elements, () => [node(2, 'IFCSITE', 'S'), node(7, 'IFCSITE', 'S2'), node(3, 'IFCBUILDING', '-HD'), node(10, 'IFCBUILDING', 'x'), node(9, 'IFCBUILDINGSTOREY', '-HDA0B---B')]);
    expect(plan.changes.map((c) => c.to)).toEqual(['Level 07', 'Level 0B', 'merged into the first', 'merged into the first', 'replaced by one per level']);
    const r = applyAvevaStoreys(IFC, op, plan.changes);
    const all = readEntities(r.text);
    const of = (t: string) => all.filter((e) => e.type === t);
    expect(of('IFCSITE')).toHaveLength(1);
    expect(of('IFCBUILDING').map((b) => b.args.split(',')[2])).toEqual(["'-HD'"]);
    // 0B (-12 m... 0B is -14) before 07 (0 m), named by code.
    expect(of('IFCBUILDINGSTOREY').map((s) => s.args.split(',')[2])).toEqual(["'0B'", "'07'"]);
    // The stair that was in the old storey is now in the building; no relationship points at a removed entity.
    expect(r.text).toMatch(/IFCRELCONTAINEDINSPATIALSTRUCTURE\('0000000000000000000016',\$,\$,\$,\(#15\),#3\)/);
    expect(r.text).not.toMatch(/#(7|9|10)\b[^=]/);
    expect(r.text).toContain("'Location 0'");
  });
});
