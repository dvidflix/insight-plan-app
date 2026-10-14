/** The IfcOpenShell tools behind the "Apply changes permanently to IFC" buttons (vite-plugins/ifcTools.ts,
    scenario-engine/ifc_tools.py). Needs the app running with its local server (Autorun.bat / npm run dev). */

export interface IfcToolResult {
  parts: { name: string; bytes: Uint8Array }[];
  result: Record<string, any>;
}

export type IfcToolOp = 'strip' | 'translate' | 'merge' | 'split';

/** One call: the arguments and the IFC files go up in one body, the resulting IFC file(s) come back. */
export async function runIfcTool(op: IfcToolOp, args: Record<string, unknown>, files: Blob[]): Promise<IfcToolResult> {
  const head = new TextEncoder().encode(JSON.stringify(args));
  const sizes = [head.length, ...files.map((f) => f.size)];
  const res = await fetch(`/api/ifc-tools/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-sizes': sizes.join(',') },
    body: new Blob([head, ...files]),
  });
  if (!res.ok) {
    const out = await res.json().catch(() => null);
    throw new Error(out?.error ?? (res.status === 404 ? 'This needs the app running with Autorun.bat / npm run dev (the IfcOpenShell tools run on your computer).' : `The IFC tool failed (${res.status}).`));
  }
  const all = new Uint8Array(await res.arrayBuffer());
  const listed: { name: string; size: number }[] = JSON.parse(decodeURIComponent(res.headers.get('x-parts') ?? '[]'));
  let at = 0;
  const parts = listed.map((p) => {
    const bytes = all.subarray(at, at + p.size);
    at += p.size;
    return { name: p.name, bytes };
  });
  return { parts, result: JSON.parse(decodeURIComponent(res.headers.get('x-result') ?? '{}')) };
}
