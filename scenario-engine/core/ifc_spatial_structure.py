"""
IFC Spatial Structure Manager
Consolidates IfcSite, IfcBuilding, and IfcBuildingStorey elements
"""
import ifcopenshell
import ifcopenshell.api
from collections import defaultdict


def consolidate_spatial_structure(model, elements_data):
    """
    Consolidate spatial structure: one IfcSite, one IfcBuilding per building code,
    one IfcBuildingStorey per level with proper elevations.
    
    Args:
        model: IFC model
        elements_data: List of dicts with 'element', 'building', 'level_info', 'level_int' keys
        
    Returns:
        Dict mapping (building, level) -> IfcBuildingStorey
    """
    print("[Spatial Structure] Consolidating IFC spatial hierarchy...")
    
    # Step 1: Remove all existing spatial containment relationships and storeys
    print("[Spatial Structure] Removing existing spatial structure...")
    
    # Unassign all elements from spatial containers
    for rel in list(model.by_type("IfcRelContainedInSpatialStructure")):
        try:
            model.remove(rel)
        except:
            pass
    
    # Remove all existing building storeys
    for storey in list(model.by_type("IfcBuildingStorey")):
        # Remove from aggregation relationships
        for rel in list(model.by_type("IfcRelAggregates")):
            if storey in rel.RelatedObjects:
                related = list(rel.RelatedObjects)
                related.remove(storey)
                if related:
                    rel.RelatedObjects = related
                else:
                    try:
                        model.remove(rel)
                    except:
                        pass
        # Remove the storey itself
        try:
            model.remove(storey)
        except:
            pass
    
    # Remove all existing buildings
    for building in list(model.by_type("IfcBuilding")):
        # Remove from aggregation relationships
        for rel in list(model.by_type("IfcRelAggregates")):
            if building in rel.RelatedObjects:
                related = list(rel.RelatedObjects)
                related.remove(building)
                if related:
                    rel.RelatedObjects = related
                else:
                    try:
                        model.remove(rel)
                    except:
                        pass
        # Remove the building itself
        try:
            model.remove(building)
        except:
            pass
    
    print("[Spatial Structure] Cleared existing structure")
    
    # Get or create single IfcSite
    sites = model.by_type("IfcSite")
    if sites:
        site = sites[0]
        # Update site name
        site.Name = "Project Site"
        print(f"[Spatial Structure] Using existing IfcSite: {site.Name}")
    else:
        # Create new site
        project = model.by_type("IfcProject")[0]
        site = model.create_entity(
            "IfcSite",
            GlobalId=ifcopenshell.guid.new(),
            Name="Project Site",
            ObjectType="Site"
        )
        # Create IfcRelAggregates to link project to site
        model.create_entity(
            "IfcRelAggregates",
            GlobalId=ifcopenshell.guid.new(),
            RelatingObject=project,
            RelatedObjects=[site]
        )
        print("[Spatial Structure] Created new IfcSite")
    
    # Group elements by building
    buildings_dict = defaultdict(list)
    for data in elements_data:
        building_code = data.get('building', 'UNKNOWN')
        buildings_dict[building_code].append(data)
    
    # Create IfcBuilding per building code (all were removed in cleanup)
    building_objects = {}
    
    for building_code in buildings_dict.keys():
        building = model.create_entity(
            "IfcBuilding",
            GlobalId=ifcopenshell.guid.new(),
            Name=building_code,
            ObjectType="Building"
        )
        # Link building to site
        rel_agg = model.by_type("IfcRelAggregates")
        site_rel = None
        for rel in rel_agg:
            if rel.RelatingObject == site:
                site_rel = rel
                break
        
        if site_rel:
            # Add to existing relationship
            related = list(site_rel.RelatedObjects)
            related.append(building)
            site_rel.RelatedObjects = related
        else:
            # Create new relationship
            model.create_entity(
                "IfcRelAggregates",
                GlobalId=ifcopenshell.guid.new(),
                RelatingObject=site,
                RelatedObjects=[building]
            )
        
        building_objects[building_code] = building
        print(f"[Spatial Structure] Created IfcBuilding: {building_code}")
    
    # Create or reuse IfcBuildingStorey per level within each building
    storey_map = {}
    
    # Group levels by building with level_int for sorting and elevation
    levels_per_building = defaultdict(dict)  # {building: {level_info: level_int}}
    for data in elements_data:
        building_code = data.get('building', 'UNKNOWN')
        level_info = str(data.get('level_info', 'Unknown') or 'Unknown').strip() or 'Unknown'
        level_int = data.get('level_int', 0)
        if level_info not in levels_per_building[building_code]:
            levels_per_building[building_code][level_info] = level_int
    
    # CRITICAL: Use consistent global elevation system across all buildings
    # All buildings use the same formula: Level 0 = 0m, Level 1 = 3m, Level 2 = 6m, etc.
    # This ensures when slicing in Z direction, all building levels align at same heights
    print("[Spatial Structure] Applying global elevation system (Level N = N × 3.0m) across all buildings")
    
    for building_code, levels_dict in levels_per_building.items():
        building = building_objects[building_code]
        
        # Sort levels by level_int
        sorted_levels = sorted(levels_dict.items(), key=lambda x: x[1])
        
        for level_info, level_int in sorted_levels:
            key = (building_code, level_info)
            
            # Calculate elevation using GLOBAL formula (same for ALL buildings)
            # Level 0 = 0.0m, Level 1 = 3.0m, Level 2 = 6.0m, etc.
            elevation = float(level_int * 3.0)
            
            # Use the source Level property for the visible storey name.
            level_name = level_info
            level_long_name = f"Level {level_int}"
            
            # Create new storey with elevation
            storey = model.create_entity(
                "IfcBuildingStorey",
                GlobalId=ifcopenshell.guid.new(),
                Name=level_name,
                LongName=level_long_name,
                ObjectType="Storey",
                Elevation=elevation
            )
            
            # Link storey to building
            rel_agg = model.by_type("IfcRelAggregates")
            building_rel = None
            for rel in rel_agg:
                if rel.RelatingObject == building:
                    building_rel = rel
                    break
            
            if building_rel:
                related = list(building_rel.RelatedObjects)
                related.append(storey)
                building_rel.RelatedObjects = related
            else:
                model.create_entity(
                    "IfcRelAggregates",
                    GlobalId=ifcopenshell.guid.new(),
                    RelatingObject=building,
                    RelatedObjects=[storey]
                )
            
            storey_map[key] = storey
            print(f"[Spatial Structure] Created IfcBuildingStorey: {building_code} - {level_name} (Elevation: {elevation}m)")
    
    # Assign elements to their storeys
    for data in elements_data:
        element = data.get('element')
        building_code = data.get('building', 'UNKNOWN')
        level_info = data.get('level_info', 'Unknown')
        
        key = (building_code, level_info)
        storey = storey_map.get(key)
        
        if storey and element:
            assign_element_to_spatial(model, element, storey)
    
    # Remove any empty buildings and storeys (shouldn't happen but just in case)
    remove_empty_spatial_containers(model)
    
    # Verify alignment: collect all unique elevations to confirm all buildings use same system
    all_elevations = set()
    for storey in model.by_type("IfcBuildingStorey"):
        if storey.Elevation is not None:
            all_elevations.add(storey.Elevation)
    
    if len(buildings_dict) > 1:
        print(f"[Spatial Structure] Multiple buildings detected - all using aligned elevations: {sorted(all_elevations)}")
    
    print(f"[Spatial Structure] Consolidated: 1 Site, {len(building_objects)} Buildings, {len(storey_map)} Storeys")
    
    return storey_map


