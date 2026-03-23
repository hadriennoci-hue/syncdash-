import { execSync } from 'node:child_process'

const isOpenNextInternal = process.env.NEXT_PRIVATE_STANDALONE === 'true'

// OpenNext internally calls `npm run build`. In that nested invocation,
// run plain Next build to avoid recursive OpenNext -> npm run build loops.
const command = isOpenNextInternal
  ? 'next build'
  : 'opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion'

execSync(command, { stdio: 'inherit' })

// After a full OpenNext build, inject the Cloudflare scheduled event handler
// so Cron Triggers actually fire the social publish / token refresh / health tasks.
if (!isOpenNextInternal) {
  execSync('node ./scripts/patch-worker-cron.mjs', { stdio: 'inherit' })
}
