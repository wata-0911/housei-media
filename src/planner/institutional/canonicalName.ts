/** Comparison-only equivalent of YI-01 verify.py norm(). This never rewrites
 * names, removes delivery/theme labels, or establishes historical aliases. */
export function normalizeInstitutionalCanonicalName(name: string): string {
  let value = name;
  for (const [index, roman] of [...'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'].entries()) {
    value = value.replaceAll(roman, String.fromCodePoint(0xe000 + index));
  }
  // Python Unicode \s: White_Space plus U+001C..001F (not JS-only U+FEFF).
  value = value.normalize('NFKC').replace(/\p{White_Space}/gu, '');
  for (const codePoint of [0x1c, 0x1d, 0x1e, 0x1f]) value = value.replaceAll(String.fromCodePoint(codePoint), '');
  return value;
}
