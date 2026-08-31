'use client';

import * as React from 'react';
import { isExceptionOpen, type NormalizedException, type ResolutionOption } from '../../core/exceptions';
import { cn } from '../cn';
import { createSlots, type StyleableProps } from '../slots';
import { ExceptionCard, type ExceptionCardProps } from './exception-card';

export type ExceptionListSlot =
  | 'root' | 'summary' | 'summaryCount' | 'blockingCount' | 'list' | 'empty'
  | 'group' | 'groupLabel';

export interface ExceptionListProps extends StyleableProps<ExceptionListSlot> {
  exceptions: NormalizedException[];
  onResolve?: (
    exception: NormalizedException,
    resolution: ResolutionOption,
    reason?: string,
  ) => void | Promise<void>;
  /** Key of the exception currently being submitted. */
  resolvingKey?: string | null;
  /** Hide exceptions that are already closed. Defaults to `false`. */
  openOnly?: boolean;
  /** Shown when there is nothing to display. */
  emptyState?: React.ReactNode;
  /** Group blocking exceptions above the rest. Defaults to `true`. */
  groupBySeverity?: boolean;
  readOnly?: boolean;
  /** Render a card yourself — for a custom layout or an inline product picker. */
  renderException?: (props: ExceptionCardProps) => React.ReactNode;
}

/**
 * The warnings panel.
 *
 * Blocking exceptions come first because they are the ones stopping the
 * operator from closing out; everything else follows in the order the core
 * sorts it. Pass `renderException` when a type needs an inline control — a
 * product picker for an unidentified item, say — and keep the rest as-is.
 */
export function ExceptionList({
  exceptions,
  onResolve,
  resolvingKey,
  openOnly = false,
  emptyState,
  groupBySeverity = true,
  readOnly,
  renderException,
  className,
  classNames,
  unstyled,
}: ExceptionListProps) {
  const slot = createSlots<ExceptionListSlot>({ classNames, unstyled });

  const visible = React.useMemo(
    () => (openOnly ? exceptions.filter(isExceptionOpen) : exceptions),
    [exceptions, openOnly],
  );

  const blocking = visible.filter((e) => e.blocksCompletion);
  const rest = visible.filter((e) => !e.blocksCompletion);

  const card = (exception: NormalizedException) => {
    const props: ExceptionCardProps = {
      exception,
      busy: resolvingKey === exception.key,
      readOnly,
      onResolve: onResolve
        ? (resolution, reason) => onResolve(exception, resolution, reason)
        : undefined,
      unstyled,
    };
    return (
      <li key={exception.key}>
        {renderException ? renderException(props) : <ExceptionCard {...props} />}
      </li>
    );
  };

  if (visible.length === 0) {
    return (
      <div className={cn(slot('root', 'arvist-root'), className)}>
        <div className={slot('empty', 'arvist-exceptions__empty')}>
          {emptyState ?? 'No exceptions. This inspection is clean.'}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(slot('root', 'arvist-root arvist-exceptions'), className)}>
      <p className={slot('summary', 'arvist-exceptions__summary')}>
        <span className={slot('summaryCount', 'arvist-exceptions__count')}>{visible.length}</span>{' '}
        exception{visible.length === 1 ? '' : 's'}
        {blocking.length > 0 ? (
          <>
            {' · '}
            <span className={slot('blockingCount', 'arvist-exceptions__count--blocking')}>
              {blocking.length} blocking
            </span>
          </>
        ) : null}
      </p>

      {groupBySeverity && blocking.length > 0 ? (
        <>
          <section className={slot('group', 'arvist-exceptions__group')}>
            <h2
              className={slot(
                'groupLabel',
                'arvist-exceptions__group-label arvist-exceptions__group-label--blocking',
              )}
            >
              Must resolve
            </h2>
            <ul className={slot('list', 'arvist-exceptions__list')}>{blocking.map(card)}</ul>
          </section>
          {rest.length > 0 ? (
            <section className={slot('group', 'arvist-exceptions__group')}>
              <h2 className={slot('groupLabel', 'arvist-exceptions__group-label')}>Also flagged</h2>
              <ul className={slot('list', 'arvist-exceptions__list')}>{rest.map(card)}</ul>
            </section>
          ) : null}
        </>
      ) : (
        <ul className={slot('list', 'arvist-exceptions__list')}>{visible.map(card)}</ul>
      )}
    </div>
  );
}
