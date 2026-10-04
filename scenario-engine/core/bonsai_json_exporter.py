"""
Bonsai JSON Template Exporter
Generates JSON templates compatible with Bonsai's Spreadsheet Import/Export feature
"""
import json
from pathlib import Path
from typing import Set, Dict, List
import ifcopenshell


def collect_property_sets(ifc_file, property_sets_to_include=None):
    """
    Collect all unique property sets and their properties from the IFC file
    
    Args:
        ifc_file: IFC file object
        property_sets_to_include: List of property set names to include (None = all)
        
    Returns:
        Dict mapping property set names to sets of property names
    """
    all_properties = {}
    
    # Get all elements with property definitions
    for rel in ifc_file.by_type("IfcRelDefinesByProperties"):
        property_definition = rel.RelatingPropertyDefinition
        
        if property_definition and hasattr(property_definition, 'Name') and property_definition.Name:
            set_name = property_definition.Name
            
            # Filter by property sets if specified
            if property_sets_to_include is None or set_name in property_sets_to_include:
                # Initialize set for this property set if it doesn't exist
                if set_name not in all_properties:
                    all_properties[set_name] = set()
                
                # Collect all property names
                if hasattr(property_definition, 'HasProperties'):
                    for prop in property_definition.HasProperties:
                        if hasattr(prop, 'Name') and prop.Name:
                            all_properties[set_name].add(prop.Name)
    
    return all_properties


def create_bonsai_json(
    ifc_file,
    output_path,
    property_sets_to_include=None,
    ifc_query="IfcBuildingElementProxy, IfcSlab, IfcWall, IfcBeam, IfcColumn, IfcMember",
    include_base_attributes=True
):
    """
    Create a JSON file compatible with Bonsai's Spreadsheet Import/Export
    
    Args:
        ifc_file: IFC file object or path to IFC file
        output_path: Path where JSON file will be saved
        property_sets_to_include: List of property set names (None = all, e.g., ["BYLOR Pour", "Bylor"])
        ifc_query: IFC class query string for filtering elements
        include_base_attributes: Include basic IFC attributes (Name, GlobalId, etc.)
    """
    if isinstance(ifc_file, (str, Path)):
        ifc_file = ifcopenshell.open(str(ifc_file))
    
    # Collect property sets and properties
    all_properties = collect_property_sets(ifc_file, property_sets_to_include)
    
    # Build attributes list
    attributes_list = []
    
    # Add base attributes if requested
    if include_base_attributes:
        base_attrs = [
            {"name": "Name", "header": "Name", "sort": "NONE", "group": "NONE", "summary": "NONE", "formatting": "{{value}}"},
            {"name": "type", "header": "IFC Class", "sort": "NONE", "group": "NONE", "summary": "NONE", "formatting": "{{value}}"},
        ]
        attributes_list.extend(base_attrs)
    
    # Add property set attributes
    # Format: "PropertySetName"."PropertyName"
    for prop_set, prop_names in sorted(all_properties.items()):
        for prop_name in sorted(prop_names):
            attributes_list.append({
                "name": f'"{prop_set}"."{prop_name}"',
                "header": f'{prop_set}.{prop_name}',
                "sort": "NONE",
                "group": "NONE",
                "summary": "NONE",
                "formatting": "{{value}}"
            })
    
    # Create JSON structure
    json_data = {
        "query": ifc_query,
        "attributes": attributes_list,
        "settings": {
            "should_generate_svg": False,
            "should_preserve_existing": False,
            "include_global_id": True,
            "null_value": "N/A",
            "empty_value": "-",
            "true_value": "YES",
            "false_value": "NO",
            "concat_value": ", ",
            "csv_delimiter": ",",
            "format": "web",
            "csv_custom_delimiter": ""
        }
    }
    
    # Save JSON file
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as json_file:
        json.dump(json_data, json_file, indent=4, ensure_ascii=False)
    
    print(f"[Bonsai JSON] Exported template with {len(attributes_list)} attributes → {output_path.name}")
    
    return output_path


def merge_bonsai_json_templates(source_jsons: List[Path], master_json: Path):
    """
    Merge multiple Bonsai JSON templates into a master template
    Combines all unique attributes while preserving settings
    
    Args:
        source_jsons: List of Path objects to individual JSON files
        master_json: Path object for the master JSON output file
    """
    print(f"\n{'='*60}")
    print("MERGING BONSAI JSON TEMPLATES")
    print(f"{'='*60}")
    
    if not source_jsons:
        print("No JSON templates to merge")
        return
    
    # Collect all unique attributes
    all_attributes = {}
    all_queries = set()
    settings = None
    
    for json_path in source_jsons:
        if not json_path.exists():
            print(f"Warning: {json_path.name} not found, skipping...")
            continue
            
        print(f"Reading: {json_path.name}")
        
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Collect query
            if "query" in data:
                all_queries.add(data["query"])
            
            # Collect attributes (use name as key to avoid duplicates)
            if "attributes" in data:
                for attr in data["attributes"]:
                    name = attr.get("name", "")
                    if name and name not in all_attributes:
                        all_attributes[name] = attr
            
            # Use settings from first file
            if settings is None and "settings" in data:
                settings = data["settings"]
                
        except Exception as e:
            print(f"  Error reading {json_path.name}: {e}")
            continue
    
    if not all_attributes:
        print("No attributes found to merge")
        return
    
    # Merge queries (combine all unique IFC classes)
    merged_query = ", ".join(sorted(all_queries)) if all_queries else "IfcProduct"
    
    # Create master JSON
    master_data = {
        "query": merged_query,
        "attributes": list(all_attributes.values()),
        "settings": settings or {
            "should_generate_svg": False,
            "should_preserve_existing": False,
            "include_global_id": True,
            "null_value": "N/A",
            "empty_value": "-",
            "true_value": "YES",
            "false_value": "NO",
            "concat_value": ", ",
            "csv_delimiter": ",",
            "format": "web",
            "csv_custom_delimiter": ""
        }
    }
    
    # Save master JSON
    master_json.parent.mkdir(parents=True, exist_ok=True)
    with open(master_json, 'w', encoding='utf-8') as f:
        json.dump(master_data, f, indent=4, ensure_ascii=False)
    
    print(f"\n{'='*60}")
    print(f"MASTER BONSAI JSON CREATED: {master_json.name}")
    print(f"Total Attributes: {len(all_attributes)}")
    print(f"Total Files: {len(source_jsons)}")
    print(f"Query: {merged_query}")
    print(f"{'='*60}\n")


def export_bonsai_json_for_building(
    ifc_path: Path, 
    output_folder: Path,
    property_sets=None
):
    """
    Export Bonsai JSON template for a single building IFC file
    
    Args:
        ifc_path: Path to IFC file
        output_folder: Folder where JSON will be saved
        property_sets: List of property sets to include (None = all)
        
    Returns:
        Path to generated JSON file
    """
    if property_sets is None:
        property_sets = ["BYLOR Pour", "Bylor", "CWA_Planning"]
    
    output_json = output_folder / f"{ifc_path.stem}_Bonsai.json"
    
    try:
        model = ifcopenshell.open(str(ifc_path))
        create_bonsai_json(
            model,
            output_json,
            property_sets_to_include=property_sets,
            ifc_query="IfcBuildingElementProxy, IfcSlab, IfcWall, IfcBeam, IfcColumn, IfcMember, IfcFooting",
            include_base_attributes=True
        )
        return output_json
    except Exception as e:
        print(f"[Bonsai JSON] Error exporting {ifc_path.name}: {e}")
        return None
