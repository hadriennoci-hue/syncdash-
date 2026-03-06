#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_DB = 'syncdash-db';
const DEFAULT_LIMIT = 50;

function printHelp() {
  console.log(`Usage: node query-inventory.mjs [options]\n\nOptions:\n  --local               Query local D1 database (default)\n  --remote              Query remote D1 database\n  --db <name>           D1 database name (default: ${DEFAULT_DB})\n  --limit <n>           Row limit for default query (default: ${DEFAULT_LIMIT})\n  --sql <query>         Custom SQL query to execute\n  --json                Print rows as JSON\n  --debug-paths         Print common local sqlite/db files (diagnostics only)\n  -h, --help            Show this help\n\nExamples:\n  node query-inventory.mjs --local\n  node query-inventory.mjs --remote --limit 25\n  node query-inventory.mjs --sql "SELECT COUNT(*) AS count FROM products" --local\n`);
}

function parseArgs(argv) {
  const args = {
    local: true,
    remote: false,
    db: DEFAULT_DB,
    limit: DEFAULT_LIMIT,
    sql: '',
    json: false,
    debugPaths: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--local') {
      args.local = true;
      args.remote = false;
    } else if (token === '--remote') {
      args.remote = true;
      args.local = false;
    } else if (token === '--db') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --db');
      args.db = value;
      i += 1;
    } else if (token === '--limit') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --limit');
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --limit value: ${value}`);
      }
      args.limit = parsed;
      i += 1;
    } else if (token === '--sql') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --sql');
      args.sql = value;
      i += 1;
    } else if (token === '--json') {
      args.json = true;
    } else if (token === '--debug-paths') {
      args.debugPaths = true;
    } else if (token === '-h' || token === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function getDefaultInventorySql(limit) {
  return `
SELECT
  p.id AS sku,
  p.title,
  p.status,
  COALESCE(SUM(ws.quantity), 0) AS total_quantity,
  COALESCE(SUM(ws.quantity_ordered), 0) AS total_ordered,
  COUNT(DISTINCT ws.warehouse_id) AS warehouse_count,
  MAX(ws.updated_at) AS stock_updated_at
FROM products p
LEFT JOIN warehouse_stock ws ON ws.product_id = p.id
GROUP BY p.id, p.title, p.status
ORDER BY total_quantity DESC, p.id ASC
LIMIT ${limit};`.trim();
}

function listDbFiles() {
  const possiblePaths = [
    path.join(process.cwd(), '.wrangler', 'state', 'd1', 'D1.db'),
    path.join(process.cwd(), '.wrangler', 'state', 'd1', 'miniflare-D1DatabaseObject', 'syncdash-db.sqlite3'),
    path.join(process.cwd(), 'syncdash-db.sqlite3'),
  ];

  const foundCommon = possiblePaths.filter((p) => fs.existsSync(p));

  const discovered = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === '.open-next') {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.sqlite3') || entry.name.endsWith('.db'))) {
        discovered.push(full);
        if (discovered.length >= 40) {
          return;
        }
      }
    }
  }

  walk(process.cwd());

  console.log('Common DB paths:');
  if (foundCommon.length === 0) {
    console.log('  (none found)');
  } else {
    for (const p of foundCommon) console.log(`  ${p}`);
  }

  console.log('\nDiscovered *.sqlite3 / *.db files (first 40):');
  if (discovered.length === 0) {
    console.log('  (none found)');
  } else {
    for (const p of discovered) console.log(`  ${p}`);
  }
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const bracketStart = trimmed.indexOf('[');
  const braceStart = trimmed.indexOf('{');
  let start = -1;

  if (bracketStart === -1) start = braceStart;
  else if (braceStart === -1) start = bracketStart;
  else start = Math.min(bracketStart, braceStart);

  if (start < 0) return null;

  const candidate = trimmed.slice(start);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractRows(payload) {
  if (!payload) return [];

  if (Array.isArray(payload) && payload[0] && Array.isArray(payload[0].results)) {
    return payload[0].results;
  }

  if (payload.result && Array.isArray(payload.result[0]?.results)) {
    return payload.result[0].results;
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  return [];
}

function runWranglerQuery({ db, local, sql }) {
  const localWranglerJs = path.join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const hasLocalWrangler = fs.existsSync(localWranglerJs);

  const wranglerArgs = [
    'd1',
    'execute',
    db,
    local ? '--local' : '--remote',
    '--command',
    sql,
    '--json',
  ];

  const cmd = hasLocalWrangler ? process.execPath : (process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  const args = hasLocalWrangler ? [localWranglerJs, ...wranglerArgs] : wranglerArgs;

  const res = spawnSync(cmd, args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return res;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message || err));
    console.error('Use --help for usage.');
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (args.debugPaths) {
    listDbFiles();
    if (!args.sql) {
      console.log('\nContinuing with default inventory query...');
    }
  }

  const sql = args.sql || getDefaultInventorySql(args.limit);
  const mode = args.local ? 'local' : 'remote';

  console.log(`Running D1 query on "${args.db}" (${mode})...`);

  const result = runWranglerQuery({
    db: args.db,
    local: args.local,
    sql,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  if (result.status !== 0) {
    console.error('Wrangler command failed.');
    if (result.error) console.error(String(result.error.message || result.error));
    if (stderr.trim()) console.error(stderr.trim());
    if (stdout.trim()) console.error(stdout.trim());
    process.exit(result.status || 1);
  }

  const payload = extractJson(stdout);
  const rows = extractRows(payload);

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('Query succeeded but returned no rows.');
    return;
  }

  console.table(rows);
  console.log(`Rows: ${rows.length}`);
}

main();
