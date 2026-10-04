"""
Helper functions used across the CWA Planning project
"""
import re
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element

# Global geometry availability flag
try:
    geom_settings = ifcopenshell.geom.settings()
    GEOM_AVAILABLE = True
except Exception:
    GEOM_AVAILABLE = False
    print("Warning: ifcopenshell.geom not available → some features will be limited")


def extract_value(prop):
    """
    Extract the actual value from an IFC property (handles wrapped values, None-safety)
    """
    if prop is None:
        return None
    
    if hasattr(prop, "NominalValue") and prop.NominalValue is not None:
        val = prop.NominalValue
        return val.wrappedValue if hasattr(val, "wrappedValue") else val
    
    return prop


def title_case(s: str | None) -> str:
    """
    Convert string to Title Case (first letter of each word uppercase)
    """
    if not s:
        return ""
    return ' '.join(word.capitalize() for word in str(s).split())


def indent(elem, level: int = 0):
    """
    In-place pretty-print for ElementTree XML (adds indentation and newlines)
    Makes exported P6 XML human-readable
    """
    i = "\n" + level * "  "
    j = "\n" + (level - 1) * "  "

    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = i + "  "
        if not elem.tail or not elem.tail.strip():
            elem.tail = i

        for subelem in elem:
            indent(subelem, level + 1)

        if not elem.tail or not elem.tail.strip():
            elem.tail = j
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = j


def get_original_building_name(element) -> str:
    """
    Walk up the element's original spatial containment/decomposition chain
    (IfcRelContainedInSpatialStructure, then IfcRelAggregates) to find the
    IfcBuilding it was authored under in the source model, and return its Name.

    Must be called before consolidate_spatial_structure() runs, since that
    step deletes and rebuilds all IfcBuilding entities.
    """
    try:
        current = ifcopenshell.util.element.get_container(element)
        while current is not None:
            if current.is_a("IfcBuilding"):
                return str(getattr(current, "Name", "") or "").strip()
            current = ifcopenshell.util.element.get_aggregate(current)
    except Exception:
        pass
    return ""


def get_cardinal_zone(element, building_code: str = None) -> str:
    """
    Calculate cardinal zone (North/South or East/West) based on geometry centroid coordinate.
    Falls back to 'Unknown' if geometry is unavailable or calculation fails.
    
    Args:
        element: IFC element to analyze
        building_code: Building code to lookup coordinate threshold from config
    """
    if not GEOM_AVAILABLE:
        return "Unknown (geometry engine not available)"

    # Import here to avoid circular dependency
    from config import BUILDING_COORDINATES

    try:
        # Get building configuration or use default
        config = BUILDING_COORDINATES.get(building_code or "DEFAULT", BUILDING_COORDINATES["DEFAULT"])
        axis = config.get("axis", "X").upper()
        threshold = config.get("threshold")

        if threshold is None:
            return "Unknown (no threshold configured)"

        # Prefer absolute placement coordinates (typically global/site coordinates)
        x, y, _ = get_element_world_coordinates(element)
        if axis == "X" and x is not None:
            return "North" if x > threshold else "South"
        if axis == "Y" and y is not None:
            return "East" if y > threshold else "West"

        # Fallback: centroid from geometry vertices
        shape = ifcopenshell.geom.create_shape(geom_settings, element)
        verts = shape.geometry.verts

        if not verts or len(verts) < 3:
            return "No usable geometry"

        xs = [verts[i] for i in range(0, len(verts), 3)]
        ys = [verts[i+1] for i in range(0, len(verts), 3)]

        if not xs or not ys:
            return "Empty vertex list"

        if axis == "X":
            center_value = sum(xs) / len(xs)
            return "North" if center_value > threshold else "South"
        elif axis == "Y":
            center_value = sum(ys) / len(ys)
            return "East" if center_value > threshold else "West"
        else:
            return f"Unknown (invalid axis: {axis})"

    except Exception as e:
        print(f"Geometry error in get_cardinal_zone for element #{element.id()}: {e}")
        return "Unknown (geometry error)"


_BBOX_HEIGHT_CACHE = {}


