import type { ReactNode } from 'react';
import { ExpandCollapseToggle } from './ExpandCollapseToggle';

/** A list's search box with the collapse / expand-all button after it (the same
    pair as Columns). `children` is the search input. */
export function SearchRow({ children, collapsed, onCollapse, onExpand }: { children: ReactNode; collapsed: boolean; onCollapse: () => void; onExpand: () => void }) {
  return (
    <div className="cols__searchrow">
      {children}
      <ExpandCollapseToggle className="btn btn--small" collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand} />
    </div>
  );
}
