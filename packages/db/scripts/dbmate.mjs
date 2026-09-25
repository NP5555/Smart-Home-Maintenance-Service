import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');

const parseEnvFile = (path) => {
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

const env = {
  ...parseEnvFile(resolve(repositoryRoot, '.env')),
  ...process.env
};

const source = env.DATABASE_URL ?? env.DIRECT_URL;
if (source === undefined) {
  process.stderr.write('DATABASE_URL or DIRECT_URL must be set in .env\n');
  process.exit(1);
}

const toMigrationUrl = value => {
  const url = new URL(value);
  url.searchParams.delete('schema');
  url.searchParams.delete('connection_limit');
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('pgbouncer');
  if (url.searchParams.get('sslmode') === null) url.searchParams.set('sslmode', 'disable');
  return url.toString();
};

const resolveBinary = () => {
  const name = 'dbmate';
  const suffix = process.platform === 'win32' ? '.CMD' : '';
  const searchRoots = [resolve(packageRoot, 'node_modules', '.bin'), resolve(repositoryRoot, 'node_modules', '.bin')];
  for (const root of searchRoots) {
    const candidate = resolve(root, `${name}${suffix}`);
    if (existsSync(candidate)) return candidate;
  }
  return `${name}${suffix}`;
};

const arguments_ = [resolveBinary(), '--migrations-dir', 'migrations', '--no-dump-schema', '--url', toMigrationUrl(source)];
if (process.env.DBMATE_COMMAND === 'drop') {
  arguments_.push('drop', '--force');
} else {
  arguments_.push(process.env.DBMATE_COMMAND ?? 'up');
}

const child = spawn(arguments_[0] ?? 'dbmate', arguments_.slice(1), {
  cwd: packageRoot,
  env: { ...env, DATABASE_URL: toMigrationUrl(source) },
  stdio: 'inherit',
  windowsHide: true
});

child.on('exit', code => process.exit(code ?? 1));
