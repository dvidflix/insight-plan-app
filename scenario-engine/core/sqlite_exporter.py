"""
SQLite database export functionality for CWA Planning data
"""
import sqlite3
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime


def create_database(db_path: Path) -> None:
    """Create SQLite database with required tables"""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    # Main records table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS pour_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            building TEXT,
            level_code TEXT,
            level_display TEXT,
            level_int INTEGER,
            pour_id TEXT,
            alt_pour_id TEXT,
            full_pour_id TEXT,
            pour_type TEXT,
            volume REAL,
            is_external INTEGER,
            is_connected INTEGER,
            is_double_height INTEGER,
            cardinal_zone TEXT,
            building_zone TEXT,
            conc_stage TEXT,
            lg1 TEXT,
            lg2 TEXT,
            base_task_id TEXT,
            include TEXT,
            rebar_weight_tonnes REAL,
            max_elevation TEXT,
            min_elevation TEXT,
            concrete_wbs_name TEXT,
            concrete_wbs_oid TEXT,
            wbs_prefix TEXT,
            duration_key TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Activities table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT UNIQUE,
            task_name TEXT,
            phase TEXT,
            duration INTEGER,
            resource TEXT,
            wbs_name TEXT,
            wbs_oid TEXT,
            pour_id TEXT,
            alt_pour_id TEXT,
            building TEXT,
            level_code TEXT,
            is_external INTEGER,
            cardinal_zone TEXT,
            is_precast INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Relationships table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            predecessor TEXT,
            successor TEXT,
            lag_days INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Metadata table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS processing_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ifc_filename TEXT,
            processing_date TIMESTAMP,
            total_pours INTEGER,
            included_pours INTEGER,
            total_activities INTEGER
        )
    """)
    
    conn.commit()
    conn.close()


def insert_records(db_path: Path, records: List[Dict[str, Any]], ifc_filename: str) -> None:
    """Insert pour records into database"""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    for rec in records:
        cursor.execute("""
            INSERT INTO pour_records (
                building, level_code, level_display, level_int, pour_id, alt_pour_id, full_pour_id,
                pour_type, volume, is_external, is_connected, is_double_height,
                cardinal_zone, building_zone, conc_stage, lg1, lg2, base_task_id,
                include, rebar_weight_tonnes, max_elevation, min_elevation,
                concrete_wbs_name, concrete_wbs_oid, wbs_prefix, duration_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            rec.get("building"),
            rec.get("level_code"),
            rec.get("level_display"),
            rec.get("level_int"),
            rec.get("pour_id"),
            rec.get("alt_pour_id", rec.get("original_pour_id")),
            rec.get("full_pour_id"),
            rec.get("pour_type"),
            rec.get("volume"),
            1 if rec.get("is_external") else 0,
            1 if rec.get("is_connected") else 0,
            1 if rec.get("is_double_height") else 0,
            rec.get("cardinal_zone"),
            rec.get("building_zone"),
            rec.get("conc_stage"),
            rec.get("lg1"),
            rec.get("lg2"),
            rec.get("base_task_id"),
            rec.get("include"),
            rec.get("rebar_weight_tonnes"),
            rec.get("max_elevation"),
            rec.get("min_elevation"),
            rec.get("concrete_wbs_name"),
            rec.get("concrete_wbs_oid"),
            rec.get("wbs_prefix"),
            rec.get("duration_key")
        ))
    
    conn.commit()
    conn.close()


def insert_activities(db_path: Path, activities: List[Dict[str, Any]]) -> None:
    """Insert activities into database"""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    for act in activities:
        rec = act.get("rec", {})
        cursor.execute("""
            INSERT OR REPLACE INTO activities (
                task_id, task_name, phase, duration, resource, wbs_name, wbs_oid,
                pour_id, alt_pour_id, building, level_code, is_external, cardinal_zone, is_precast
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            act.get("task_id"),
            act.get("task_name"),
            act.get("phase"),
            act.get("duration"),
            act.get("resource"),
            act.get("wbs_name"),
            act.get("wbs_oid"),
            rec.get("pour_id"),
            rec.get("alt_pour_id", rec.get("original_pour_id")),
            rec.get("building"),
            rec.get("level_code"),
            1 if rec.get("is_external") else 0,
            rec.get("cardinal_zone"),
            1 if act.get("is_precast", False) else 0
        ))
    
    conn.commit()
    conn.close()


def insert_metadata(db_path: Path, ifc_filename: str, total_pours: int, included_pours: int, total_activities: int) -> None:
    """Insert processing metadata"""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO processing_metadata (
            ifc_filename, processing_date, total_pours, included_pours, total_activities
        ) VALUES (?, ?, ?, ?, ?)
    """, (ifc_filename, datetime.now(), total_pours, included_pours, total_activities))
    
    conn.commit()
    conn.close()


def merge_databases(source_dbs: List[Path], master_db: Path) -> None:
    """Merge multiple SQLite databases into a master database"""
    print(f"\n{'='*60}")
    print("MERGING DATABASES INTO MASTER")
    print(f"{'='*60}")
    
    # Create master database
    create_database(master_db)
    
    master_conn = sqlite3.connect(str(master_db))
    master_cursor = master_conn.cursor()
    
    total_records = 0
    total_activities = 0
    total_metadata = 0
    
    for db_path in source_dbs:
        if not db_path.exists():
            print(f"Warning: {db_path.name} not found, skipping...")
            continue
            
        print(f"Merging: {db_path.name}")
        
        # Attach source database
        master_cursor.execute(f"ATTACH DATABASE '{db_path}' AS source")
        
        # Copy pour_records
        master_cursor.execute("""
            INSERT INTO pour_records 
            SELECT NULL, building, level_code, level_display, level_int, pour_id, alt_pour_id,
                   full_pour_id, pour_type, volume, is_external, is_connected, 
                   is_double_height, cardinal_zone, building_zone, conc_stage, 
                   lg1, lg2, base_task_id, include, rebar_weight_tonnes, max_elevation, 
                   min_elevation, concrete_wbs_name, concrete_wbs_oid, wbs_prefix, 
                   duration_key, created_at
            FROM source.pour_records
        """)
        records_count = master_cursor.rowcount
        total_records += records_count
        
        # Copy activities
        master_cursor.execute("""
            INSERT OR IGNORE INTO activities 
            SELECT NULL, task_id, task_name, phase, duration, resource, wbs_name, 
                   wbs_oid, pour_id, alt_pour_id, building, level_code, is_external,
                   cardinal_zone, is_precast, created_at
            FROM source.activities
        """)
        activities_count = master_cursor.rowcount
        total_activities += activities_count
        
        # Copy metadata
        master_cursor.execute("""
            INSERT INTO processing_metadata 
            SELECT NULL, ifc_filename, processing_date, total_pours, 
                   included_pours, total_activities
            FROM source.processing_metadata
        """)
        metadata_count = master_cursor.rowcount
        total_metadata += metadata_count
        
        print(f"  → {records_count} records, {activities_count} activities")
        
        # Commit before detaching to release locks
        master_conn.commit()
        
        # Detach source database
        master_cursor.execute("DETACH DATABASE source")
    
    master_conn.commit()
    master_conn.close()
    
    print(f"\n{'='*60}")
    print(f"MASTER DATABASE CREATED: {master_db.name}")
    print(f"Total Records: {total_records}")
    print(f"Total Activities: {total_activities}")
    print(f"Total Files: {total_metadata}")
    print(f"{'='*60}\n")
