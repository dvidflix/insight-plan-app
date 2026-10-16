import { ToolPopover } from './TablePopovers';
import { IconSidePanel } from './icons';

/** The toolbar's "Panels" button: the side panels of the page, each a checkbox in a small menu under it. */
export function PanelsButton({ panels, iconOnly = false }: { iconOnly?: boolean; panels: { id: string; label: string; hint?: string; on: boolean; onToggle: () => void }[] }) {
  const open = panels.filter((p) => p.on).length;
  return (
    <ToolPopover icon={<IconSidePanel width={16} height={16} />} label="Panels" active={open} activeLabel="Panels" iconOnly={iconOnly} width={240}>
      <div className="panels-menu">
        {panels.map((p) => (
          <label key={p.id} className="cols__check" title={p.hint}>
            <input type="checkbox" checked={p.on} onChange={p.onToggle} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>
    </ToolPopover>
  );
}