def get_bbox_height(element) -> float | None:
    """Vertical extent (maxZ - minZ) of an element's true geometry bounding
    box, in metres. Uses ifcopenshell.geom, so it reflects the actual solid
    rather than the authored "Max/Min Elevation" pset values. Returns None
    when geometry is unavailable or the shape can't be built. Cached per
    element id since build_pour_records is the only caller and touches each
    element once."""
    if not GEOM_AVAILABLE:
        return None

    key = element.id()
    if key in _BBOX_HEIGHT_CACHE:
        return _BBOX_HEIGHT_CACHE[key]

    height = None
    try:
        shape = ifcopenshell.geom.create_shape(geom_settings, element)
        zs = [shape.geometry.verts[i] for i in range(2, len(shape.geometry.verts), 3)]
        if zs:
            height = round(max(zs) - min(zs), 3)
    except Exception as e:
        print(f"Geometry error in get_bbox_height for element #{element.id()}: {e}")

    _BBOX_HEIGHT_CACHE[key] = height
    return height


# Optional: small utility to help debug coordinate systems
def debug_centroid_x(element) -> float | None:
    """Quick helper to print/test centroid X values during development"""
    if not GEOM_AVAILABLE:
        return None
    try:
        shape = ifcopenshell.geom.create_shape(geom_settings, element)
        xs = [shape.geometry.verts[i] for i in range(0, len(shape.geometry.verts), 3)]
        return sum(xs) / len(xs) if xs else None
    except:
        return None


def get_element_world_coordinates(element):
    """
    Resolve absolute world coordinates from IfcLocalPlacement chain.
    Returns (x, y, z) or (None, None, None) if unavailable.
    """
    try:
        placement = getattr(element, "ObjectPlacement", None)
        if placement is None:
            return (None, None, None)

        x = 0.0
        y = 0.0
        z = 0.0
        current = placement

        while current is not None:
            rel = getattr(current, "RelativePlacement", None)
            loc = getattr(rel, "Location", None) if rel is not None else None

            if loc is not None and hasattr(loc, "Coordinates") and loc.Coordinates:
                coords = list(loc.Coordinates)
                if len(coords) >= 1:
                    x += float(coords[0] or 0.0)
                if len(coords) >= 2:
                    y += float(coords[1] or 0.0)
                if len(coords) >= 3:
                    z += float(coords[2] or 0.0)

            current = getattr(current, "PlacementRelTo", None)

        return (x, y, z)
    except Exception:
        return (None, None, None)
    
def _build_intra_pour_predecessors(activities):
    """Build predecessors ONLY inside the same pour (phase sequence).
    Cross-pour same-phase links remain manual."""
    from collections import defaultdict

    # Group all activities by pour (using planning_proposed_pour_id + building)
    pour_groups = defaultdict(list)
    for act in activities:
        rec = act.get("rec", {})
        pour_key = (
            str(rec.get("building", "")),
            str(rec.get("planning_proposed_pour_id", "")).zfill(4)
        )
        pour_groups[pour_key].append(act)

    # Define the desired phase order per pour type
    phase_order = {
        "WALL": ["Rebar", "Formwork", "Concrete"],
        "SLAB": ["Decking", "Rebar", "Concrete"],   # or Formwork if you prefer
        "MAIN_SLAB": ["Decking", "Rebar", "Concrete"],
        "PRECAST": ["Installation", "Stitching"],
        # Add more types if needed
    }

    predecessors = defaultdict(list)   # activity_id -> list of predecessor activity_ids

    for acts in pour_groups.values():
        if not acts:
            continue

        # Get pour type from first activity
        pour_type = str(acts[0].get("rec", {}).get("pour_type", "")).upper()

        order = phase_order.get(pour_type)
        if not order:
            # Fallback for unknown types: try common sequence
            order = ["Rebar", "Formwork", "Concrete"]

        # Map phase → activity
        phase_map = {}
        for act in acts:
            phase = str(act.get("phase", "")).strip()
            if phase:
                phase_map[phase] = act.get("task_id")

        # Chain them in the defined order
        prev_task = None
        for ph in order:
            curr_task = phase_map.get(ph)
            if curr_task and prev_task:
                predecessors[curr_task].append(prev_task)
            if curr_task:
                prev_task = curr_task

    return predecessors