/** Local-only transport. Each failure returns a fixed code, never an exception. */
export async function copyText(text) {
  let primaryCode;
  try {
    if (!navigator.clipboard?.writeText) primaryCode = 'GI_CLIPBOARD_PRIMARY_UNAVAILABLE';
    else {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: 'primary', codes: [] };
    }
  } catch { primaryCode = 'GI_CLIPBOARD_PRIMARY_FAILED'; }

  const codes = [primaryCode];
  let field;
  let previousFocus;
  let selection;
  const ranges = [];
  let copied = false;
  // Focus/selection snapshots are best-effort, not prerequisites for copying.
  try { previousFocus = document.activeElement; }
  catch { codes.push('GI_CLIPBOARD_FALLBACK_SNAPSHOT'); }
  try {
    selection = document.getSelection();
    if (selection) for (let index = 0; index < selection.rangeCount; index++) ranges.push(selection.getRangeAt(index).cloneRange());
  } catch { selection = null; codes.push('GI_CLIPBOARD_FALLBACK_SNAPSHOT'); }

  try {
    field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.setAttribute('aria-label', '成績JSONのコピー');
    field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
    document.body.append(field);
    field.focus();
    field.select();
    copied = document.execCommand('copy') === true;
    if (!copied) codes.push('GI_CLIPBOARD_FALLBACK_FAILED');
  } catch { codes.push('GI_CLIPBOARD_FALLBACK_FAILED'); }
  finally {
    // No cleanup exception may replace a successful copy with a generic error.
    if (field) {
      try { field.value = ''; } catch { codes.push('GI_CLIPBOARD_FALLBACK_CLEAR'); }
      try { field.remove(); }
      catch {
        codes.push('GI_CLIPBOARD_FALLBACK_REMOVE');
        try { field.parentNode?.removeChild(field); } catch { /* best effort */ }
      }
    }
    try { previousFocus?.focus({ preventScroll: true }); }
    catch { codes.push('GI_CLIPBOARD_FALLBACK_FOCUS'); }
    if (selection) {
      try {
        selection.removeAllRanges();
        ranges.forEach(range => selection.addRange(range));
      } catch { codes.push('GI_CLIPBOARD_FALLBACK_SELECTION'); }
    }
  }
  return { ok: copied, method: 'fallback', codes };
}
