import type { ReactNode } from 'react';
import { Navigation, NavSlotHost } from './Navigation';
import { SectionTheme, type SectionId } from '../ui';

/**
 * A section's frame: its colour, its bar, and room underneath for the screen.
 *
 * Every section repeated this by hand and drifted apart doing it — different
 * paddings, one of them missing `min-h-0` so its content could not scroll.
 */
export function ScreenShell({
  section, onOtherBoard, isOrderMode = false, children,
}: {
  section: SectionId;
  onOtherBoard: () => void;
  isOrderMode?: boolean;
  children: ReactNode;
}) {
  return (
    <SectionTheme
      section={section}
      className="screen-h screen-w overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col"
    >
      {/* The host scopes the tab slot to this page. Two pages are briefly on
          screen together during a section change, and without it the incoming
          page's tabs could be portalled into the outgoing page's bar — which is
          why coming back to Analytics used to arrive with its tabs missing. */}
      <NavSlotHost>
        <Navigation section={section} onOtherBoard={onOtherBoard} isOrderMode={isOrderMode} />
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </NavSlotHost>
    </SectionTheme>
  );
}
