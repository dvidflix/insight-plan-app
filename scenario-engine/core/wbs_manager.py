# core/wbs_manager.py
class WBSManager:
    def __init__(self, prefix, start_counter=1):
        self.prefix = prefix
        self.counter = int(start_counter)
        self.map = {}           # name -> ObjectId
        self.parent_map = {}    # name -> parent_name
        self.order = []
        # A node's name in the programme when its key is not its name (core/wbs_rules.py: two nodes of one name under different parents).
        self.labels = {}

    def register(self, name, parent_name=None):
        if name not in self.map:
            self.counter += 1
            self.map[name] = self.counter
            if parent_name:
                self.parent_map[name] = parent_name
            self.order.append(name)
        return self.map[name]

    reordered = False

    def reorder(self, order):
        """Puts the WBS in the order the user set (order: {parent path: [child paths]}, '' = the top
        level; paths are the names joined by " / "). Siblings follow it, the ones it doesn't list keep
        their place after the listed ones. Returns True when anything moved; ObjectIds don't change."""
        if not order:
            return False
        kids, roots = {}, []
        for name in self.order:
            parent = self.parent_map.get(name)
            (kids.setdefault(parent, []) if parent else roots).append(name)

        def last(path):
            return str(path).split(" / ")[-1]

        ranks = {(last(parent) if parent else ""): {last(c): i for i, c in enumerate(children)} for parent, children in order.items()}

        def sort(names, key):
            rank = ranks.get(self.label(key)) if key else ranks.get(key)
            return sorted(names, key=lambda n: rank.get(self.label(n), len(rank))) if rank else names

        new = []

        def walk(names, key):
            for n in sort(names, key):
                new.append(n)
                walk(kids.get(n, []), n)

        walk(roots, "")
        placed = set(new)
        new += [n for n in self.order if n not in placed]
        moved = new != self.order
        self.order = new
        self.reordered = self.reordered or moved
        return moved

    def label(self, name):
        """The node's name in the programme."""
        return self.labels.get(name, name)

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