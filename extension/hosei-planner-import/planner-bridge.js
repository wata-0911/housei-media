(() => {
  const REQUEST = 'hosei-grade-handoff-request'; const RESPONSE = 'hosei-grade-handoff-response';
  const tokenOk = token => typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || !data || data.type !== REQUEST || !tokenOk(data.token)) return;
    chrome.runtime.sendMessage({ type: 'hosei-grade-handoff-read', token: data.token }, result => {
      const safe = result?.ok === true ? { ok: true, token: data.token, importData: result.importData } : { ok: false, token: data.token, reason: typeof result?.reason === 'string' ? result.reason : 'unavailable' };
      window.postMessage({ type: RESPONSE, ...safe }, window.location.origin);
    });
  });
})();
