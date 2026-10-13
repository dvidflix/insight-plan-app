import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { serializeOverlay } from '../../src/prs/overlay';

describe('a scenario keeps its extra activities', () => {
  it('writes and reads them back, with its links (selectors included) and crews', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-extras-'));
    const db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
    try {
      db.writeScenario('S1', 'Model', {
        sequence: [],
        relations: [{ ActivityID1: 'HLP-1', ActivityID2: 'select:{level=L1; type=SLAB; phase=Rebar; first}', Relation: 'FS', Lag: 16 }],
        crews: [{ Phase: 'Rebar', PourType: '', Trade: 'sf', Crew: '8' }],
        extras: [
          { TaskID: 'HLP-1', Name: 'Crane erected', DurationDays: 5, BaselineStart: '2029-03-05', BaselineFinish: '2029-03-09' },
          { TaskID: 'hlp-1', Name: 'duplicate id is dropped', DurationDays: 1, BaselineStart: '', BaselineFinish: '' },
          { TaskID: 'HLP-2', Name: 'Podium ready', DurationDays: -3, BaselineStart: '05/03/2029', BaselineFinish: '2029-11-16' },
          { TaskID: '  ', Name: 'no id', DurationDays: 1, BaselineStart: '', BaselineFinish: '' },
        ],
      });
      const back = db.readScenario('S1', 'Model')!;
      expect(back.extras).toEqual([
        { TaskID: 'HLP-1', Name: 'Crane erected', DurationDays: 5, BaselineStart: '2029-03-05', BaselineFinish: '2029-03-09' },
        { TaskID: 'HLP-2', Name: 'Podium ready', DurationDays: 0, BaselineStart: '', BaselineFinish: '2029-11-16' },
      ]);
      expect(back.relations[0].ActivityID2).toBe('select:{level=L1; type=SLAB; phase=Rebar; first}');
      expect(back.crews).toEqual([{ Phase: 'Rebar', PourType: '', Trade: 'SF', Crew: '8' }]);

      // Saving again replaces them.
      db.writeScenario('S1', 'Model', { sequence: [], relations: [], crews: [], extras: [] });
      expect(db.readScenario('S1', 'Model')!.extras).toEqual([]);
    } finally {
      db.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the rules file', () => {
  it('writes the three sections of the Programme Rules format, escaped', () => {
    const xml = serializeOverlay(
      {
        extras: [{ TaskID: 'HLP-1', Name: 'Crane & "hoist"', DurationDays: 0, BaselineStart: '', BaselineFinish: '2029-06-29' }],
        links: [{ ActivityID1: 'HLP-1', ActivityID2: 'select:{level=L1; last}', Relation: 'FS', Lag: 8 }],
        crews: [{ Phase: 'Rebar', PourType: 'SLAB', Trade: 'SF', Crew: '8' }],
      },
      'S1 rules',
    );
    expect(xml).toContain('<prs xmlns="https://insightplan.app/prs/1.0"');
    expect(xml).toContain('<activity id="HLP-1" name="Crane &amp; &quot;hoist&quot;" duration="0" baselineFinish="2029-06-29"/>');
    expect(xml).toContain('from="HLP-1" to="select:{level=L1; last}" type="FS" lag="8"');
    expect(xml).toContain('<crew phase="Rebar" pourType="SLAB" trade="SF" size="8"/>');
  });
});
