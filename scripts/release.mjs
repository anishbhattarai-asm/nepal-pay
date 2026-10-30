// Publishes every package whose current version is not on npm yet. Pass --dry-run to only show what would happen.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGES = ['core', 'esewa', 'khalti']; // core first: the others depend on it
const dryRun = process.argv.includes('--dry-run');

for (const dir of PACKAGES) {
  const { name, version } = JSON.parse(readFileSync(new URL(`../packages/${dir}/package.json`, import.meta.url), 'utf8'));
  if (isPublished(name, version)) {
    console.log(`skip     ${name}@${version} (already on npm)`);
    continue;
  }
  console.log(`publish  ${name}@${version}${dryRun ? ' (dry run)' : ''}`);
  npm(['publish', '-w', name, ...(dryRun ? ['--dry-run'] : [])], { stdio: 'inherit' });
}

function isPublished(name, version) {
  try {
    const out = npm(['view', `${name}@${version}`, 'version', '--prefer-online'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() === version;
  } catch {
    return false; // E404: the package does not exist yet
  }
}

function npm(args, options) {
  // Under `npm run`, npm_execpath is npm's own CLI script: run it with node, no shell needed.
  const cli = process.env.npm_execpath;
  if (cli && cli.endsWith('.js')) return execFileSync(process.execPath, [cli, ...args], options);
  // Run directly with node: npm is npm.cmd on Windows, so go through the shell. Args are names and flags only.
  return execSync(`npm ${args.join(' ')}`, options);
}
