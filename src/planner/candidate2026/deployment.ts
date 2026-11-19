const legacyProductionOrigin = 'https://hosei-tsukyo-media.com';

function parseOrigin(value: unknown): URL {
  if (typeof value !== 'string') throw new Error('Missing configured origin');
  const url = new URL(value);
  if (url.origin !== value) throw new Error('Use a canonical origin without credentials, path or query');
  return url;
}

export function legacyPlannerLink(value: unknown, currentOrigin: string): URL {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid planner deployment configuration');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).sort().join(',') !== 'legacyOrigin,plannerOrigin,version' || config.version !== 1) {
    throw new Error('Unsupported planner deployment configuration');
  }
  const current = parseOrigin(currentOrigin);
  const planner = parseOrigin(config.plannerOrigin);
  const legacy = parseOrigin(config.legacyOrigin);
  if (planner.origin !== current.origin || legacy.origin === planner.origin) throw new Error('Require distinct configured origins');

  const loopback = [planner, legacy].every(url => url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port);
  const production = planner.protocol === 'https:' && legacy.origin === legacyProductionOrigin
    && planner.hostname !== legacy.hostname && !planner.hostname.endsWith('.' + legacy.hostname)
    && !legacy.hostname.endsWith('.' + planner.hostname);
  if (!loopback && !production) throw new Error('Unapproved origin configuration');

  return new URL('/planner', legacy);
}
