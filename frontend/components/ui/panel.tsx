'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The console's single container primitive (shadcn/ui Card, restyled for a
 * mission console: square corners, hairline rules, a dense title bar carrying a
 * subsystem label and an optional right-hand status slot).
 */

export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel',
        className,
      )}
      {...props}
    />
  ),
);
Panel.displayName = 'Panel';

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Small uppercase subsystem tag, e.g. "EPS", "TCS", "ADCS". */
  tag?: string;
  right?: React.ReactNode;
}

export function PanelHeader({ title, tag, right, className, ...props }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/60 px-2.5 py-1.5',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {tag && (
          <span className="shrink-0 font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
            {tag}
          </span>
        )}
        <h2 className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-ink-dim">
          {title}
        </h2>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 p-2.5', className)} {...props} />;
}