// Numeric policy reused from pinned G01a; lint-only edits preserve token semantics.
export class NumericPrecisionError extends Error {}
function fail(_code: 'numeric_precision'): never { void _code; throw new NumericPrecisionError(); }
function decimalSignature(token: string): string {
  const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
  const sign = mantissa.startsWith('-') ? '-' : '';
  const unsigned = sign ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ''] = unsigned.split('.');
  let digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const tail = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - tail);
  const power = Number(exponent) - fraction.length + tail;
  if (!Number.isSafeInteger(power)) fail('numeric_precision');
  return `${sign}${digits}@${power}`;
}
function checkDecimalRoundTrips(raw: string): void {
  // JSON structure and token syntax have already passed the pinned parser.
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      i++;
      while (i < raw.length) {
        if (raw[i] === '\\') { i += 2; continue; }
        if (raw[i++] === '"') break;
      }
    } else if (raw[i] === '-' || (raw[i] >= '0' && raw[i] <= '9')) {
      const start = i++;
      while (i < raw.length && /[0-9eE+.-]/.test(raw[i])) i++;
      const token = raw.slice(start, i);
      if (decimalSignature(token) !== decimalSignature(String(Number(token)))) fail('numeric_precision');
    } else i++;
  }
}

export { checkDecimalRoundTrips };
