import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');

const parseEnvFile = path => {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
};

const env = { ...parseEnvFile(resolve(repositoryRoot, '.env')), ...process.env };

const source = env.DIRECT_URL ?? env.DATABASE_URL;
if (source === undefined) {
  process.stderr.write('DIRECT_URL or DATABASE_URL must be set in .env\n');
  process.exit(1);
}

const toMigrationUrl = value => {
  const url = new URL(value);
  for (const parameter of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer']) url.searchParams.delete(parameter);
  if (url.searchParams.get('sslmode') === null) url.searchParams.set('sslmode', 'disable');
  return url.toString();
};

const require = createRequire(import.meta.url);
const cli = require.resolve('dbmate/dist/cli.js');

const command = process.env.DBMATE_COMMAND ?? 'up';
const dbmateArguments = ['--migrations-dir', 'migrations', '--no-dump-schema', '--url', toMigrationUrl(source), command];
if (command === 'new') dbmateArguments.push(process.env.DBMATE_MIGRATION_NAME ?? 'next_migration');

if (!existsSync(cli)) {
  process.stderr.write(`dbmate is not installed: ${cli}\n`);
  process.exit(1);
}

const isInteractiveDrop = command === 'drop';

const child = spawn(process.execPath, [cli, ...dbmateArguments], {
  cwd: packageRoot,
  env: { ...env, DATABASE_URL: toMigrationUrl(source) },
  stdio: isInteractiveDrop ? ['pipe', 'inherit', 'inherit'] : 'inherit',
  windowsHide: true
});

if (isInteractiveDrop) {
  child.stdin.write('yes\n');
  child.stdin.end();
}

child.on('error', error => {
  process.stderr.write(`failed to start dbmate: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => process.exit(signal === null ? (code ?? 1) : 1));
