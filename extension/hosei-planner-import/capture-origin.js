(() => {
  /** Fail closed before injecting either extractor script into the active tab. */
  function isAllowed(value) {
    if (typeof value !== 'string') return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:'
      && (url.hostname === 'hosei.ac.jp' || url.hostname.endsWith('.hosei.ac.jp'));
  }
  globalThis.HoseiPlannerCaptureOrigin = Object.freeze({ isAllowed });
})();