def cleanup_spatial_structure(model):
    """Remove undefined/empty spatial entities and reassign orphaned elements"""
    print("[Spatial Structure] Cleaning up undefined/empty spatial entities...")
    
    # First, collect all elements in undefined storeys and unassign them
    orphaned_elements = []
    for storey in list(model.by_type("IfcBuildingStorey")):
        if not storey.Name or storey.Name == "Undefined":
            # Find elements in this storey and unassign them
            for rel in list(model.by_type("IfcRelContainedInSpatialStructure")):
                if rel.RelatingStructure == storey:
                    orphaned_elements.extend(rel.RelatedElements)
                    model.remove(rel)
    
    # Remove undefined storeys
    for storey in list(model.by_type("IfcBuildingStorey")):
        if not storey.Name or storey.Name == "Undefined":
            # Remove from aggregation relationships
            for rel in model.by_type("IfcRelAggregates"):
                if storey in rel.RelatedObjects:
                    related = list(rel.RelatedObjects)
                    related.remove(storey)
                    if related:
                        rel.RelatedObjects = related
                    else:
                        model.remove(rel)
            # Remove storey
            try:
                model.remove(storey)
                print(f"[Spatial Structure] Removed undefined storey")
            except:
                pass
    
    # Remove buildings with "Undefined" names or no name
    for building in list(model.by_type("IfcBuilding")):
        if not building.Name or building.Name == "Undefined":
            # Remove relationships
            for rel in model.by_type("IfcRelAggregates"):
                if building in rel.RelatedObjects:
                    related = list(rel.RelatedObjects)
                    related.remove(building)
                    if related:
                        rel.RelatedObjects = related
                    else:
                        model.remove(rel)
            # Remove building
            try:
                model.remove(building)
                print(f"[Spatial Structure] Removed undefined building")
            except:
                pass
    
    # Remove extra sites
    sites = list(model.by_type("IfcSite"))
    if len(sites) > 1:
        print(f"[Spatial Structure] Found {len(sites)} sites, keeping main site only")
        for site in sites[1:]:  # Keep first, remove rest
            # Remove relationships
            for rel in list(model.by_type("IfcRelAggregates")):
                if site == rel.RelatingObject:
                    model.remove(rel)
                if site in rel.RelatedObjects:
                    related = list(rel.RelatedObjects)
                    related.remove(site)
                    if related:
                        rel.RelatedObjects = related
                    else:
                        model.remove(rel)
            try:
                model.remove(site)
                print(f"[Spatial Structure] Removed extra site: {getattr(site, 'Name', 'Unnamed')}")
            except:
                pass
    
    if orphaned_elements:
        print(f"[Spatial Structure] Found {len(orphaned_elements)} orphaned elements (will remain uncontained until BYLOR processing)")
    
    return orphaned_elements


