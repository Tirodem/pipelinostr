/**
 * PipeliNostr update command
 *
 * Pulls latest code, installs deps, rebuilds, restarts service.
 * Runs as the pipelinostr user with sudo for systemctl restart.
 */

import { execSync } from 'node:child_process';
import { PROJECT_ROOT } from '../utils/paths.js';

export async function runUpdate(branch?: string): Promise<void> {
  const cwd = PROJECT_ROOT;

  console.log('\n\x1b[36m  PipeliNostr — Update\x1b[0m\n');

  try {
    // Pull
    const targetBranch = branch ?? 'v2';
    console.log(`  Pulling ${targetBranch}...`);
    run(`git pull origin ${targetBranch}`, cwd);

    // Install
    console.log('  Installing dependencies...');
    run('npm install --silent', cwd);

    // Build
    console.log('  Building...');
    run('npm run build', cwd);

    // Validate
    console.log('  Validating...');
    run('node dist/cli/index.js validate', cwd);

    // Restart service
    console.log('  Restarting service...');
    run('sudo systemctl restart pipelinostr', cwd);

    console.log('\n\x1b[32m  Update complete!\x1b[0m');
    console.log('  Run: journalctl -u pipelinostr -f\n');
  } catch (err) {
    console.error(`\n\x1b[31m  Update failed: ${(err as Error).message}\x1b[0m\n`);
    process.exit(1);
  }
}

function run(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}
