"""
IFC Color Manager - Apply colors to elements based on groups
Colors alternate between vivid (odd levels) and muted (even levels)
"""
import ifcopenshell
import ifcopenshell.api
from typing import Dict, Tuple, Optional


# RGB colors (0-1 range) - Vivid colors for odd levels
VIVID_COLORS = {
    "EW": (1.0, 0.647, 0.0),      # Orange - External Wall
    "EW-DH": (1.0, 0.855, 0.725),  # Light Orange - External Wall Double Height
    "IW": (1.0, 0.412, 0.706),     # Pink - Internal Wall
    "S": (0.5, 0.5, 0.5),    # Gray - Slab
    "PCS": (0.678, 0.847, 0.902),  # Light Blue - Precast Slab
}

# RGB colors (0-1 range) - Muted colors for even levels
MUTED_COLORS = {
    "EW": (1.0, 1.0, 0.878),       # Light Yellow - External Wall
    "EW-DH": (1.0, 0.937, 0.835),  # Very Light Peach - External Wall Double Height
    "IW": (1.0, 0.753, 0.796),     # Light Pink - Internal Wall
    "S": (0.7, 0.7, 0.7),    # Gray - Slab (same as vivid)
    "PCS": (00.678, 0.847, 0.902),  # Muted Blue - Precast Slab
}

# Special colors (not level-dependent)
SPECIAL_COLORS = {
    "L0": (0.5, 0.5, 0.5),          # Gray - Level 0
    "RAFT": (0.7, 0.7, 0.7),  # Medium Green - Raft
    "PRECAST": (0.475, 0.576, 0.659), # Medium Blue-Gray - Precast
    "Covering": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "BOSS": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "GROUT": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "SCREED": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "UPSTAND": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "COLUMN": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "PARAPET": (0.0, 0.545, 0.545), # Dark Cyan - Covering
    "CORBEL": (0.0, 0.545, 0.545), # Dark Cyan - Covering
}


def determine_color_group(task_name: str) -> Tuple[Optional[str], Optional[int]]:
    """
    Determine the color group and level from task name.
    
    Returns:
        Tuple of (group_type, level_number) or (special_group, None)
    """
    import re
    task_upper = task_name.upper()
    
    # Check for special cases first (non-level-dependent)
    if "PRECAST" in task_upper:
        return ("PRECAST", None)
    if "RAFT" in task_upper:
        return ("RAFT", None)
    if "GROUT" in task_upper:
        return ("GROUT", None)
    if "CORBEL" in task_upper:
        return ("CORBEL", None)
    
    # Extract level number dynamically using regex
    level_num = None
    # Match "LEVEL 1", "LEVEL 2", etc. or " L1 ", " L2 ", etc.
    level_match = re.search(r'LEVEL\s+(\d+)|(?:\s|-)L(\d+)(?:\s|-)', task_upper)
    if level_match:
        level_num = int(level_match.group(1) or level_match.group(2))
    
    # Level 0 uses special gray color
    if level_num == 0:
        return ("L0", None)
    
    # If no level found, check for other special types
    if level_num is None:
        if "COVERING" in task_upper or "SCREED" in task_upper:
            return ("Covering", None)
        if "BOSS" in task_upper:
            return ("BOSS", None)
        if "UPSTAND" in task_upper:
            return ("UPSTAND", None)
        if "COLUMN" in task_upper:
            return ("COLUMN", None)
        return (None, None)
    
    # Determine element type for level-dependent coloring
    if "SLAB (PRECAST)" in task_upper or "SLAB(PRECAST)" in task_upper or "SLAB (PRECAST)" in task_upper:
        return ("PCS", level_num)
    elif "SLAB" in task_upper or "LANDING" in task_upper:
        return ("S", level_num)
    elif "EXTERNAL" in task_upper and "DOUBLE HEIGHT" in task_upper:
        return ("EW-DH", level_num)
    elif "EXTERNAL" in task_upper and "WALL" in task_upper:
        return ("EW", level_num)
    elif "INTERNAL" in task_upper and "WALL" in task_upper:
        return ("IW", level_num)
    elif "WALL" in task_upper or "PARAPET" in task_upper or "UPSTAND" in task_upper:
        return ("IW", level_num)  # Default walls to internal wall colors
    elif "BOSS" in task_upper or "COLUMN" in task_upper:
        return ("BOSS", level_num)  # Treat as special but keep level info
    elif "BEAM" in task_upper or "CORBEL" in task_upper:
        return ("S", level_num)  # Use slab colors for beams/corbels
    elif "COVERING" in task_upper or "SCREED" in task_upper:
        return ("Covering", level_num)  # Covering with level
    
    # Default: return level info but no specific type (won't get colored)
    return (None, level_num)


