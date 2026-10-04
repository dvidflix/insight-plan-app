import { useState } from 'react';
import { IconCollapse, IconExpand } from './icons';

/** One button for "collapse all" / "expand all" of a grouped list, rather than
    two: it shows the action a click does (collapse when the groups are open,
    expand when they are closed). Pass `collapsed` when the list knows its
    state; without it the button keeps track of its own clicks. */
export function ExpandCollapseToggle({
  collapsed,
  onCollapse,
  onExpand,
  disabled,
  className = 'btn',
}: {
  collapsed?: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const isCollapsed = collapsed ?? own;
  const label = isCollapsed ? 'Expand all groups' : 'Collapse all groups';
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => {
        setOwn(!isCollapsed);
        if (isCollapsed) onExpand();
        else onCollapse();
      }}
      title={label}
      aria-label={label}
    >
      {isCollapsed ? <IconCollapse width={16} height={16} /> : <IconExpand width={16} height={16} />}
    </button>
  );
}
