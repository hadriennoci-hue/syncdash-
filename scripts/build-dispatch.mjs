import { execSync } from 'node:child_process'

const isOpenNextInternal = process.env.NEXT_PRIVATE_STANDALONE === 'true'

// OpenNext internally calls `npm run build`. In that nested invocation,
// run plain Next build to avoid recursive OpenNext -> npm run build loops.
const command = isOpenNextInternal
  ? 'next build'
  : 'opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion'

execSync(command, { stdio: 'inherit' })
