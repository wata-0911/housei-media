(() => {
  const target = globalThis.HoseiPlannerTarget;
  const TTL_MS = 5 * 60 * 1000;
  const keyFor = token => `grade-handoff:${token}`;
  const tokenOk = token => typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
  function plannerUrl(token) { if (!tokenOk(token)) throw new Error('Invalid handoff token.'); return `${target.origin}${target.plannerPath}#${target.fragmentKey}=${encodeURIComponent(token)}`; }
  async function store(storage, { token, importData, now = Date.now() }) { if (!tokenOk(token)) return { ok: false, reason: 'invalid_token' }; const entry = { token, createdAt: now, expiresAt: now + TTL_MS, importData }; await storage.set({ [keyFor(token)]: entry }); return { ok: true, entry }; }
  async function read(storage, { token, senderUrl, now = Date.now() }) {
    if (!tokenOk(token)) return { ok: false, reason: 'invalid_token' };
    let url; try { url = new URL(senderUrl); } catch { return { ok: false, reason: 'unauthorized_origin' }; }
    if (url.origin !== target.origin || url.pathname !== target.plannerPath) return { ok: false, reason: 'unauthorized_origin' };
    const key = keyFor(token); const entry = (await storage.get(key))[key];
    if (!entry || entry.token !== token) return { ok: false, reason: 'not_found' };
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) { await storage.remove(key); return { ok: false, reason: 'expired' }; }
    await storage.remove(key);
    return { ok: true, importData: entry.importData };
  }
  globalThis.HoseiPlannerHandoffStore = Object.freeze({ TTL_MS, keyFor, tokenOk, plannerUrl, store, read });
})();