def get_color_for_task(task_name: str) -> Optional[Tuple[float, float, float]]:
    """
    Get RGB color (0-1) for a given task name.
    
    Args:
        task_name: Task name from CWA_Planning property set
        
    Returns:
        RGB tuple (r, g, b) in 0-1 range, or None if no match
    """
    group_type, level_num = determine_color_group(task_name)
    
    if group_type is None:
        return None
    
    # Special cases (not level-dependent)
    if level_num is None:
        return SPECIAL_COLORS.get(group_type)
    
    # Level-dependent colors - odd levels use vivid, even use muted
    is_odd_level = (level_num % 2 == 1)
    color_set = VIVID_COLORS if is_odd_level else MUTED_COLORS
    
    color = color_set.get(group_type)
    
    # If level-dependent color not found, try special colors as fallback
    if color is None:
        color = SPECIAL_COLORS.get(group_type)
    
    return color


def create_surface_style(model, name: str, rgb: Tuple[float, float, float]):
    """
    Create an IFC surface style with the given color.
    
    Args:
        model: IFC model
        name: Style name
        rgb: RGB tuple (r, g, b) in 0-1 range
        
    Returns:
        IfcStyledItem
    """
    # Create RGB color
    color = model.create_entity(
        "IfcColourRgb",
        Name=name,
        Red=rgb[0],
        Green=rgb[1],
        Blue=rgb[2]
    )
    
    # Create rendering style
    rendering = model.create_entity(
        "IfcSurfaceStyleRendering",
        SurfaceColour=color
    )
    
    # Create surface style
    surface_style = model.create_entity(
        "IfcSurfaceStyle",
        Name=name,
        Side="BOTH",
        Styles=[rendering]
    )
    
    return surface_style


def apply_colors_to_model(model):
    """
    Apply colors to all elements based on their TaskName in CWA_Planning property set.
    
    Args:
        model: IFC model to colorize
    """
    print("[Color Manager] Applying colors to elements...")
    
    # Cache for created styles
    style_cache: Dict[str, any] = {}
    
    colored_count = 0
    total_count = 0
    
    # Get all products with CWA_Planning property set
    for element in model.by_type("IfcProduct"):
        total_count += 1
        
        # Find CWA_Planning property set
        task_name = None
        for rel in element.IsDefinedBy:
            if not rel.is_a("IfcRelDefinesByProperties"):
                continue
            pset = rel.RelatingPropertyDefinition
            if pset.is_a("IfcPropertySet") and pset.Name == "CWA_Planning":
                prop = next((p for p in pset.HasProperties if p.Name == "TaskName"), None)
                if prop and prop.NominalValue:
                    task_name = str(prop.NominalValue.wrappedValue)
                break
        
        if not task_name:
            continue
        
        # Get color for this task
        rgb = get_color_for_task(task_name)
        if rgb is None:
            continue
        
        # Create or get cached style
        color_key = f"{rgb[0]:.3f}_{rgb[1]:.3f}_{rgb[2]:.3f}"
        
        if color_key not in style_cache:
            style_name = f"Color_{color_key}"
            surface_style = create_surface_style(model, style_name, rgb)
            
            # Create presentation style assignment
            style_assignment = model.create_entity(
                "IfcPresentationStyleAssignment",
                Styles=[surface_style]
            )
            style_cache[color_key] = style_assignment
        
        style_assignment = style_cache[color_key]
        
        # Get or create representation
        if not element.Representation:
            continue
        
        for representation in element.Representation.Representations:
            for item in representation.Items:
                # Check if already styled
                existing_style = None
                if hasattr(item, "StyledByItem") and item.StyledByItem:
                    existing_style = item.StyledByItem[0]
                
                if existing_style:
                    # Update existing style
                    existing_style.Styles = [style_assignment]
                else:
                    # Create new styled item
                    model.create_entity(
                        "IfcStyledItem",
                        Item=item,
                        Styles=[style_assignment],
                        Name=None
                    )
        
        colored_count += 1
    
    print(f"[Color Manager] Colored {colored_count} of {total_count} elements")
    print(f"[Color Manager] Created {len(style_cache)} unique color styles")
