/** Fragments drops IfcPresentationLayerAssignment (and the representation
    graph it points at) when it converts an IFC, so layers can't be read back
    from the loaded model. This reads them straight from the IFC text at
    import instead: layer -> GlobalIds of the products drawn on it.
    Layers assigned to a product's shape representation (or to the items in
    it) are followed; layers assigned through mapped/type representations are
    not. Returns an empty map when the file has no layer assignments. */

const LAYER_TYPES = /^IFCPRESENTATIONLAYER(?:ASSIGNMENT|WITHSTYLE)$/;

/** Top-level comma split that respects nested parentheses and 'strings'. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inString) {
      if (c === "'") {
        if (args[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (c === "'") inString = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

const refs = (list: string): string[] => list.match(/#\d+/g) ?? [];
const unquote = (s: string) => s.replace(/^'|'$/g, '').replace(/''/g, "'");

const CHUNK_BYTES = 32 * 1024 * 1024;
const ENTITY = /^\s*(#\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*$/;

/** Reads the file in 32 MB slices (an IFC can be hundreds of MB — one giant
    string would hit the engine's length limit and freeze the page), yielding
    to the event loop between slices. Entities cut by a slice boundary are
    carried into the next one. */
export async function extractLayers(bytes: Uint8Array): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const decoder = new TextDecoder('latin1');

  const layerItems = new Map<string, string[]>(); // item/representation ref -> layer names
  const repItems = new Map<string, string[]>(); // IfcShapeRepresentation -> its items
  const shapeReps = new Map<string, string[]>(); // IfcProductDefinitionShape -> representations
  const products: { guid: string; shape: string }[] = [];

  const handle = (entity: string) => {
    const m = ENTITY.exec(entity);
    if (!m) return;
    const [, id, type, rawArgs] = m;
    if (LAYER_TYPES.test(type)) {
      const args = splitArgs(rawArgs);
      const name = unquote(args[0] ?? '');
      for (const ref of refs(args[2] ?? '')) (layerItems.get(ref) ?? layerItems.set(ref, []).get(ref)!).push(name);
    } else if (type === 'IFCSHAPEREPRESENTATION' || type === 'IFCTOPOLOGYREPRESENTATION') {
      repItems.set(id, refs(splitArgs(rawArgs)[3] ?? ''));
    } else if (type === 'IFCPRODUCTDEFINITIONSHAPE') {
      shapeReps.set(id, refs(splitArgs(rawArgs)[2] ?? ''));
    } else if (rawArgs.startsWith("'") && rawArgs.length > 30) {
      // Any IfcProduct: GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation
      const args = splitArgs(rawArgs);
      if (args.length >= 7 && /^#\d+$/.test(args[6])) products.push({ guid: unquote(args[0]), shape: args[6] });
    }
  };

  let carry = '';
  let sawLayers = false;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const text = carry + decoder.decode(bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES)));
    const parts = text.split(/;[ \t]*\r?\n/);
    carry = parts.pop() ?? '';
    for (const part of parts) handle(part);
    sawLayers = sawLayers || layerItems.size > 0;
    await new Promise((resolve) => setTimeout(resolve));
  }
  handle(carry);
  if (!sawLayers && layerItems.size === 0) return result;

  for (const { guid, shape } of products) {
    const layers = new Set<string>();
    for (const rep of shapeReps.get(shape) ?? []) {
      layerItems.get(rep)?.forEach((l) => layers.add(l));
      for (const item of repItems.get(rep) ?? []) layerItems.get(item)?.forEach((l) => layers.add(l));
    }
    for (const layer of layers) (result.get(layer) ?? result.set(layer, []).get(layer)!).push(guid);
  }
  return result;
}
