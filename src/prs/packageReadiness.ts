import { STANDARD_METHODS } from './standardMethods';
import type { PackageContents, PackageObject, ResolvedMethod, WorkPackage } from './workPackages';

/** Whether the model and the work packages are ready to generate, in plain words (Generate 3's readiness chip): ready, will generate with gaps,
    or cannot generate. Each finding says how many objects or packages it is about, what that means for the programme and what to do, and carries
    the objects so they can be shown in 3D. Nothing here blocks Generate: only "cannot" (nothing to build) does, as the generator would have
    nothing to make. */

export type Verdict = 'ready' | 'gaps' | 'cannot';

export interface Finding {
  id: 'nomodel' | 'nopackages' | 'unassigned' | 'novolume' | 'noguid' | 'empty' | 'unknowndays';
  blocks: boolean;
  title: string;
  /** What it means for the programme, and what to do. */
  hint: string;
  count: number;
  objects: PackageObject[];
  /** The packages it is about. */
  packages: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function readiness(objects: readonly PackageObject[], packages: readonly WorkPackage[], contents: PackageContents, methods: ReadonlyMap<string, ResolvedMethod>): { verdict: Verdict; findings: Finding[] } {
  const findings: Finding[] = [];
  const live = packages.filter((p) => (contents.objects.get(p.id)?.length ?? 0) > 0);
  if (!objects.length) {
    findings.push({ id: 'nomodel', blocks: true, title: 'The loaded model has no objects to build', hint: 'Load the model in Models (its walls, slabs, members… are what the packages are made of).', count: 0, objects: [], packages: [] });
  } else if (!live.length) {
    findings.push({ id: 'nopackages', blocks: true, title: packages.length ? 'No work package holds an object of the loaded model' : 'There are no work packages yet', hint: 'Make work packages in step 1: Auto-group, Spool from properties, or your search sets.', count: packages.length, objects: [], packages: packages.map((p) => p.id) });
  }
  if (live.length) {
    const owned = new Set(live.flatMap((p) => contents.objects.get(p.id)!.map((o) => o.key)));
    const loose = objects.filter((o) => !owned.has(o.key));
    if (loose.length) findings.push({ id: 'unassigned', blocks: false, title: `${plural(loose.length, 'object is', 'objects are')} in no package`, hint: 'They are not in the schedule. Add them in step 1: drag a search set onto a package, or make a package from the 3D selection.', count: loose.length, objects: loose, packages: [] });
    const perVolume = new Set(STANDARD_METHODS.filter((m) => m.tasks.some((t) => t.per === 'm3')).map((m) => `std:${m.id}`));
    const flat: PackageObject[] = [];
    const flatPkgs: string[] = [];
    for (const p of live) {
      const m = methods.get(p.id);
      if (!m || !perVolume.has(m.key) || p.totalDays) continue;
      const none = contents.objects.get(p.id)!.filter((o) => o.volume <= 0);
      if (none.length) { flat.push(...none); flatPkgs.push(p.id); }
    }
    if (flat.length) findings.push({ id: 'novolume', blocks: false, title: `${plural(flat.length, 'object has', 'objects have')} no volume`, hint: 'Their method works from volume, so their days are counted per object instead. Fine for a first look; type the package’s days in step 3, or add quantities to the model.', count: flat.length, objects: flat, packages: flatPkgs });
    const noGuid = live.flatMap((p) => contents.objects.get(p.id)!.filter((o) => !o.guid));
    if (noGuid.length) findings.push({ id: 'noguid', blocks: false, title: `${plural(noGuid.length, 'object has', 'objects have')} no GlobalId`, hint: 'They are built, but their activities cannot be linked to them in 4D. Export the model with GlobalIds.', count: noGuid.length, objects: noGuid, packages: [] });
    const empty = packages.filter((p) => !(contents.all.get(p.id)?.length));
    if (empty.length) findings.push({ id: 'empty', blocks: false, title: `${plural(empty.length, 'package holds', 'packages hold')} no objects`, hint: 'They are left out of the schedule. Add a search set to them in step 1, or delete them.', count: empty.length, objects: [], packages: empty.map((p) => p.id) });
    const unknown = live.filter((p) => methods.get(p.id)?.activities.some((a) => a.unknown));
    if (unknown.length) findings.push({ id: 'unknowndays', blocks: false, title: `${plural(unknown.length, 'package has', 'packages have')} days worked out only at Generate`, hint: 'Their recipe reads quantities from the model’s geometry, so the timeline preview shows 1 day for those activities. Generate works out the real days.', count: unknown.length, objects: [], packages: unknown.map((p) => p.id) });
  }
  const verdict: Verdict = findings.some((f) => f.blocks) ? 'cannot' : findings.some((f) => f.id !== 'unknowndays') ? 'gaps' : 'ready';
  return { verdict, findings };
}

export const VERDICT_TEXT: Record<Verdict, string> = { ready: 'Ready', gaps: 'Will generate with gaps', cannot: 'Cannot generate' };

/** A package's own warnings, for its row: objects without volume (when its method works from volume), objects without a GlobalId, days known only
    at Generate. */
export function packageWarnings(p: WorkPackage, objs: readonly PackageObject[], m: ResolvedMethod | undefined): { text: string; tip: string }[] {
  if (!objs.length || !m) return [];
  const out: { text: string; tip: string }[] = [];
  const std = STANDARD_METHODS.find((x) => `std:${x.id}` === m.key);
  const noVol = objs.filter((o) => o.volume <= 0).length;
  if (std?.tasks.some((t) => t.per === 'm3') && noVol && !p.totalDays) out.push({ text: `${noVol} without volume`, tip: `${plural(noVol, 'object has', 'objects have')} no volume: their days are counted per object. Type the package’s days, or add quantities to the model` });
  const noGuid = objs.filter((o) => !o.guid).length;
  if (noGuid) out.push({ text: `${noGuid} without GlobalId`, tip: 'Built, but not linked to their activities in 4D' });
  if (m.activities.some((a) => a.unknown)) out.push({ text: 'days at Generate', tip: 'Some activities’ days come from the model’s geometry and are worked out at Generate; the preview shows 1 day for them' });
  return out;
}
