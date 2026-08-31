'use client';

import * as React from 'react';
import { createScanBuffer, parseScan, type ParsedScan } from '../../core/barcode';
import { buildBarcodeIndex } from '../../core/reconcile';
import type { LineItem } from '../../core/types';

export interface UseBarcodeScannerOptions {
  onScan: (scan: ParsedScan) => void;
  /** Attach the listener. Set `false` behind a modal that owns input. Defaults to `true`. */
  enabled?: boolean;
  /** Element to listen on. Defaults to `document`. */
  target?: React.RefObject<HTMLElement | null> | HTMLElement | null;
  /** Keep scanner output out of whatever has focus. Defaults to `true`. */
  preventDefault?: boolean;
  /**
   * Keep listening while a text input has focus. Off by default so operators
   * can type in search boxes without their keystrokes being read as scans.
   */
  captureInInputs?: boolean;
  maxKeystrokeGapMs?: number;
  minLength?: number;
}

/**
 * Reads handheld-scanner input from anywhere on the page.
 *
 * Scanners type their payload and press Enter, which is indistinguishable from
 * an operator at the keyboard until you look at the timing. This listens
 * globally, uses the inter-keystroke gap to tell the two apart, and hands you a
 * parsed scan with the check digit already validated.
 */
export function useBarcodeScanner(options: UseBarcodeScannerOptions): void {
  const {
    enabled = true,
    preventDefault = true,
    captureInInputs = false,
    maxKeystrokeGapMs,
    minLength,
    onScan,
    target,
  } = options;

  const onScanRef = React.useRef(onScan);
  onScanRef.current = onScan;

  React.useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const element =
      (target && 'current' in target ? target.current : target) ?? (document as unknown as HTMLElement);

    const buffer = createScanBuffer({
      maxKeystrokeGapMs,
      minLength,
      onScan: (code) => onScanRef.current(parseScan(code)),
    });

    const handler = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (!captureInInputs && isEditable(keyEvent.target)) return;
      const consumed = buffer.handleKey(keyEvent);
      if (consumed && preventDefault) keyEvent.preventDefault();
    };

    element.addEventListener('keydown', handler);
    return () => {
      element.removeEventListener('keydown', handler);
      buffer.reset();
    };
  }, [enabled, target, preventDefault, captureInInputs, maxKeystrokeGapMs, minLength]);
}

export interface UseScanMatchResult {
  /** Last scan received, matched or not. */
  lastScan: ParsedScan | undefined;
  /** Line item the last scan resolved to, if any. */
  matched: LineItem | undefined;
  /** `true` when the last scan matched nothing on the order. */
  unmatched: boolean;
  clear: () => void;
}

/**
 * Matches scans against a shipment's line items.
 *
 * Lookup goes through `additional_data.upc` first and falls back to the SKU,
 * because UPC population is not guaranteed — a shipment where only some lines
 * carry one still scans correctly for the rest. An unmatched scan is a signal
 * in its own right: it usually means an off-order item is in the tote.
 */
export function useScanMatch(
  lineItems: LineItem[] | undefined,
  options: Omit<UseBarcodeScannerOptions, 'onScan'> & {
    onMatch?: (item: LineItem, scan: ParsedScan) => void;
    onUnmatched?: (scan: ParsedScan) => void;
  } = {},
): UseScanMatchResult {
  const { onMatch, onUnmatched, ...scannerOptions } = options;
  const [lastScan, setLastScan] = React.useState<ParsedScan | undefined>();
  const [matched, setMatched] = React.useState<LineItem | undefined>();

  const index = React.useMemo(() => buildBarcodeIndex(lineItems), [lineItems]);

  const callbacks = React.useRef({ onMatch, onUnmatched });
  callbacks.current = { onMatch, onUnmatched };

  useBarcodeScanner({
    ...scannerOptions,
    onScan: (scan) => {
      setLastScan(scan);
      const hit = index.get(scan.value);
      setMatched(hit);
      if (hit) callbacks.current.onMatch?.(hit, scan);
      else callbacks.current.onUnmatched?.(scan);
    },
  });

  return {
    lastScan,
    matched,
    unmatched: lastScan !== undefined && matched === undefined,
    clear: React.useCallback(() => {
      setLastScan(undefined);
      setMatched(undefined);
    }, []),
  };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}
