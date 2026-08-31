/**
 * Wedge-scanner input handling.
 *
 * Handheld scanners type their payload as fast keystrokes ending in Enter, and
 * a packstation screen has to tell that apart from an operator typing into a
 * field. The discriminator is inter-keystroke timing: scanner bursts land far
 * faster than any human types.
 */

export interface ScanBufferOptions {
  /**
   * Maximum gap between keystrokes for them to count as one scan. Handhelds
   * emit well under 30ms; humans rarely go under 50ms sustained. Defaults to 40.
   */
  maxKeystrokeGapMs?: number;
  /** Shortest accepted payload. Filters stray Enter presses. Defaults to 4. */
  minLength?: number;
  /** Key that terminates a scan. Defaults to `Enter`. */
  terminator?: string;
  /** Called with the completed payload. */
  onScan: (code: string) => void;
}

export interface ScanBuffer {
  /** Feed every `keydown`. Returns `true` when the event was consumed as scanner input. */
  handleKey(event: Pick<KeyboardEvent, 'key' | 'timeStamp'>): boolean;
  reset(): void;
}

/**
 * Accumulates keystrokes into scans.
 *
 * Returns `true` from `handleKey` when the keystroke belonged to a scan, so the
 * caller can `preventDefault()` and keep scanner output out of focused inputs.
 */
export function createScanBuffer(options: ScanBufferOptions): ScanBuffer {
  const gap = options.maxKeystrokeGapMs ?? 40;
  const minLength = options.minLength ?? 4;
  const terminator = options.terminator ?? 'Enter';

  let chars: string[] = [];
  let lastAt = 0;

  const reset = () => {
    chars = [];
    lastAt = 0;
  };

  return {
    reset,
    handleKey(event) {
      const now = event.timeStamp || performance.now();
      const elapsed = now - lastAt;

      if (event.key === terminator) {
        const code = chars.join('');
        reset();
        if (code.length >= minLength) {
          options.onScan(code);
          return true;
        }
        return false;
      }

      // Anything but a single printable character ends the burst.
      if (event.key.length !== 1) {
        reset();
        return false;
      }

      // A slow keystroke starts a fresh burst rather than extending the old one,
      // so a human typing never accumulates into a phantom scan.
      if (lastAt !== 0 && elapsed > gap) chars = [];

      chars.push(event.key);
      lastAt = now;
      return chars.length > 1;
    },
  };
}

export type ScanKind = 'upc' | 'ean' | 'code128' | 'unknown';

export interface ParsedScan {
  raw: string;
  /** Normalised for lookup — trimmed, upper-cased, leading zeros stripped. */
  value: string;
  kind: ScanKind;
  /** `true` when the check digit validates. `undefined` for formats without one. */
  checkDigitValid?: boolean;
}

/** Classifies a scan and validates its check digit where the format has one. */
export function parseScan(raw: string): ParsedScan {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const digitsOnly = /^\d+$/.test(trimmed);
  const value = digitsOnly ? trimmed.replace(/^0+(?=\d)/, '') : upper;

  if (digitsOnly && (trimmed.length === 12 || trimmed.length === 13 || trimmed.length === 8)) {
    return {
      raw,
      value,
      kind: trimmed.length === 12 ? 'upc' : 'ean',
      checkDigitValid: validateGtinCheckDigit(trimmed),
    };
  }
  return { raw, value, kind: digitsOnly ? 'unknown' : 'code128' };
}

/** Modulo-10 check digit shared by UPC-A, EAN-8 and EAN-13. */
export function validateGtinCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || code.length < 8) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  // Weights alternate 3/1 from the rightmost body digit leftwards.
  const sum = digits
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
