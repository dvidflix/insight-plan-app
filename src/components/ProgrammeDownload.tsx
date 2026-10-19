import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconDownloadFile, IconChevronDown } from './icons';

export type DownloadFormat = 'xml' | 'xer';

/** A programme's download button: XML by default (the scenario programmes), with a
    small menu for XER. `canXml` false (a programme with no original XML to give,
    see downloadProgramme) makes XER the default. */
export function ProgrammeDownload({ canXml, disabled, onDownload }: { canXml: boolean; disabled?: boolean; onDownload: (format: DownloadFormat) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const main: DownloadFormat = canXml ? 'xml' : 'xer';

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  return (
    <span className="dl-split">
      <button
        type="button"
        className="mini-btn mini-btn--icon dl-split__main"
        disabled={disabled}
        onClick={() => onDownload(main)}
        title={canXml ? 'Download as a P6 XML file (the arrow for XER)' : 'Download as a P6 XER file (XML is available for scenario programmes)'}
        aria-label={`Download programme as ${main.toUpperCase()}`}
      >
        <IconDownloadFile width={16} height={16} />
      </button>
      <button
        ref={caret}
        type="button"
        className="mini-btn dl-split__caret"
        disabled={disabled}
        aria-label="Download format"
        title="Choose the format"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const r = caret.current!.getBoundingClientRect();
          setPos(pos ? null : { x: Math.max(8, r.right - 150), y: r.bottom + 4 });
        }}
      >
        <IconChevronDown width={14} height={14} />
      </button>
      {pos &&
        createPortal(
          <div className="folder-menu" style={{ left: pos.x, top: pos.y, width: 150 }} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" disabled={!canXml} title={canXml ? undefined : 'Only scenario programmes have an XML to give'} className={main === 'xml' ? 'on' : ''} onClick={() => { setPos(null); onDownload('xml'); }}>P6 XML (.xml)</button>
            <button type="button" className={main === 'xer' ? 'on' : ''} onClick={() => { setPos(null); onDownload('xer'); }}>P6 XER (.xer)</button>
          </div>,
          document.body,
        )}
    </span>
  );
}
