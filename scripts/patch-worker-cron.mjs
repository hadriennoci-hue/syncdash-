/**
 * Post-build patch: injects a `scheduled` event handler into .open-next/worker.js
 * so Cloudflare Cron Triggers actually run social publish / token refresh / health.
 *
 * The scheduled handler calls the worker's own fetch handler directly (no network hop),
 * bypassing Cloudflare Access entirely.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const WORKER_PATH = '.open-next/worker.js'

let content
try {
  content = readFileSync(WORKER_PATH, 'utf-8')
} catch {
  console.error(`patch-worker-cron: ${WORKER_PATH} not found — run the build first`)
  process.exit(1)
}

if (content.includes('__workerHandler')) {
  console.log('patch-worker-cron: already patched, skipping')
  process.exit(0)
}

if (!content.includes('export default {')) {
  console.error('patch-worker-cron: unexpected worker.js format — cannot patch')
  process.exit(1)
}

// Replace `export default {` with a named const so we can self-reference it
content = content.replace('export default {', 'const __workerHandler = {')

const scheduledHandler = `
    async scheduled(event, env, ctx) {
        const task =
            event.cron === '*/10 * * * *' ? 'social' :
            event.cron === '0 4 * * *' ? 'tokens' : 'health';
        const url = 'https://wizhard.store/api/cron?task=' + task;
        ctx.waitUntil(
            __workerHandler.fetch(new Request(url, { headers: { 'x-internal-cron': '1' } }), env, ctx)
                .then(r => r.text())
                .catch(err => console.error('[cron] scheduled handler error:', String(err)))
        );
    },`

// Insert scheduled method before the closing `};` of the default export object
const lastClose = content.lastIndexOf('\n};')
if (lastClose === -1) {
  console.error('patch-worker-cron: could not find closing }; in worker.js')
  process.exit(1)
}

content =
  content.slice(0, lastClose) +
  scheduledHandler +
  '\n};\nexport default __workerHandler;\n'

writeFileSync(WORKER_PATH, content, 'utf-8')
console.log('patch-worker-cron: scheduled handler injected successfully')
