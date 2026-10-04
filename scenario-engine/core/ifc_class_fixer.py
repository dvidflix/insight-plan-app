"""
IFC Class Fixer - Convert IfcBuildingElementProxy to proper IFC classes
Based on BYLOR/CWA Pour Type property
"""
import ifcopenshell
import ifcopenshell.util.element
from pathlib import Path
from typing import Dict, Tuple
import re


# Mapping from Pour Type to IFC Class
POUR_TYPE_TO_IFC_CLASS = {
    "SLAB":     "IfcSlab",
    "MAIN_SLAB":     "IfcSlab",
    "REMOVABLE_ELEMENT":  "IfcSlab",
    "BEAM":     "IfcBeam",
    "BOSS":     "IfcBuildingElementProxy",
    "CORBEL":   "IfcBeam",
    "RAFT":     "IfcFooting",
    "SCREED":   "IfcCovering",
    "SPECIAL":  "IfcBuildingElementProxy",
    "HEAVY_PRECAST":  "IfcMember",
    "PEDESTAL":  "IfcBuildingElementProxy",
    "GULLIES":  "IfcBuildingElementProxy",
    "PARAPET":  "IfcWall",
    "UPSTAND":  "IfcBuildingElementProxy",
    "WALL":     "IfcWall",
    "COLUMN":   "IfcColumn",
    "LANDING":  "IfcSlab",
    "STAIR":  "IfcStair",
    "PIT":      "IfcFooting",
    "PITS & RAFT": "IfcFooting",
}

POUR_TYPE_PROPERTY_SETS = (
    "CWA Pour",
)

POUR_TYPE_PROPERTY_NAMES = (
    "Pour Type",
)


def _canonicalize_pour_type(value: str) -> str:
    """Normalize pour type tokens so spaces/underscores/symbols map consistently."""
    normalized = str(value or "").strip().upper()
    if not normalized:
        return ""
    normalized = normalized.replace("&", " AND ")
    normalized = re.sub(r"[^A-Z0-9]+", "_", normalized)
    return normalized.strip("_")


CANONICAL_POUR_TYPE_TO_IFC_CLASS = {
    _canonicalize_pour_type(pour_type): ifc_class
    for pour_type, ifc_class in POUR_TYPE_TO_IFC_CLASS.items()
}


def _target_class_from_pour_type(pour_type: str):
    canonical = _canonicalize_pour_type(pour_type)
    if not canonical:
        return None

    direct = CANONICAL_POUR_TYPE_TO_IFC_CLASS.get(canonical)
    if direct:
        return direct

    # Common aliases used in CWA/BYLOR models.
    alias_map = {
        "MAIN_SLAB": "SLAB",
        "PITS_AND_RAFT": "PITS_RAFT",
    }
    alias = alias_map.get(canonical)
    if alias:
        return CANONICAL_POUR_TYPE_TO_IFC_CLASS.get(alias)

    return None


def _extract_pour_type(proxy):
    """Read pour type from direct or inherited psets."""
    # Preferred: inherited psets (covers typed occurrences too).
    try:
        psets = ifcopenshell.util.element.get_psets(proxy) or {}
        for pset_name in POUR_TYPE_PROPERTY_SETS:
            pset = psets.get(pset_name)
            if not isinstance(pset, dict):
                continue
            for prop_name in POUR_TYPE_PROPERTY_NAMES:
                value = pset.get(prop_name)
                if value is not None and str(value).strip():
                    return str(value), True
    except Exception:
        pass

    # Fallback: direct IsDefinedBy walk.
    has_supported_pset = False
    for rel in getattr(proxy, "IsDefinedBy", []) or []:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        pset = rel.RelatingPropertyDefinition
        if not (pset.is_a("IfcPropertySet") and pset.Name in POUR_TYPE_PROPERTY_SETS):
            continue

        has_supported_pset = True
        for prop_name in POUR_TYPE_PROPERTY_NAMES:
            prop = next((p for p in getattr(pset, "HasProperties", []) if p.Name == prop_name), None)
            if prop and getattr(prop, "NominalValue", None):
                return str(prop.NominalValue.wrappedValue), has_supported_pset

    return None, has_supported_pset


