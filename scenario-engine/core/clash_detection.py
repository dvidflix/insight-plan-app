# src/clash_detection.py
"""
Pour-to-pour clearance checking using ifcclash
"""
import shutil
import logging
import tempfile
from pathlib import Path
import ifcopenshell

try:
    from ifcclash.ifcclash import Clasher, ClashSettings
    IFCCLASH_AVAILABLE = True
except ImportError:
    IFCCLASH_AVAILABLE = False
    print("Warning: ifcclash not installed → clash detection disabled")

from config import CLEARANCE_MM


def extract_pour_elements(model):
    pour_elements = []
    valid_pset_names = {"BYLOR Pour", "CWA Pour"}
    for rel in model.by_type("IfcRelDefinesByProperties"):
        pset = rel.RelatingPropertyDefinition
        if getattr(pset, "Name", None) not in valid_pset_names:
            continue
            
        pour_id_prop = next(
            (p for p in pset.HasProperties if p.Name == "Pour ID Number"),
            None
        )
        
        if pour_id_prop is None:
            continue
            
        pour_id_value = extract_value(pour_id_prop)
        pour_id_text = str(pour_id_value or "").strip()
        if not pour_id_text:
            continue
            
        for element in rel.RelatedObjects:
            pour_elements.append((element, pour_id_text))
    
    return pour_elements


def split_pours_odd_even(pour_elements):
    def _numeric_part(value):
        text = str(value or "").strip()
        digits = ""
        for ch in text:
            if ch.isdigit():
                digits += ch
            else:
                break
        return int(digits) if digits else None

    odd = []
    even = []
    for element, pour_id in pour_elements:
        numeric = _numeric_part(pour_id)
        if numeric is None:
            continue
        if numeric % 2 == 1:
            odd.append((element, pour_id))
        else:
            even.append((element, pour_id))
    return odd, even


def save_temp_ifc_subset(model, elements, filename, temp_dir):
    temp_file = temp_dir / filename
    subset = ifcopenshell.file(schema=model.schema)
    
    for t in ["IfcProject", "IfcUnitAssignment", "IfcGeometricRepresentationContext"]:
        for entity in model.by_type(t):
            subset.add(entity)
    
    for element, _ in elements:
        subset.add(element)
    
    subset.write(temp_file)
    return temp_file


def run_pour_to_pour_clearance(model_path):
    if not IFCCLASH_AVAILABLE:
        print("Clash detection skipped: ifcclash library not available")
        return []

    print(f"Running pour-to-pour clearance check ({CLEARANCE_MM}mm)...")
    
    try:
        model = ifcopenshell.open(model_path)
    except Exception as e:
        print(f"Failed to open IFC model: {e}")
        return []

    pour_elements = extract_pour_elements(model)
    if not pour_elements:
        print("No pours with 'BYLOR Pour' property set found")
        return []

    print(f"   Found {len(pour_elements)} pour elements")

    print(f"   Checking all pours against all pours ({len(pour_elements)} elements)")

    # A fresh folder in the system temp directory, removed afterwards: nothing
    # is left in the project (it used to be <repo>/0-src/_tmp_clash).
    temp_dir = Path(tempfile.mkdtemp(prefix="insight-plan-clash-"))

    try:
        all_pours_file = save_temp_ifc_subset(model, pour_elements, "all_pours.ifc", temp_dir)

        settings = ClashSettings()
        settings.logger = logging.getLogger("ifcclash")
        settings.logger.addHandler(logging.NullHandler())

        clasher = Clasher(settings)
        clasher.clash_sets = [{
            "name": "Pour clearance check",
            "a": [{"file": str(all_pours_file)}],
            "b": [{"file": str(all_pours_file)}],
            "mode": "clearance",
            "clearance": CLEARANCE_MM / 1000.0,
            "check_all": True,
        }]

        clasher.clash()

        clashes = []
        seen_pairs = set()
        for clash_set in clasher.clash_sets:
            for _, data in clash_set.get("clashes", {}).items():
                dist = data.get("distance", 999.0)
                if dist < (CLEARANCE_MM / 1000.0) + 0.001:
                    a_guid = str(data.get("a_global_id", "") or "").strip()
                    b_guid = str(data.get("b_global_id", "") or "").strip()
                    if not a_guid or not b_guid or a_guid == b_guid:
                        continue

                    pair = tuple(sorted((a_guid, b_guid)))
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)

                    clashes.append({
                        "Pour A GUID": a_guid,
                        "Pour A Name": data.get("a_name", "Unknown"),
                        "Pour B GUID": b_guid,
                        "Pour B Name": data.get("b_name", "Unknown"),
                        "Distance (mm)": round(dist * 1000, 2),
                        "Distance (m)": round(dist, 4),
                        "Violation": f"< {CLEARANCE_MM}mm clearance",
                    })

        print(f"   Found {len(clashes)} clearance violations")
        return clashes

    except Exception as e:
        print(f"Clash detection failed: {e}")
        return []

    finally:
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


def extract_value(p):
    if p is None: return None
    if hasattr(p, "NominalValue") and p.NominalValue is not None:
        v = p.NominalValue
        return v.wrappedValue if hasattr(v, "wrappedValue") else v
    return p