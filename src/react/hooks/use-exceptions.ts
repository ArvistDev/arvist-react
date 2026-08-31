'use client';

import * as React from 'react';
import { ArvistError } from '../../core/errors';
import {
  deriveExceptions,
  isExceptionOpen,
  type ExceptionType,
  type NormalizedException,
  type ResolutionAction,
  type ResolutionOption,
} from '../../core/exceptions';
import type { DetectionAnnotation, IssueStatus, LineItem, Shipment } from '../../core/types';
import { useArvist } from '../provider';

export interface ResolveArgs {
  exception: NormalizedException;
  /** One of the exception's own `resolutions`. */
  resolution: ResolutionOption;
  /** Required when `resolution.requiresReason`. */
  reason?: string;
  /** Extra context stored on the issue — operator id, scanned identifier, notes. */
  metadata?: Record<string, unknown>;
  /** For `submit_identifiers`: the pallet identifier that could not be read. */
  identifier?: string;
  /** For `correct_count`: the corrected quantity. */
  quantity?: number;
  /**
   * For `identify_product`: the detection annotation to reclassify, and what to
   * reclassify it as. Reclassification works on the annotation rather than the
   * line item, so this cannot be inferred from the exception alone.
   */
  annotation?: { image_id: number; annotation: DetectionAnnotation };
}

/**
 * Actions the SDK cannot complete on its own.
 *
 * Two resolutions need something only the host app has. A count correction is
 * not a live write — there is no endpoint for it; corrections are staged and
 * submitted with the inspection, so the app decides where they are held.
 * Identifying a product needs the detection annotation the operator picked,
 * which lives in the UI, not in the exception. Supplying these makes those
 * resolutions work; omitting one makes its action fail with a clear message
 * rather than silently doing nothing.
 */
export interface ExceptionHandlers {
  /** Stage a corrected count. Flush it via `submit({ line_items })`. */
  onCorrectCount?: (args: {
    exception: NormalizedException;
    lineItem: LineItem;
    quantity: number;
  }) => void | Promise<void>;
}

export interface UseExceptionsResult {
  /** Everything, open and closed, sorted blocking-first. */
  exceptions: NormalizedException[];
  open: NormalizedException[];
  blocking: NormalizedException[];
  byType: Record<ExceptionType, NormalizedException[]>;
  /** `true` while an unresolved exception holds completion open. */
  hasBlockers: boolean;
  resolving: string | null;
  error: ArvistError | undefined;
  /** Applies a resolution and routes it to the right endpoint. */
  resolve: (args: ResolveArgs) => Promise<void>;
}

const EMPTY_BY_TYPE: Record<ExceptionType, NormalizedException[]> = {
  unidentified_product: [], wrong_product: [], overage: [], shortage: [],
  manual_count_correction: [], wrong_load: [], missing_identifiers: [],
  unit_removed: [], damage: [],
};

/**
 * Normalised exceptions for a shipment, with resolution wired up.
 *
 * The nine operator-facing exception types do not map one-to-one onto API
 * endpoints — some are issue rows closed with a status, others are line-item
 * corrections, and one is a unit cancellation. {@link UseExceptionsResult.resolve}
 * picks the right call from the resolution you hand it, so the UI only has to
 * render the options the exception already carries.
 */
