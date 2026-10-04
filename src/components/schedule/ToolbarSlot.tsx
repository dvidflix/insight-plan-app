import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The spot in the Programmes toolbar where the open view's own tools go
    (in place of Layouts and the name/code search, which are for the
    activity views). */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);

/** Renders a view's tools in the Programmes toolbar; outside the page
    (no slot), in place as a row of their own. */
export function ToolbarSlot({ children }: { children: ReactNode }) {
  const slot = useContext(ToolbarSlotContext);
  if (slot) return createPortal(children, slot);
  return <div className="schedule-view-toolbar">{children}</div>;
}