def fix_ifc_classes(input_path: Path, output_path: Path = None) -> Tuple[Path, int]:
    """
    Fix IFC element classes by converting IfcBuildingElementProxy to proper types
    based on BYLOR Pour Type property.
    
    Args:
        input_path: Path to input IFC file
        output_path: Path to output fixed IFC file (default: input_path with _FIXED suffix)
        
    Returns:
        Tuple of (output_path, number_of_elements_fixed)
    """
    if output_path is None:
        output_path = input_path.parent / input_path.name.replace(".ifc", "_FIXED.ifc")
    
    print(f"[IFC Class Fixer] Analyzing: {input_path.name}")
    
    # Load model to identify elements to fix
    model = ifcopenshell.open(str(input_path))
    
    proxies = model.by_type("IfcBuildingElementProxy")
    print(f"[IFC Class Fixer] Found {len(proxies)} IfcBuildingElementProxy elements")
    
    to_fix = {}  # "#12345" → "IfcSlab"
    
    proxies_with_supported_pset = 0
    for proxy in proxies:
        pour_type, has_supported_pset = _extract_pour_type(proxy)
        
        if has_supported_pset:
            proxies_with_supported_pset += 1
        
        if not pour_type:
            continue
        
        target_class = _target_class_from_pour_type(pour_type)
        if target_class and target_class != "IfcBuildingElementProxy":
            to_fix[f"#{proxy.id()}"] = target_class
    
    print(f"[IFC Class Fixer] Proxies with supported pour pset: {proxies_with_supported_pset}")
    print(f"[IFC Class Fixer] Elements with valid Pour Type to convert: {len(to_fix)}")
    
    if not to_fix:
        print(f"[IFC Class Fixer] No elements need fixing")
        # If output path specified, copy the file
        if output_path and output_path != input_path:
            import shutil
            shutil.copy2(str(input_path), str(output_path))
            print(f"[IFC Class Fixer] Copied original to → {output_path.name}")
            return output_path, 0
        return input_path, 0
    
    print(f"[IFC Class Fixer] Found {len(to_fix)} elements to convert")
    
    # Show first few conversions for debugging
    for i, (step_id, target) in enumerate(list(to_fix.items())[:3]):
        print(f"  Example {i+1}: {step_id} → {target}")
    
    # Text-based replacement (most reliable method)
    with open(input_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Debug: Show what the file actually contains for first element
    if to_fix:
        first_id = list(to_fix.keys())[0]
        idx = content.find(first_id)
        if idx != -1:
            sample = content[idx:idx+80]
            print(f"  File sample: {sample[:70]}")
        else:
            print(f"  WARNING: {first_id} not found in file!")
    
    changed = 0
    failed_step_ids = []
    for step_id, new_class in to_fix.items():
        entity_upper = new_class.upper()
        pattern = re.compile(
            rf"({re.escape(step_id)}\s*=\s*)IFCBUILDINGELEMENTPROXY(\s*\()",
            flags=re.IGNORECASE,
        )
        content, replacements = pattern.subn(rf"\1{entity_upper}\2", content, count=1)
        if replacements:
            changed += replacements
        else:
            failed_step_ids.append(step_id)

    if failed_step_ids:
        print(f"[IFC Class Fixer] Could not replace {len(failed_step_ids)} element(s); sample: {', '.join(failed_step_ids[:5])}")
    
    # Write fixed file
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    if changed == 0:
        print(f"[IFC Class Fixer] WARNING: No replacements made - check file format")
    elif changed != len(to_fix):
        print(f"[IFC Class Fixer] WARNING: Only {changed} of {len(to_fix)} elements were replaced")
    
    print(f"[IFC Class Fixer] Fixed {changed} elements → {output_path.name}")
    
    return output_path, changed


def fix_ifc_classes_in_place(input_path: Path) -> Tuple[Path, int]:
    """
    Fix IFC classes and replace the original file
    
    Args:
        input_path: Path to IFC file to fix in-place
        
    Returns:
        Tuple of (input_path, number_of_elements_fixed)
    """
    temp_output = input_path.parent / f"{input_path.stem}_TEMP_FIXED.ifc"
    
    try:
        fixed_path, count = fix_ifc_classes(input_path, temp_output)
        
        if count > 0:
            # Replace original with fixed version
            import shutil
            shutil.move(str(temp_output), str(input_path))
            print(f"[IFC Class Fixer] Original file updated with fixes")
            return input_path, count
        else:
            # No changes needed, remove temp file if it exists
            if temp_output.exists():
                temp_output.unlink()
            return input_path, 0
            
    except Exception as e:
        # Clean up temp file on error
        if temp_output.exists():
            temp_output.unlink()
        raise e
