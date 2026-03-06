import { spawnSync } from 'node:child_process'
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const MIGRATION_SCRIPTS = [
  'db:migrate',
  'db:migrate2',
  'db:migrate4',
  'db:migrate5',
  'db:migrate6',
  'db:migrate7',
  'db:migrate8',
  'db:migrate9',
  'db:migrate10',
  'db:migrate11',
  'db:migrate12',
  'db:migrate13',
  'db:migrate14',
  'db:migrate15',
  'db:migrate16',
  'db:migrate17',
  'db:migrate18',
]

const IGNORABLE_SQL_ERRORS = [
  'duplicate column name',
  'already exists',
  'duplicate key',
  'short_description', // 0008 may be reapplied on already-clean schemas
]

function runMigrationScript(scriptName) {
  console.log(`[db:bootstrap] Running ${scriptName}`)
  const result = spawnSync(
    `${NPM_BIN} run ${scriptName}`,
    { encoding: 'utf8', stdio: 'pipe', shell: true }
  )

  if (result.error) {
    console.error(`[db:bootstrap] Failed to execute ${scriptName}: ${result.error.message}`)
    return false
  }

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.toLowerCase()
  if (result.status === 0) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    return true
  }

  if (IGNORABLE_SQL_ERRORS.some((token) => combined.includes(token))) {
    console.warn(`[db:bootstrap] Skipping non-fatal migration error for ${scriptName}`)
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    return true
  }

  console.error(`[db:bootstrap] Migration failed: ${scriptName}`)
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return false
}

function runSeed() {
  console.log('[db:bootstrap] Running db:seed')
  const result = spawnSync(
    `${NPM_BIN} run db:seed`,
    { encoding: 'utf8', stdio: 'pipe', shell: true }
  )
  if (result.error) {
    console.error(`[db:bootstrap] Failed to execute seed: ${result.error.message}`)
    return false
  }
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  return result.status === 0
}

const noSeed = process.argv.includes('--no-seed')
for (const migrationScript of MIGRATION_SCRIPTS) {
  const ok = runMigrationScript(migrationScript)
  if (!ok) process.exit(1)
}

if (!noSeed) {
  const seeded = runSeed()
  if (!seeded) process.exit(1)
}

console.log(`[db:bootstrap] Done${noSeed ? ' (seed skipped)' : ''}.`)
