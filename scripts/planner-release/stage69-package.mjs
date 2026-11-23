import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

const [parentDir, childDir, output] = process.argv.slice(2);
assert.ok(parentDir && childDir && output, 'usage: node package.mjs PARENT_DIST CHILD_DIST EMPTY_OUT');
const parent = 'https://staging.hosei-tsukyo-media.com';
const child = 'https://planner-staging.hosei-tsukyo-media.com';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literal = path => '^' + escape(path) + '$';
const content = { parent: 'stage69-parent-content', child: 'stage69-child-content' };
const common = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};
const withHost = (origin, src, dest, headers) => ({
  src,
  has: [{ type: 'host', value: literal(new URL(origin).hostname) }],
  methods: ['GET', 'HEAD'],
  caseSensitive: true,
  dest: '/' + dest,
  headers,
});
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};
const parentHtml = readFileSync(join(parentDir, 'index.html'), 'utf8');
assert.match(parentHtml, /googletagmanager\.com\/gtag\/js\?id=G-46M2R4RSX5/);
const inline = [...parentHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.equal(inline.length, 1);
assert.match(inline[0], /gtag\('config', 'G-46M2R4RSX5'\)/);
const inlineHash = createHash('sha256').update(inline[0]).digest('base64');
const parentPolicy = allowedFrames => [
  "default-src 'none'",
  `script-src 'self' 'sha256-${inlineHash}' https://www.googletagmanager.com/gtag/js https://platform.twitter.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://www.transparenttextures.com https://pbs.twimg.com",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com https://syndication.twitter.com https://platform.twitter.com",
  'frame-src ' + allowedFrames,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const childPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'none'",
  "frame-src 'none'",
  'frame-ancestors ' + parent,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const documentHeaders = policy => ({
  ...common, 'Content-Type': mime['.html'], 'Content-Security-Policy': policy,
});
const routes = [
  withHost(parent, '^/planner/?$', content.parent + '/index.html', documentHeaders(parentPolicy(child))),
  withHost(parent, '^/(?:|(?:qa|contact|message|privacy|member)/?)$', content.parent + '/index.html',
    documentHeaders(parentPolicy('https://platform.twitter.com https://syndication.twitter.com'))),
  withHost(child, '^/child$', content.child + '/planner.html', documentHeaders(childPolicy)),
];

mkdirSync(output, { mode: 0o700 });
for (const [role, directory, html, origin] of [
  ['parent', parentDir, 'index.html', parent],
  ['child', childDir, 'planner.html', child],
]) {
  const files = readdirSync(directory, { withFileTypes: true });
  const assets = readdirSync(join(directory, 'assets'), { withFileTypes: true });
  assert.ok(files.some(file => file.name === html && file.isFile()));
  assert.ok(assets.length > 0);
  for (const asset of assets) assert.ok(asset.isFile(), asset.name);
  const publicFiles = files.filter(file => file.name !== html && file.name !== 'assets');
  if (role === 'child') assert.deepEqual(publicFiles, []);
  for (const file of publicFiles) assert.ok(file.isFile(), file.name);
  const copy = name => {
    const dest = join(content[role], name);
    mkdirSync(dirname(join(output, dest)), { recursive: true });
    copyFileSync(join(directory, name), join(output, dest));
    return dest;
  };
  copy(html);
  for (const name of [...assets.map(file => 'assets/' + file.name), ...publicFiles.map(file => file.name)]) {
    assert.match(name, /^(?:assets\/)?[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/);
    const type = mime[extname(name)];
    assert.ok(type && extname(name) !== '.html', name);
    const dest = copy(name);
    const headers = { ...common, 'Content-Type': type, 'Cross-Origin-Resource-Policy': 'same-origin' };
    routes.push(withHost(origin, literal('/_stage69-' + role + '/' + name), dest, headers));
    if (!name.startsWith('assets/')) routes.push(withHost(origin, literal('/' + name), dest, headers));
  }
}
routes.push({ src: '^/.*$', status: 404, headers: {
  ...common, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
} });
writeFileSync(join(output, 'vercel.json'), JSON.stringify({ routes }, null, 2) + '\n');
console.log(JSON.stringify({ routeCount: routes.length, parentHtmlSha256: createHash('sha256').update(parentHtml).digest('hex') }));
