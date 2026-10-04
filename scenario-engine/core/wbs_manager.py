# core/wbs_manager.py
class WBSManager:
    def __init__(self, prefix, start_counter=1):
        self.prefix = prefix
        self.counter = int(start_counter)
        self.map = {}           # name -> ObjectId
        self.parent_map = {}    # name -> parent_name
        self.order = []

    def register(self, name, parent_name=None):
        if name not in self.map:
            self.counter += 1
            self.map[name] = self.counter
            if parent_name:
                self.parent_map[name] = parent_name
            self.order.append(name)
        return self.map[name]

    def get_id(self, name):
        return self.map.get(name)

    def get_parent_id(self, name):
        parent_name = self.parent_map.get(name)
        return self.map.get(parent_name) if parent_name else None

    # ====================== NEW / FIXED HELPERS ======================

    def get_name_by_oid(self, oid):
        """Return WBS name from ObjectId."""
        oid = str(oid)
        for name, obj_id in self.map.items():
            if str(obj_id) == oid:
                return name
        return None

    def get_parent_id_by_oid(self, oid):
        """Return parent ObjectId from child ObjectId."""
        oid = str(oid)
        name = self.get_name_by_oid(oid)
        if not name:
            return None
        return self.get_parent_id(name)

    def get_pour_group_parent_oid(self, oid):
        """Climb up to the correct group level (e.g. External Walls, Slabs, etc.)."""
        current_oid = str(oid)
        
        for _ in range(4):  # max 4 levels up
            parent_oid = self.get_parent_id_by_oid(current_oid)
            if not parent_oid or parent_oid == current_oid:
                break

            parent_name = self.get_name_by_oid(parent_oid)
            if parent_name and any(kw in parent_name.upper() for kw in 
                ["WALLS", "SLABS", "SLAB", "EXTERNAL", "INTERNAL", "LEVEL", "ZONE"]):
                return parent_oid

            current_oid = parent_oid

        # Fallback: one level up
        return self.get_parent_id_by_oid(oid) or oid