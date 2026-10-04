"""
Geometry measurements for walls and slabs, used to classify them (wall classes /
slab classes) and, later, to turn quantities into durations with productivity rates.

The IFC models carry no quantity sets and no opening elements, only the "CWA Pour"
property set, so everything here is measured from the triangulated geometry:

  * footprint  = the union of the upward-facing triangles projected to plan
  * shape      = the footprint's corner count (4 straight, 6 L, 8 T/U/Z ...), curved or not
  * thickness  = from the footprint's area and perimeter (walls), volume / plan area (slabs)
  * openings   = the holes in the wall's silhouette seen along its thickness
  * formwork   = the vertical surface area (walls) / soffit + edge area (slabs)

Units are metres, square metres, cubic metres (ifcopenshell's default).
"""
from __future__ import annotations

import math

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element

WALL_CLASSES = {"IfcWall", "IfcWallStandardCase"}
SLAB_CLASSES = {"IfcSlab"}

# A triangle is "top" / "bottom" above this |normal.z|, "side" below SIDE_NZ.
FACE_NZ = 0.8
SIDE_NZ = 0.3
# Holes smaller than this (m2) in a silhouette are modelling noise, not openings.
MIN_OPENING_AREA = 0.04
# Plan outline: simplify tolerance (m); turns above CORNER_DEG are corners, small ones are curvature.
SIMPLIFY_TOL = 0.03
CORNER_DEG = 45.0
CURVE_DEG = 4.0
HEAL = 0.002


def _settings():
    s = ifcopenshell.geom.settings()
    try:
        s.set("use-world-coords", True)
    except Exception:  # older ifcopenshell
        s.set(s.USE_WORLD_COORDS, True)
    return s


def _mesh(shape):
    verts = np.asarray(shape.geometry.verts, dtype=float).reshape(-1, 3)
    faces = np.asarray(shape.geometry.faces, dtype=int).reshape(-1, 3)
    tri = verts[faces]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area2 = np.linalg.norm(cross, axis=1)
    ok = area2 > 1e-10
    tri, cross, area2 = tri[ok], cross[ok], area2[ok]
    normals = cross / area2[:, None]
    areas = area2 / 2.0
    volume = abs(float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum())) / 6.0
    return tri, normals, areas, volume


def _union_xy(tri, xy_cols=(0, 1)):
    """Union of triangles projected onto two coordinate columns, healed of slivers."""
    if len(tri) == 0:
        return Polygon()
    pts = tri[:, :, list(xy_cols)]
    ring = np.concatenate([pts, pts[:, :1]], axis=1)
    polys = shapely.polygons(ring)
    polys = polys[shapely.area(polys) > 1e-9]
    if len(polys) == 0:
        return Polygon()
    merged = unary_union(polys)
    return merged.buffer(HEAL).buffer(-HEAL)


def _largest(geom):
    if isinstance(geom, MultiPolygon):
        return max(geom.geoms, key=lambda g: g.area), len(geom.geoms)
    return geom, (0 if geom.is_empty else 1)


def _turns(poly: Polygon):
    """(corners, curve points) of the outline: simplified, then each vertex's turning angle."""
    ring = poly.exterior.simplify(SIMPLIFY_TOL, preserve_topology=True)
    pts = list(ring.coords)[:-1]
    n = len(pts)
    corners = curve = 0
    for i in range(n):
        a, b, c = np.array(pts[i - 1]), np.array(pts[i]), np.array(pts[(i + 1) % n])
        v1, v2 = b - a, c - b
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if l1 < 1e-9 or l2 < 1e-9:
            continue
        cosang = float(np.clip(np.dot(v1, v2) / (l1 * l2), -1, 1))
        turn = math.degrees(math.acos(cosang))
        if turn >= CORNER_DEG:
            corners += 1
        elif turn >= CURVE_DEG:
            curve += 1
    return corners, curve


def _obb(poly: Polygon):
    """(long side, short side, unit vector along the long side) of the minimum rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    e1 = np.array(c[1]) - np.array(c[0])
    e2 = np.array(c[2]) - np.array(c[1])
    l1, l2 = float(np.linalg.norm(e1)), float(np.linalg.norm(e2))
    if l1 >= l2:
        return l1, l2, e1 / max(l1, 1e-9), rect.area
    return l2, l1, e2 / max(l2, 1e-9), rect.area


def _plan_shape(corners: int, curve: int, fill: float, aspect: float) -> str:
    if curve >= 4:
        return "CURVED"
    if corners == 4 and fill >= 0.9:
        return "PIER" if aspect < 3 else "STRAIGHT"
    if corners == 6:
        return "L_CORNER"
    if corners == 8:
        return "T_U_Z"
    return "COMPLEX"


def _openings(tri, normals, areas, axis_long):
    """Holes in the wall's silhouette along its thickness: (count, total area, gross silhouette area)."""
    v = np.array([-axis_long[1], axis_long[0]])  # horizontal, across the thickness
    faceish = np.abs(normals[:, 0] * v[0] + normals[:, 1] * v[1]) > 0.7
    sel = tri[faceish]
    if len(sel) == 0:
        return 0, 0.0, 0.0
    s = sel[:, :, 0] * axis_long[0] + sel[:, :, 1] * axis_long[1]
    z = sel[:, :, 2]
    proj = np.stack([s, z], axis=2)
    sil = _union_xy(proj, (0, 1))
    if sil.is_empty:
        return 0, 0.0, 0.0
    geoms = sil.geoms if isinstance(sil, MultiPolygon) else [sil]
    holes = [Polygon(r).area for g in geoms for r in g.interiors]
    holes = [h for h in holes if h >= MIN_OPENING_AREA]
    gross = sum(Polygon(g.exterior).area for g in geoms)
    return len(holes), float(sum(holes)), float(gross)


