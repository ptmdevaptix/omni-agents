'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Right-docked slide-over panel. Slides in via a transform and, paired with a
 * `lg:pr-[…]` reserve on the page content, produces a split view rather than a
 * dimming overlay — the list stays visible/usable beside it. The panel closes
 * only when its own controls call `onClose` (no backdrop). Keep it mounted while
 * `open` toggles so both the in and out transitions animate; render the inner
 * content conditionally (keyed by subject) so it seeds fresh each time.
 */
export function SlideOver({
  open,
  width = 'lg:w-[36rem]',
  className,
  children,
}: {
  open: boolean;
  width?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'fixed right-0 top-0 z-40 flex h-dvh w-full flex-col border-l bg-background shadow-xl transition-transform duration-200',
        width,
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        className,
      )}
    >
      {children}
    </aside>
  );
}
