"""
IFC clean-up tools for the app's "Apply changes permanently to IFC" buttons,
built on IfcOpenShell (and its bundled ifcpatch recipes).

    python ifc_tools.py <op> <args.json>

The args file is JSON; the result is printed as one JSON line on stdout
(everything else goes to stderr). Ops:

  strip      {input, output, hiddenPsets: [name], hiddenProps: ["Pset.Prop"]}
             Removes whole property / quantity sets, and single properties,
             from every object and type. → {removedSets, removedProps, objects}
  translate  {input, output, x, y, z, rot: {deg, px, py, pz} | null}
             Bakes a move (metres, project axes: X east, Y north, Z up) and an
             optional turn about the vertical axis through a pivot into the
             object placements. → {moved}
  merge      {inputs: [{path, x, y, z, rot}], output}
             Merges the IFCs into the first, each one moved first when it has
             an offset. → {merged}
  split      {input, outputDir, by: "storey" | "class"}
             One IFC per building storey, or per element class.
             → {files: [{name, elements}]}
"""
import json
import math
import os
import re
import shutil
import sys
from pathlib import Path

# Replies go to the real stdout; anything the libraries print goes to stderr.
_reply = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
sys.stdout = sys.stderr

import ifcopenshell  # noqa: E402
import ifcopenshell.api  # noqa: E402
import ifcopenshell.util.element  # noqa: E402
import ifcopenshell.util.unit  # noqa: E402
import ifcpatch  # noqa: E402

ATTRIBUTES = "Attributes"  # the Properties table's pseudo set (Name, Class, GlobalId): not stored as a set


def _psets_of(model):
    """(pset entity, [objects it is attached to]) for every property and quantity set, type-level ones included."""
    attached = {}
    for rel in model.by_type("IfcRelDefinesByProperties"):
        definition = rel.RelatingPropertyDefinition
        if definition is None or not definition.is_a() in ("IfcPropertySet", "IfcElementQuantity"):
            continue
        attached.setdefault(definition.id(), (definition, []))[1].extend(rel.RelatedObjects or [])
    for t in model.by_type("IfcTypeObject"):
        for definition in getattr(t, "HasPropertySets", None) or []:
            if definition.is_a() in ("IfcPropertySet", "IfcElementQuantity"):
                attached.setdefault(definition.id(), (definition, []))[1].append(t)
    return list(attached.values())


def strip(args):
    model = ifcopenshell.open(args["input"])
    hidden_sets = {s for s in args.get("hiddenPsets", []) if s != ATTRIBUTES}
    hidden_props = {p for p in args.get("hiddenProps", []) if not p.startswith(ATTRIBUTES + ".")}
    removed_sets = removed_props = objects = 0
    for definition, owners in _psets_of(model):
        name = definition.Name or ""
        if name in hidden_sets:
            for owner in owners:
                ifcopenshell.api.run("pset.remove_pset", model, product=owner, pset=definition)
                objects += 1
            removed_sets += 1
            continue
        items_attr = "HasProperties" if definition.is_a("IfcPropertySet") else "Quantities"
        doomed = [p for p in (getattr(definition, items_attr, None) or []) if f"{name}.{p.Name}" in hidden_props]
        if not doomed:
            continue
        if len(doomed) == len(getattr(definition, items_attr)):
            # Nothing left: drop the set itself.
            for owner in owners:
                ifcopenshell.api.run("pset.remove_pset", model, product=owner, pset=definition)
            removed_sets += 1
        else:
            keep = [p for p in getattr(definition, items_attr) if p not in doomed]
            setattr(definition, items_attr, keep)
            for p in doomed:
                model.remove(p)
        removed_props += len(doomed)
        objects += len(owners)
    model.write(args["output"])
    return {"removedSets": removed_sets, "removedProps": removed_props, "objects": objects}


def _plan_offset(args, scale):
    """The move to give ifcpatch (project length units, rotating about the origin first)
    that equals turning by deg about the pivot and then moving by x, y, z."""
    x, y, z = float(args.get("x", 0)), float(args.get("y", 0)), float(args.get("z", 0))
    rot = args.get("rot") or None
    deg = 0.0
    if rot and float(rot.get("deg", 0)):
        deg = float(rot["deg"])
        a = math.radians(deg)
        px, py = float(rot.get("px", 0)), float(rot.get("py", 0))
        x += px - (math.cos(a) * px - math.sin(a) * py)
        y += py - (math.sin(a) * px + math.cos(a) * py)
    return x / scale, y / scale, z / scale, deg


