"""Writes public/sample/sample-building.ifc: the small model Generate's "Try the sample building" opens on a first run.

A three-storey frame on a 2 x 3 grid: footings, then on each storey columns, walls round the edge and the slab above, and a roof slab. Every
object has a GlobalId, a storey and a NetVolume quantity, and a property Pset_Sample.Zone (East or West) so Spool from properties has two values
to split by. Nothing in the app depends on these names: it is only a model to try the steps on.

Run with the bundled Python:  .cache\\python-runtime\\python.exe scripts\\make-sample-ifc.py
"""
from pathlib import Path

import numpy as np
import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit

OUT = Path(__file__).resolve().parents[1] / "public" / "sample" / "sample-building.ifc"

BAY_X, BAY_Y = 6.0, 5.0          # grid spacing (m)
NX, NY = 3, 2                    # grid lines in x and y
STOREY_H = 3.5
SLAB_T = 0.25
COL = 0.4
WALL_T = 0.2
STOREYS = ["Ground floor", "Level 1", "Level 2"]

model = ifcopenshell.api.project.create_file(version="IFC4")
project = ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name="Sample project")
ifcopenshell.api.unit.assign_unit(model)
ctx = ifcopenshell.api.context.add_context(model, context_type="Model")
body = ifcopenshell.api.context.add_context(model, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)

site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Sample site")
building = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuilding", name="Sample building")
ifcopenshell.api.aggregate.assign_object(model, products=[site], relating_object=project)
ifcopenshell.api.aggregate.assign_object(model, products=[building], relating_object=site)


def at(x: float, y: float, z: float, rot: float = 0.0) -> np.ndarray:
    m = np.eye(4)
    c, s = np.cos(rot), np.sin(rot)
    m[:3, :3] = [[c, -s, 0], [s, c, 0], [0, 0, 1]]
    m[:3, 3] = [x, y, z]
    return m


def make(ifc_class: str, name: str, storey, rep, matrix, volume: float, qto: str, zone: str):
    el = ifcopenshell.api.root.create_entity(model, ifc_class=ifc_class, name=name)
    ifcopenshell.api.geometry.assign_representation(model, product=el, representation=rep)
    ifcopenshell.api.geometry.edit_object_placement(model, product=el, matrix=matrix, is_si=True)
    ifcopenshell.api.spatial.assign_container(model, products=[el], relating_structure=storey)
    q = ifcopenshell.api.pset.add_qto(model, product=el, name=qto)
    ifcopenshell.api.pset.edit_qto(model, qto=q, properties={"NetVolume": round(volume, 3)})
    p = ifcopenshell.api.pset.add_pset(model, product=el, name="Pset_Sample")
    ifcopenshell.api.pset.edit_pset(model, pset=p, properties={"Zone": zone})
    return el


def box(w: float, d: float, h: float):
    """A w x d rectangle centred on the placement, extruded h up."""
    profile = model.createIfcRectangleProfileDef("AREA", None, model.createIfcAxis2Placement2D(model.createIfcCartesianPoint((0.0, 0.0))), w, d)
    return ifcopenshell.api.geometry.add_profile_representation(model, context=body, profile=profile, depth=h)


width, depth = BAY_X * (NX - 1), BAY_Y * (NY - 1)
zone_of = lambda x: "West" if x < width / 2 else "East"  # noqa: E731

storeys = []
for i, name in enumerate(STOREYS):
    st = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuildingStorey", name=name)
    st.Elevation = i * STOREY_H
    ifcopenshell.api.geometry.edit_object_placement(model, product=st, matrix=at(0, 0, i * STOREY_H), is_si=True)
    ifcopenshell.api.aggregate.assign_object(model, products=[st], relating_object=building)
    storeys.append(st)
roof = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuildingStorey", name="Roof")
roof.Elevation = len(STOREYS) * STOREY_H
ifcopenshell.api.geometry.edit_object_placement(model, product=roof, matrix=at(0, 0, roof.Elevation), is_si=True)
ifcopenshell.api.aggregate.assign_object(model, products=[roof], relating_object=building)

grid = [(ix * BAY_X, iy * BAY_Y) for iy in range(NY) for ix in range(NX)]

# Footings under the columns.
for k, (x, y) in enumerate(grid, 1):
    make("IfcFooting", f"Footing {k:02d}", storeys[0], box(1.6, 1.6, 0.6), at(x, y, -0.6), 1.6 * 1.6 * 0.6, "Qto_FootingBaseQuantities", zone_of(x))

for i, st in enumerate(storeys):
    z = i * STOREY_H
    h = STOREY_H - SLAB_T
    for k, (x, y) in enumerate(grid, 1):
        make("IfcColumn", f"Column {i}.{k:02d}", st, box(COL, COL, h), at(x, y, z), COL * COL * h, "Qto_ColumnBaseQuantities", zone_of(x))
    # Walls round the edge, one per side.
    sides = [
        ("South", width, (width / 2, 0.0), 0.0),
        ("North", width, (width / 2, depth), 0.0),
        ("West", depth, (0.0, depth / 2), np.pi / 2),
        ("East", depth, (width, depth / 2), np.pi / 2),
    ]
    for side, length, (x, y), rot in sides:
        zone = "West" if side == "West" else "East" if side == "East" else zone_of(x - 0.01)
        make("IfcWall", f"Wall {i}.{side}", st, box(length, WALL_T, h), at(x, y, z, rot), length * WALL_T * h, "Qto_WallBaseQuantities", zone)
    # The slab over this storey: two halves, so each zone has its own.
    above = storeys[i + 1] if i + 1 < len(storeys) else roof
    for half, cx in (("West", width / 4), ("East", 3 * width / 4)):
        make("IfcSlab", f"Slab {i + 1}.{half}", above, box(width / 2 + COL, depth + COL, SLAB_T), at(cx, depth / 2, z + h), (width / 2 + COL) * (depth + COL) * SLAB_T, "Qto_SlabBaseQuantities", half)

OUT.parent.mkdir(parents=True, exist_ok=True)
model.write(str(OUT))
print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(model.by_type('IfcElement'))} objects)")
