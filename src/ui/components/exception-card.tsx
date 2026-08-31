'use client';

import * as React from 'react';
import {
  isExceptionOpen,
  type ExceptionSeverity,
  type NormalizedException,
  type ResolutionOption,
} from '../../core/exceptions';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type ExceptionCardSlot =
  | 'root' | 'header' | 'badge' | 'title' | 'status' | 'description'
  | 'meta' | 'actions' | 'action' | 'reason' | 'reasonInput' | 'error';

export interface ExceptionCardProps extends StyleableProps<ExceptionCardSlot> {
  exception: NormalizedException;
  /**
   * Invoked when an operator picks a resolution. Reason text is passed through
   * for resolutions that require one; the card will not submit without it.
   */
  onResolve?: (resolution: ResolutionOption, reason?: string) => void | Promise<void>;
  /** Show a pending state on this card. */
  busy?: boolean;
  /** Hide the resolution buttons — for a read-only or summary view. */
  readOnly?: boolean;
  /** Extra content below the description: a product picker, an image, a note field. */
  children?: React.ReactNode;
}

const SEVERITY_STYLES: Record<ExceptionSeverity, { border: string; badge: string; dot: string }> = {
  blocking: {
    border: 'border-arvist-blocking/40 bg-arvist-blocking-surface',
    badge: 'bg-arvist-blocking/10 text-arvist-blocking',
    dot: 'bg-arvist-blocking',
  },
  warning: {
    border: 'border-arvist-warning/40 bg-arvist-warning-surface',
    badge: 'bg-arvist-warning/10 text-arvist-warning',
    dot: 'bg-arvist-warning',
  },
  info: {
    border: 'border-arvist-border bg-arvist-surface-muted',
    badge: 'bg-arvist-info/10 text-arvist-info',
    dot: 'bg-arvist-info',
  },
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  unresolved: 'Escalated',
  resolved: 'Resolved',
  canceled: 'Removed',
  false_positive: 'Not an issue',
};

/**
 * One exception, with its resolution paths.
 *
 * The card renders whatever the exception carries rather than switching on the
 * type itself — resolution options, whether a reason is required, and whether
 * the operator has to do something physical all come from
 * {@link NormalizedException}. Adding a type upstream does not require touching
 * this component.
 */
export function ExceptionCard({
  exception,
  onResolve,
  busy = false,
  readOnly = false,
  children,
  className,
  classNames,
  unstyled,
}: ExceptionCardProps) {
  const slot = createSlots<ExceptionCardSlot>({ classNames, unstyled });
  const severity = SEVERITY_STYLES[exception.severity];
  const open = isExceptionOpen(exception);

  const [pending, setPending] = React.useState<ResolutionOption | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (resolution: ResolutionOption) => {
    setError(null);
    if (resolution.requiresReason && !reason.trim()) {
      // Reveal the field rather than failing silently — the operator has not
      // been asked for a reason yet at this point.
      setPending(resolution);
      return;
    }
    try {
      await onResolve?.(resolution, resolution.requiresReason ? reason.trim() : undefined);
      setPending(null);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve.');
    }
  };

  return (
    <article
      data-exception-type={exception.type}
      data-severity={exception.severity}
      data-status={exception.status}
      className={cn(
        slot(
          'root',
          'arvist-root rounded-[--radius-arvist] border p-4 text-arvist-text',
          severity.border,
          !open && 'opacity-70',
        ),
        className,
      )}
    >
      <header className={slot('header', 'flex items-start justify-between gap-3')}>
        <div className={slot('badge', 'flex items-center gap-2 min-w-0')}>
          <span
            aria-hidden
            className={slot('badge', 'size-2 shrink-0 rounded-full', severity.dot)}
          />
          <h3 className={slot('title', 'truncate font-semibold')}>{exception.title}</h3>
          {exception.palletOnly ? (
            <span className={slot('meta', 'shrink-0 text-xs text-arvist-text-muted')}>pallet</span>
          ) : null}
        </div>
        <span
          className={slot(
            'status',
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            severity.badge,
          )}
        >
          {STATUS_LABELS[exception.status] ?? exception.status}
        </span>
      </header>

      {exception.description ? (
        <p className={slot('description', 'mt-2 text-sm text-arvist-text-muted')}>
          {exception.description}
        </p>
      ) : null}

      {exception.blocksCompletion ? (
        <p className={slot('meta', 'mt-2 text-xs font-medium text-arvist-blocking')}>
          Blocks completion until resolved.
        </p>
      ) : null}

      {children}

      {pending?.requiresReason ? (
        <div className={slot('reason', 'mt-3')}>
          <label className={slot('meta', 'block text-xs font-medium text-arvist-text-muted')}>
            Why can this not be resolved?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              autoFocus
              className={slot(
                'reasonInput',
                'mt-1 w-full rounded-[--radius-arvist] border border-arvist-border',
                'bg-arvist-surface px-2 py-1.5 text-sm text-arvist-text',
                'focus:outline-none focus:ring-2 focus:ring-arvist-info/40',
              )}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={slot('error', 'mt-2 text-xs text-arvist-blocking')}>
          {error}
        </p>
      ) : null}

      {!readOnly && open && exception.resolutions.length > 0 ? (
        <div className={slot('actions', 'mt-3 flex flex-wrap gap-2')}>
          {exception.resolutions.map((resolution) => (
            <button
              key={resolution.action}
              type="button"
              disabled={busy}
              onClick={() => void submit(resolution)}
              title={
                resolution.requiresPhysicalAction
                  ? 'Confirm only after the physical action is done'
                  : undefined
              }
              className={slot(
                'action',
                'rounded-[--radius-arvist] border border-arvist-border bg-arvist-surface',
                'px-3 py-1.5 text-sm font-medium text-arvist-text',
                'hover:bg-arvist-surface-muted disabled:cursor-not-allowed disabled:opacity-50',
                'focus:outline-none focus:ring-2 focus:ring-arvist-info/40',
              )}
            >
              {resolution.label}
              {resolution.requiresPhysicalAction ? (
                <span aria-hidden className="ml-1 text-arvist-text-muted">
                  ↗
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