export function useExceptions(
  shipment: Shipment | undefined,
  options: { onResolved?: () => void | Promise<void> } & ExceptionHandlers = {},
): UseExceptionsResult {
  const { client, copy, autoCompleted } = useArvist();
  const [resolving, setResolving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ArvistError | undefined>();

  const onResolvedRef = React.useRef(options.onResolved);
  onResolvedRef.current = options.onResolved;
  const handlersRef = React.useRef<ExceptionHandlers>(options);
  handlersRef.current = options;

  const exceptions = React.useMemo(
    () => deriveExceptions(shipment, { copy, autoCompleted }),
    [shipment, copy, autoCompleted],
  );

  const open = React.useMemo(() => exceptions.filter(isExceptionOpen), [exceptions]);
  const blocking = React.useMemo(() => open.filter((e) => e.blocksCompletion), [open]);

  const byType = React.useMemo(() => {
    const grouped: Record<ExceptionType, NormalizedException[]> = {
      ...EMPTY_BY_TYPE,
      unidentified_product: [], wrong_product: [], overage: [], shortage: [],
      manual_count_correction: [], wrong_load: [], missing_identifiers: [],
      unit_removed: [], damage: [],
    };
    for (const e of exceptions) grouped[e.type].push(e);
    return grouped;
  }, [exceptions]);

  const resolve = React.useCallback(
    async (args: ResolveArgs) => {
      const { exception, resolution } = args;
      if (resolution.requiresReason && !args.reason?.trim()) {
        throw new ArvistError({
          code: 'validation_failed',
          message: 'A reason is required to record this as unresolved.',
        });
      }
      if (!shipment) {
        throw new ArvistError({ code: 'shipment_not_found', message: 'No inspection is open.' });
      }

      setResolving(exception.key);
      setError(undefined);
      try {
        await applyResolution(client, shipment, args, handlersRef.current);
        await onResolvedRef.current?.();
      } catch (err) {
        const normalized = ArvistError.is(err)
          ? err
          : new ArvistError({ code: 'unknown', message: 'Could not resolve.', cause: err });
        setError(normalized);
        throw normalized;
      } finally {
        setResolving(null);
      }
    },
    [client, shipment],
  );

  return {
    exceptions,
    open,
    blocking,
    byType,
    hasBlockers: blocking.length > 0,
    resolving,
    error,
    resolve,
  };
}

/**
 * Routes a resolution to the endpoint that implements it.
 *
 * Side-effecting actions run before the status write, so a failed correction
 * never leaves an exception marked resolved with the underlying data unchanged.
 */
async function applyResolution(
  client: ReturnType<typeof useArvist>['client'],
  shipment: Shipment,
  args: ResolveArgs,
  handlers: ExceptionHandlers,
): Promise<void> {
  const { exception, resolution, reason, metadata, identifier, quantity, annotation } = args;
  const action: ResolutionAction = resolution.action;

  if (action === 'identify_product') {
    if (!annotation) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'Pick the detected item and the product it should be before confirming.',
      });
    }
    await client.updateUnknownProduct({
      shipment_id: shipment.id,
      image_id: annotation.image_id,
      annotation: annotation.annotation,
    });
  }

  if (action === 'submit_identifiers') {
    if (!identifier?.trim()) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'Enter the pallet identifier before confirming.',
      });
    }
    await client.updatePalletIdentifier({
      shipment_id: shipment.id,
      shipment_unit_id: exception.unitId,
      identifier: identifier.trim(),
      metadata,
    });
  }

  if (action === 'correct_count') {
    if (quantity == null) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'Enter the corrected quantity before confirming.',
      });
    }
    if (!exception.lineItem?.id) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'This exception has no line item to correct.',
      });
    }
    if (!handlers.onCorrectCount) {
      throw new ArvistError({
        code: 'validation_failed',
        message:
          'Count corrections are submitted with the inspection, not written immediately. ' +
          'Pass `onCorrectCount` to useExceptions to stage them.',
      });
    }
    // Staged, not written: the API applies corrections as part of submit.
    await handlers.onCorrectCount({ exception, lineItem: exception.lineItem, quantity });
  }

  if (action === 'cancel_unit') {
    if (!exception.unitId) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'This exception is not attached to a unit.',
      });
    }
    await client.cancelUnit(shipment.id, exception.unitId);
  }

  // Exceptions derived from line items have no issue row to update — the
  // correction above is the whole resolution.
  if (exception.unitSessionId == null || !exception.issue) return;

  await client.resolveIssue({
    unit_session_id: exception.unitSessionId,
    issue_type: exception.issue.issue_type,
    status: (resolution.status ?? 'resolved') as IssueStatus,
    reason,
    metadata: { ...metadata, resolution_action: action },
  });
}
