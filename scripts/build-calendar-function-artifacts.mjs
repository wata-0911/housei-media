import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Use an official builder installed outside product dependencies. No project login,
// deployment, settings change, or real LINE/GAS credentials are needed.
const { build } = await import(process.env.CALENDAR_VERCEL_NODE_MODULE || '@vercel/node');
const { glob } = await import(process.env.CALENDAR_VERCEL_BUILD_UTILS_MODULE || '@vercel/build-utils');
const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
  throw new Error('Usage: node scripts/build-calendar-function-artifacts.mjs <source-root> <fresh-output-root>');
}
const workPath = resolve(sourceArgument);
const outputRoot = resolve(outputArgument);
// Refuse reused output so stale helper files cannot hide a tracing omission.
await mkdir(outputRoot);

for (const entrypoint of ['api/calendar-auth.ts', 'api/calendar-draft.ts']) {
  const files = await glob('**', {
    cwd: workPath,
    ignore: ['node_modules/**', '.git/**', '.vercel/**', 'dist/**'],
  });
  const { output } = await build({
    files,
    entrypoint,
    workPath,
    repoRootPath: workPath,
    config: {
      zeroConfig: true,
      nodeVersion: '22.x',
      functions: { [entrypoint]: { installCommand: '' } },
    },
    meta: { skipDownload: true },
  });
  const target = join(outputRoot, entrypoint.replace(/\.ts$/, '.func'));
  for (const [name, file] of Object.entries(output.files)) {
    const destination = join(target, name);
    await mkdir(join(destination, '..'), { recursive: true });
    // Some official builder versions expose legacy readable streams, which are
    // not async iterables. Consume their public stream interface unchanged.
    const chunks = [];
    await new Promise((resolveStream, rejectStream) => {
      const stream = file.toStream();
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', resolveStream);
      stream.on('error', rejectStream);
    });
    await writeFile(destination, Buffer.concat(chunks));
  }
  await writeFile(join(target, '.vc-config.json'), JSON.stringify({
    handler: output.handler,
    runtime: output.runtime,
    useWebApi: output.useWebApi,
  }, null, 2));
  console.log(JSON.stringify({
    entrypoint,
    handler: output.handler,
    runtime: output.runtime,
    files: Object.keys(output.files).sort(),
  }));
}
