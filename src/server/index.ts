import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';

const DEFAULT_PORT = 8787;
const HAS_FILE_EXTENSION = /\.[A-Za-z0-9]+$/;

const distDirectory = fileURLToPath(new URL('../../dist', import.meta.url));
const indexHtmlPath = fileURLToPath(new URL('../../dist/index.html', import.meta.url));

let serveBuildFiles: ReturnType<typeof serveStatic> | undefined;

// Production static handling. API routes are registered first, so /api/* requests never reach
// these handlers, and a missing dist folder only produces 404s.
app.use('/assets/*', (c, next) => {
  if (!existsSync(distDirectory)) {
    return next();
  }
  serveBuildFiles ??= serveStatic({ root: distDirectory });
  return serveBuildFiles(c, next);
});

app.get('*', (c, next) => {
  if (HAS_FILE_EXTENSION.test(c.req.path)) {
    // A build file requested by the browser (favicon, manifest, ...), not a SPA route.
    if (!existsSync(distDirectory)) {
      return next();
    }
    serveBuildFiles ??= serveStatic({ root: distDirectory });
    return serveBuildFiles(c, next);
  }
  return serveStatic({ path: indexHtmlPath })(c, next);
});

function resolvePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
}

const port = resolvePort(process.env.PORT);

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Grantlane API listening on http://localhost:${info.port}`);
});
