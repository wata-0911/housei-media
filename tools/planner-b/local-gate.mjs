import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { pins, readPinnedAssets } from './materialize.mjs';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const navigationRoutes = new Set(['/', '/planner', '/planner/']);

function loadAssets(input, expected) {
  return new Map([...readPinnedAssets(input, expected)].map(([name, data]) => {
    const type = contentTypes[extname(name)];
    assert(type, 'unsupported protected asset');
    return ['/' + name, { data, type }];
  }));
}

export async function startLocalGate({ dist, port = 4178, enabled = false, password, variant = 'b70-split' } = {}) {
  assert(Number.isInteger(port) && port >= 0 && port <= 65535, 'invalid port');
  const expected = variant === 'b70-split' ? pins.assets
    : variant === 'b78-split' ? pins.b78Builds.split
    : variant === 'b78-cold' ? pins.b78Builds.cold
    : variant === 'b-native-split' ? pins.bNativeBuilds.split
    : variant === 'b-native-cold' ? pins.bNativeBuilds.cold : null;
  assert(expected, 'unknown protected distribution variant');
  assert(!enabled || typeof password === 'string' && password.length >= 24 && !/[\r\n]/.test(password),
    'explicit local validation credentials required');
  const token = enabled ? Buffer.from('Basic ' + Buffer.from('b72:' + password).toString('base64')) : null;
  const assets = enabled ? loadAssets(dist, expected) : null;

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'");
    const deny = (status) => {
      response.statusCode = status;
      response.setHeader('Content-Length', '0');
      response.end();
    };
    if (request.headers.host !== '127.0.0.1:' + server.address().port) return deny(421);
    if (!enabled) return deny(403);
    const presented = Buffer.from(request.headers.authorization ?? '');
    if (presented.length !== token.length || !timingSafeEqual(presented, token)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="B72 local validation"');
      return deny(401);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return deny(405);
    }
    const path = request.url.split('?', 1)[0];
    const entry = assets.get(navigationRoutes.has(path) ? '/index.html' : path);
    if (!entry) return deny(404);
    response.setHeader('Content-Type', entry.type);
    response.setHeader('Content-Length', entry.data.length);
    response.end(request.method === 'HEAD' ? undefined : entry.data);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
