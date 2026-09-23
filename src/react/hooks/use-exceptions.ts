'use client';

import * as React from 'react';
import { ArvistError } from '../../core/errors';
import {
  deriveExceptions,
  isExceptionOpen,
  ISSUE_ACTION_BY_RESOLUTION,
  type ExceptionType,
  type NormalizedException,
  type ResolutionAction,
  type ResolutionOption,
} from '../../core/exceptions';
import type { IssueStatus, ResolveIssueByIdInput, Shipment } from '../../core/types';
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
  /** For `correct_count` on a `shortage`: the corrected quantity. */
  quantity?: number;
  /**
   * The product sku to apply. Required for `identify_product` and
   * `correct_product`; optional for `accept_substitute`/`remove_item` when the
   * operator entered one worth recording for audit.
   */
  sku?: string;
  /** For `reassign_product` (`overage`): the sku the extra units actually belong to. */
  targetSku?: string;
  /**
   * For `reassign_product` (`overage`) only: which detected instance on the
   * line item is being reassigned. `overage` issues are session-less and can
   * have several candidate detections, so — unlike every other per-instance
   * action — this can't be inferred from the issue row and the caller must
   * supply it (e.g. from an image-overlay picker).
   */
  annotationId?: number;
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
  options: { onResolved?: () => void | Promise<void> } = {},
): UseExceptionsResult {
  const { client, copy, autoCompleted } = useArvist();
  const [resolving, setResolving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<ArvistError | undefined>();

  const onResolvedRef = React.useRef(options.onResolved);
  onResolvedRef.current = options.onResolved;

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
        await applyResolution(client, shipment, args);
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
 * `unidentified_product`/`wrong_product`/`overage`/`shortage` resolve through
 * the keyword `action` endpoint ({@link ArvistClient.resolveIssueById}) via
 * {@link ISSUE_ACTION_BY_RESOLUTION}; `damage`/`wrong_load`/
 * `missing_identifiers` still resolve through the older per-session status
 * write. `submit_identifiers` and `cancel_unit` are side-effecting calls that
 * run first, so a failed one never leaves an exception marked resolved with
 * the underlying data unchanged.
 */
async function applyResolution(
  client: ReturnType<typeof useArvist>['client'],
  shipment: Shipment,
  args: ResolveArgs,
): Promise<void> {
  const { exception, resolution, reason, metadata, identifier, quantity, sku, targetSku, annotationId } = args;
  const action: ResolutionAction = resolution.action;

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
    return;
  }

  if (action === 'cancel_unit') {
    if (!exception.unitId) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'This exception is not attached to a unit.',
      });
    }
    await client.cancelUnit(shipment.id, exception.unitId);
    return;
  }

  const backendAction = ISSUE_ACTION_BY_RESOLUTION[exception.type]?.[action];
  if (backendAction) {
    if (!exception.issue) {
      throw new ArvistError({
        code: 'validation_failed',
        message: 'This exception has no issue row to resolve.',
      });
    }
    await client.resolveIssueById(
      buildIssueResolveInput(exception.issue.id, backendAction, exception.issue.metadata, {
        sku,
        targetSku,
        annotationId,
        quantity,
      }),
    );
    return;
  }

  // Everything left resolves through the older session-scoped status write:
  // `damage`/`wrong_load`/`missing_identifiers`, none of which are in
  // ISSUE_ACTION_BY_RESOLUTION above.
  if (exception.unitSessionId == null || !exception.issue) return;

  await client.resolveIssue({
    unit_session_id: exception.unitSessionId,
    issue_type: exception.issue.issue_type,
    status: (resolution.status ?? 'resolved') as IssueStatus,
    reason,
    metadata: { ...metadata, resolution_action: action },
  });
}

/**
 * Builds the body for {@link ArvistClient.resolveIssueById}, filling in
 * `annotation_id` from the issue's own metadata where the API can pin it
 * (`unidentified_product`/`wrong_product`) and validating whatever fields the
 * chosen action needs but the issue doesn't already know.
 */
function buildIssueResolveInput(
  issueId: number,
  backendAction: string,
  issueMetadata: Record<string, unknown> | undefined,
  input: { sku?: string; targetSku?: string; annotationId?: number; quantity?: number },
): ResolveIssueByIdInput {
  const pinnedAnnotationId = issueMetadata?.['annotation_id'] as number | undefined;

  const must = <T,>(value: T | undefined, message: string): T => {
    if (value == null) throw new ArvistError({ code: 'validation_failed', message });
    return value;
  };

  switch (backendAction) {
    case 'assign':
      return {
        issue_id: issueId,
        action: 'assign',
        annotation_id: must(pinnedAnnotationId, 'This issue has no annotation to resolve against.'),
        sku: must(input.sku?.trim(), 'Pick the product this item should be before confirming.'),
      };
    case 'invalid':
      return {
        issue_id: issueId,
        action: 'invalid',
        annotation_id: must(pinnedAnnotationId, 'This issue has no annotation to resolve against.'),
      };
    case 'keep_in_order':
      return {
        issue_id: issueId,
        action: 'keep_in_order',
        annotation_id: must(pinnedAnnotationId, 'This issue has no annotation to resolve against.'),
        ...(input.sku?.trim() ? { sku: input.sku.trim() } : {}),
      };
    case 'correct_product':
      return {
        issue_id: issueId,
        action: 'correct_product',
        annotation_id: must(pinnedAnnotationId, 'This issue has no annotation to resolve against.'),
        sku: must(input.sku?.trim(), 'Pick the correct product before confirming.'),
      };
    case 'remove_product':
      return {
        issue_id: issueId,
        action: 'remove_product',
        annotation_id: must(pinnedAnnotationId, 'This issue has no annotation to resolve against.'),
        ...(input.sku?.trim() ? { sku: input.sku.trim() } : {}),
      };
    case 'remove_extra':
      return { issue_id: issueId, action: 'remove_extra' };
    case 'reassign':
      return {
        issue_id: issueId,
        action: 'reassign',
        annotation_id: must(input.annotationId, 'Pick the detected item being reassigned before confirming.'),
        target_sku: must(input.targetSku?.trim(), 'Pick the product the extra units belong to before confirming.'),
      };
    case 'missing_added':
      return { issue_id: issueId, action: 'missing_added' };
    case 'wrong_counting':
      return {
        issue_id: issueId,
        action: 'wrong_counting',
        corrected_quantity: must(input.quantity, 'Enter the corrected quantity before confirming.'),
      };
    default:
      // ISSUE_ACTION_BY_RESOLUTION only ever produces the keywords above.
      throw new ArvistError({ code: 'unknown', message: `Unhandled issue action "${backendAction}".` });
  }
}
