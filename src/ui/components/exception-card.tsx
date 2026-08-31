'use client';

import * as React from 'react';
import {
  isExceptionOpen,
  type NormalizedException,
  type ResolutionOption,
} from '../../core/exceptions';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';

export type ExceptionCardSlot =
  | 'root' | 'header' | 'badge' | 'dot' | 'title' | 'scope' | 'status' | 'description'
  | 'blocker' | 'actions' | 'action' | 'reason' | 'reasonLabel' | 'reasonInput' | 'error';

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
  const open = isExceptionOpen(exception);

  const [pending, setPending] = React.useState<ResolutionOption | null>(null);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (resolution: ResolutionOption) => {
    setError(null);
    if (resolution.requiresReason && !reason.trim()) {
      // Reveal the field rather than failing silently — at this point the
      // operator has not been asked for a reason yet.
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
          'arvist-root arvist-exception',
          `arvist-exception--${exception.severity}`,
          !open && 'arvist-exception--closed',
        ),
        className,
      )}
    >
      <header className={slot('header', 'arvist-exception__header')}>
        <div className={slot('badge', 'arvist-exception__badge')}>
          <span aria-hidden="true" className={slot('dot', 'arvist-dot')} />
          <h3 className={slot('title', 'arvist-exception__title')}>{exception.title}</h3>
          {exception.palletOnly ? (
            <span className={slot('scope', 'arvist-exception__scope')}>pallet</span>
          ) : null}
        </div>
        <span className={slot('status', 'arvist-pill arvist-exception__status')}>
          {STATUS_LABELS[exception.status] ?? exception.status}
        </span>
      </header>

      {exception.description ? (
        <p className={slot('description', 'arvist-exception__description')}>
          {exception.description}
        </p>
      ) : null}

      {exception.blocksCompletion ? (
        <p className={slot('blocker', 'arvist-exception__blocker')}>
          Blocks completion until resolved.
        </p>
      ) : null}

      {children}

      {pending?.requiresReason ? (
        <div className={slot('reason', 'arvist-exception__reason')}>
          <label className={slot('reasonLabel', 'arvist-exception__reason-label')}>
            Why can this not be resolved?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              autoFocus
              className={slot('reasonInput', 'arvist-exception__reason-input')}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={slot('error', 'arvist-exception__error')}>
          {error}
        </p>
      ) : null}

      {!readOnly && open && exception.resolutions.length > 0 ? (
        <div className={slot('actions', 'arvist-exception__actions')}>
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
              className={slot('action', 'arvist-btn')}
            >
              {resolution.label}
              {resolution.requiresPhysicalAction ? (
                <span aria-hidden="true" className="arvist-exception__physical-hint">
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