def remove_empty_spatial_containers(model):
    """Remove spatial containers (buildings, storeys) that have no elements"""
    # Remove empty storeys
    for storey in list(model.by_type("IfcBuildingStorey")):
        has_elements = False
        for rel in model.by_type("IfcRelContainedInSpatialStructure"):
            if rel.RelatingStructure == storey and rel.RelatedElements:
                has_elements = True
                break
        
        if not has_elements:
            # Remove from aggregation relationships
            for rel in model.by_type("IfcRelAggregates"):
                if storey in rel.RelatedObjects:
                    related = list(rel.RelatedObjects)
                    related.remove(storey)
                    if related:
                        rel.RelatedObjects = related
                    else:
                        model.remove(rel)
            try:
                model.remove(storey)
                print(f"[Spatial Structure] Removed empty storey: {storey.Name}")
            except:
                pass
    
    # Remove empty buildings
    for building in list(model.by_type("IfcBuilding")):
        has_storeys = False
        for rel in model.by_type("IfcRelAggregates"):
            if rel.RelatingObject == building and rel.RelatedObjects:
                has_storeys = True
                break
        
        if not has_storeys:
            # Remove from aggregation relationships
            for rel in model.by_type("IfcRelAggregates"):
                if building in rel.RelatedObjects:
                    related = list(rel.RelatedObjects)
                    related.remove(building)
                    if related:
                        rel.RelatedObjects = related
                    else:
                        model.remove(rel)
            try:
                model.remove(building)
                print(f"[Spatial Structure] Removed empty building: {building.Name}")
            except:
                pass
    
    # Remove duplicate/empty sites
    sites = model.by_type("IfcSite")
    if len(sites) > 1:
        # Keep only the first site with buildings
        kept_site = None
        for site in sites:
            has_buildings = False
            for rel in model.by_type("IfcRelAggregates"):
                if rel.RelatingObject == site and rel.RelatedObjects:
                    has_buildings = True
                    break
            if has_buildings and not kept_site:
                kept_site = site
            elif site != kept_site:
                # Remove this site
                for rel in list(model.by_type("IfcRelAggregates")):
                    if site == rel.RelatingObject:
                        model.remove(rel)
                    if site in rel.RelatedObjects:
                        related = list(rel.RelatedObjects)
                        related.remove(site)
                        if related:
                            rel.RelatedObjects = related
                        else:
                            model.remove(rel)
                try:
                    model.remove(site)
                    print(f"[Spatial Structure] Removed duplicate/empty site")
                except:
                    pass


def get_parent_building(model, storey):
    """Get the parent building name for a storey"""
    for rel in model.by_type("IfcRelAggregates"):
        if storey in rel.RelatedObjects:
            parent = rel.RelatingObject
            if parent.is_a("IfcBuilding"):
                return parent.Name if hasattr(parent, 'Name') else None
    return None


def assign_element_to_spatial(model, element, spatial_element):
    """
    Assign an element to a spatial structure element (e.g., IfcBuildingStorey)
    """
    # Remove existing spatial assignments
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        if element in rel.RelatedElements:
            related = list(rel.RelatedElements)
            related.remove(element)
            if related:
                rel.RelatedElements = related
            else:
                model.remove(rel)
            break
    
    # Find or create relationship to new spatial element
    existing_rel = None
    for rel in model.by_type("IfcRelContainedInSpatialStructure"):
        if rel.RelatingStructure == spatial_element:
            existing_rel = rel
            break
    
    if existing_rel:
        related = list(existing_rel.RelatedElements)
        if element not in related:
            related.append(element)
            existing_rel.RelatedElements = related
    else:
        model.create_entity(
            "IfcRelContainedInSpatialStructure",
            GlobalId=ifcopenshell.guid.new(),
            RelatingStructure=spatial_element,
            RelatedElements=[element]
        )