def measure(element, settings=None) -> dict:
    """Features of one wall or slab; {"error": ...} when its geometry can't be built."""
    settings = settings or _settings()
    cls = element.is_a()
    out: dict = {"ifc_class": cls}
    try:
        shape = ifcopenshell.geom.create_shape(settings, element)
        tri, normals, areas, volume = _mesh(shape)
    except Exception as e:  # noqa: BLE001 — reported in the row, never stops the run
        return {**out, "error": f"{type(e).__name__}: {e}"}
    if len(tri) == 0:
        return {**out, "error": "empty geometry"}

    nz = normals[:, 2]
    top = nz > FACE_NZ
    bottom = nz < -FACE_NZ
    side = np.abs(nz) < SIDE_NZ
    z_min, z_max = float(tri[:, :, 2].min()), float(tri[:, :, 2].max())

    plan = _union_xy(tri[top])
    if plan.is_empty:  # no upward faces (rare): fall back to everything
        plan = _union_xy(tri)
    main, parts = _largest(plan)
    out.update(
        volume_m3=round(volume, 3),
        z_min=round(z_min, 3),
        z_max=round(z_max, 3),
        height_m=round(z_max - z_min, 3),
        plan_area_m2=round(float(plan.area), 3),
        plan_parts=parts,
        top_area_m2=round(float(areas[top].sum()), 3),
        soffit_area_m2=round(float(areas[bottom].sum()), 3),
        side_area_m2=round(float(areas[side].sum()), 3),
    )
    if main.is_empty:
        return {**out, "error": "no plan outline"}

    long_side, short_side, axis, obb_area = _obb(main)
    corners, curve = _turns(main)
    fill = float(main.area / obb_area) if obb_area > 0 else 0.0
    perim = float(main.exterior.length)
    disc = max(perim * perim - 16.0 * float(main.area), 0.0)
    thickness_plan = (perim - math.sqrt(disc)) / 4.0
    out.update(
        plan_perimeter_m=round(perim, 3),
        obb_length_m=round(long_side, 3),
        obb_width_m=round(short_side, 3),
        plan_fill=round(fill, 3),
        plan_corners=corners,
        plan_curve_points=curve,
        plan_shape=_plan_shape(corners, curve, fill, long_side / max(short_side, 1e-9)),
    )

    if cls in WALL_CLASSES:
        thickness = min(thickness_plan, short_side) if thickness_plan > 0 else short_side
        n_open, open_area, gross = _openings(tri, normals, areas, axis)
        out.update(
            thickness_m=round(thickness, 3),
            length_m=round(float(main.area) / thickness, 3) if thickness > 0 else None,
            opening_count=n_open,
            opening_area_m2=round(open_area, 3),
            opening_ratio=round(open_area / (gross), 3) if gross > 0 else 0.0,
            formwork_area_m2=round(float(areas[side].sum()), 3),
        )
    elif cls in SLAB_CLASSES:
        holes = [Polygon(r) for r in main.interiors if Polygon(r).area >= MIN_OPENING_AREA]
        hole_perim = sum(Polygon(r).exterior.length for r in holes)
        zs = np.round(tri[top][:, :, 2].mean(axis=1) / 0.05) * 0.05
        levels = 0
        if len(zs):
            total = float(areas[top].sum())
            for z in np.unique(zs):
                if float(areas[top][zs == z].sum()) >= 0.02 * total:
                    levels += 1
        out.update(
            thickness_m=round(volume / float(plan.area), 3) if plan.area > 0 else None,
            slab_hole_count=len(holes),
            slab_hole_area_m2=round(float(sum(h.area for h in holes)), 3),
            slab_top_levels=levels,
            edge_length_m=round(perim + hole_perim, 3),
            formwork_area_m2=round(float(areas[bottom].sum() + areas[side].sum()), 3),
        )
    return out


def pour_info(element) -> dict:
    """Name and the pour properties the generator keys on."""
    p = ifcopenshell.util.element.get_psets(element).get("CWA Pour", {}) or {}

    def val(*keys):
        for k in keys:
            v = p.get(k)
            if v not in (None, ""):
                return v.strip() if isinstance(v, str) else v
        return None

    return {
        "guid": element.GlobalId,
        "name": getattr(element, "Name", None),
        "pour_id": val("Pour ID Number", "PourID"),
        "pour_type": val("Pour Type", "General Pour Type"),
        "level": val("Level"),
        "pour_volume_m3": val("Pour Volume m3"),
    }


def measure_model(model, only_classes=None, progress=None):
    """Features for every wall / slab that carries the CWA Pour pset (the elements pours are made of)."""
    classes = only_classes or (WALL_CLASSES | SLAB_CLASSES)
    settings = _settings()
    elements = []
    for cls in sorted(classes):
        for e in model.by_type(cls):
            if "CWA Pour" in ifcopenshell.util.element.get_psets(e):
                elements.append(e)
    rows = []
    for i, e in enumerate(elements):
        row = {**pour_info(e), **measure(e, settings)}
        rows.append(row)
        if progress:
            progress(i + 1, len(elements))
    return rows
