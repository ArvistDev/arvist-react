import { describe, expect, it, vi } from 'vitest';
import { createScanBuffer, parseScan, validateGtinCheckDigit } from '../core/barcode';

const key = (k: string, timeStamp: number) => ({ key: k, timeStamp });

function type(buffer: ReturnType<typeof createScanBuffer>, text: string, gapMs: number, start = 1000) {
  let t = start;
  for (const ch of text) {
    buffer.handleKey(key(ch, t));
    t += gapMs;
  }
  buffer.handleKey(key('Enter', t));
}

describe('validateGtinCheckDigit', () => {
  it('accepts valid UPC-A and EAN-13 codes', () => {
    expect(validateGtinCheckDigit('036000291452')).toBe(true);
    expect(validateGtinCheckDigit('4006381333931')).toBe(true);
  });

  it('rejects a corrupted check digit', () => {
    expect(validateGtinCheckDigit('036000291453')).toBe(false);
  });

  it('rejects non-numeric and short input', () => {
    expect(validateGtinCheckDigit('ABC123')).toBe(false);
    expect(validateGtinCheckDigit('1234')).toBe(false);
  });
});

describe('parseScan', () => {
  it('classifies a UPC-A and validates its check digit', () => {
    const scan = parseScan('036000291452');
    expect(scan.kind).toBe('upc');
    expect(scan.checkDigitValid).toBe(true);
  });

  it('classifies an EAN-13', () => {
    expect(parseScan('4006381333931').kind).toBe('ean');
  });

  it('normalises leading zeros so lookups match', () => {
    expect(parseScan('0036000291452').value).toBe('36000291452');
  });

  it('treats alphanumeric payloads as code128 and upper-cases them', () => {
    const scan = parseScan(' tote-a19 ');
    expect(scan.kind).toBe('code128');
    expect(scan.value).toBe('TOTE-A19');
    expect(scan.checkDigitValid).toBeUndefined();
  });
});

describe('createScanBuffer', () => {
  it('emits a scan for a fast keystroke burst ending in Enter', () => {
    const onScan = vi.fn();
    type(createScanBuffer({ onScan }), '036000291452', 10);
    expect(onScan).toHaveBeenCalledWith('036000291452');
  });

  it('ignores human-speed typing', () => {
    const onScan = vi.fn();
    // 200ms between keystrokes: each one restarts the burst, so at most one
    // character is ever buffered.
    type(createScanBuffer({ onScan }), 'hello world', 200);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores a payload under the minimum length', () => {
    const onScan = vi.fn();
    type(createScanBuffer({ onScan, minLength: 6 }), 'ab', 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('resets on a non-printable key so navigation never becomes a scan', () => {
    const onScan = vi.fn();
    const buffer = createScanBuffer({ onScan });
    let t = 1000;
    for (const ch of '0360') {
      buffer.handleKey(key(ch, t));
      t += 10;
    }
    buffer.handleKey(key('Tab', (t += 10)));
    for (const ch of '00291452') {
      buffer.handleKey(key(ch, (t += 10)));
    }
    buffer.handleKey(key('Enter', t + 10));
    expect(onScan).toHaveBeenCalledWith('00291452');
  });

  it('reports whether a keystroke was consumed, so callers can suppress it', () => {
    const buffer = createScanBuffer({ onScan: () => {} });
    expect(buffer.handleKey(key('0', 1000))).toBe(false); // first char is ambiguous
    expect(buffer.handleKey(key('3', 1010))).toBe(true); // burst established
  });

  it('supports a custom terminator', () => {
    const onScan = vi.fn();
    const buffer = createScanBuffer({ onScan, terminator: 'Tab' });
    let t = 1000;
    for (const ch of 'ABCDEF') buffer.handleKey(key(ch, (t += 10)));
    buffer.handleKey(key('Tab', t + 10));
    expect(onScan).toHaveBeenCalledWith('ABCDEF');
  });
});
