/** Comparison-only normalisation.  Keep Roman numerals distinct from ASCII I/V. */
export function normalizeImportBaseName(name: string) {
  const protectedRomans: Array<[string, string]> = [['Ⅰ', '\uE000'], ['Ⅱ', '\uE001'], ['Ⅲ', '\uE002'], ['Ⅳ', '\uE003'], ['Ⅴ', '\uE004'], ['Ⅵ', '\uE005'], ['Ⅶ', '\uE006'], ['Ⅷ', '\uE007'], ['Ⅸ', '\uE008'], ['Ⅹ', '\uE009']];
  let value = name;
  for (const [roman, token] of protectedRomans) value = value.replaceAll(roman, token);
  value = value.normalize('NFKC').trim().replace(/[\s\u3000]+/g, '');
  // These are catalogue delivery labels, never a subject variant.  In
  // particular, bracketed theme and language-number labels are retained.
  let previous = '';
  while (previous !== value) {
    previous = value;
    value = value
      .replace(/(?:\((?:夏期|冬期|春期|秋期|前期週末|後期週末|ゴールデンウィーク)スクーリング[^)]*\)|\([^)]*市スクーリング\)|\((?:前期|後期)メディア\)|\[講義\]|(?:\[|【)オンライン(?:\]|】))$/u, '');
  }
  for (const [roman, token] of protectedRomans) value = value.replaceAll(token, roman);
  return value;
}