def _translate_file(model, args):
    scale = ifcopenshell.util.unit.calculate_unit_scale(model) or 1.0
    x, y, z, deg = _plan_offset(args, scale)
    if not (x or y or z or deg):
        return model, 0
    arguments = [x, y, z, True, deg] if deg else [x, y, z]
    out = ifcpatch.execute({"file": model, "recipe": "OffsetObjectPlacements", "arguments": arguments})
    return (out if isinstance(out, ifcopenshell.file) else model), 1


def translate(args):
    model = ifcopenshell.open(args["input"])
    model, moved = _translate_file(model, args)
    model.write(args["output"])
    return {"moved": moved}


def _unit_name(model):
    unit = ifcopenshell.util.unit.get_project_unit(model, "LENGTHUNIT")
    return (getattr(unit, "Prefix", None) or "") + str(getattr(unit, "Name", "METRE"))


def _merge_into(base, other):
    """Adds `other`'s objects to `base` under base's project. (ifcpatch's MergeProjects was
    tried first, but with property sets in the second file it left a model that crashes
    IfcOpenShell 0.8.4 on write, so the same steps are done here, without its georeferencing
    and context-merging extras.)"""
    if base.schema != other.schema:
        raise ValueError(f"Cannot merge {other.schema} into {base.schema}: save both in the same IFC version first.")
    if _unit_name(base) != _unit_name(other):
        other = ifcopenshell.util.unit.convert_file_length_units(other, _unit_name(base))
    project = base.by_type("IfcProject")[0]
    imported = base.add(other.by_type("IfcProject")[0])
    for element in other:
        base.add(element)
    for inverse in base.get_inverse(imported):
        ifcopenshell.util.element.replace_attribute(inverse, imported, project)
    base.remove(imported)


def merge(args):
    inputs = args["inputs"]
    if len(inputs) < 2:
        raise ValueError("Merging needs at least two IFC files.")
    base = ifcopenshell.open(inputs[0]["path"])
    base, _ = _translate_file(base, inputs[0])
    for item in inputs[1:]:
        other = ifcopenshell.open(item["path"])
        other, _ = _translate_file(other, item)
        _merge_into(base, other)
    base.write(args["output"])
    return {"merged": len(inputs), "elements": len(base.by_type("IfcElement"))}


def _safe(name):
    return re.sub(r"[^A-Za-z0-9._ -]+", "-", str(name or "")).strip(" .-")[:80] or "unnamed"


def split(args):
    src = args["input"]
    out_dir = Path(args["outputDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    model = ifcopenshell.open(src)
    stem = _safe(Path(args.get("name") or src).stem)
    files = []
    if args.get("by", "storey") == "storey":
        before = set(out_dir.iterdir())
        ifcpatch.execute({"file": model, "recipe": "SplitByBuildingStorey", "arguments": [str(out_dir)]})
        for path in sorted(set(out_dir.iterdir()) - before):
            target = out_dir / f"{stem}_{path.name}"
            shutil.move(path, target)
            files.append(target)
    else:
        classes = sorted({e.is_a() for e in model.by_type("IfcElement")})
        for cls in classes:
            out = ifcpatch.execute({"file": model, "recipe": "ExtractElements", "arguments": [cls]})
            if isinstance(out, ifcopenshell.file):
                target = out_dir / f"{stem}_{cls}.ifc"
                out.write(str(target))
                files.append(target)
    listing = []
    for path in files:
        part = ifcopenshell.open(str(path))
        listing.append({"name": path.name, "elements": len(part.by_type("IfcElement"))})
    return {"files": listing}


OPS = {"strip": strip, "translate": translate, "merge": merge, "split": split}


def main():
    op, args_file = sys.argv[1], sys.argv[2]
    with open(args_file, encoding="utf-8") as f:
        args = json.load(f)
    try:
        reply = {"ok": True, **OPS[op](args)}
    except Exception as e:  # reported to the app, which shows it
        import traceback
        traceback.print_exc()
        reply = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    _reply.write(json.dumps(reply) + "\n")
    _reply.flush()


if __name__ == "__main__":
    main()
