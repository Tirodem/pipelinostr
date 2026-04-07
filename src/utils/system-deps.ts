/**
 * System dependency manager
 *
 * Checks and optionally auto-installs system binaries (apt, apk, etc.)
 * for handlers that need them. Per-handler opt-in via auto_install config.
 */

import { spawn } from 'node:child_process';
import type { Logger } from 'pino';

export interface SystemDependency {
  binary: string;
  packages: {
    apt?: string | undefined;
    apk?: string | undefined;
    pacman?: string | undefined;
    brew?: string | undefined;
  };
  optional?: boolean | undefined;
}

type PackageManager = 'apt' | 'apk' | 'pacman' | 'brew';

let detectedPkgManager: PackageManager | null | undefined;

/**
 * Check if a binary exists on the system.
 */
export async function binaryExists(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [binary], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Detect the system package manager.
 */
async function detectPackageManager(): Promise<PackageManager | null> {
  if (detectedPkgManager !== undefined) return detectedPkgManager;

  for (const pm of ['apt', 'apk', 'pacman', 'brew'] as const) {
    if (await binaryExists(pm === 'apt' ? 'apt-get' : pm)) {
      detectedPkgManager = pm;
      return pm;
    }
  }

  detectedPkgManager = null;
  return null;
}

/**
 * Check if we can install packages (root or sudo available).
 */
function canInstall(): boolean {
  return process.getuid?.() === 0;
}

/**
 * Install a system package.
 */
function installPackage(pm: PackageManager, pkg: string, logger: Logger): Promise<boolean> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];

    switch (pm) {
      case 'apt':
        cmd = 'apt-get';
        args = ['install', '-y', pkg];
        break;
      case 'apk':
        cmd = 'apk';
        args = ['add', '--no-cache', pkg];
        break;
      case 'pacman':
        cmd = 'pacman';
        args = ['-S', '--noconfirm', pkg];
        break;
      case 'brew':
        cmd = 'brew';
        args = ['install', pkg];
        break;
    }

    logger.info({ command: `${cmd} ${args.join(' ')}` }, 'Installing system dependency');

    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      logger.error({ error: err.message }, 'Failed to run package manager');
      resolve(false);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info({ package: pkg }, 'System dependency installed successfully');
        resolve(true);
      } else {
        logger.error({ package: pkg, exitCode: code, stderr: stderr.slice(0, 200) }, 'Package installation failed');
        resolve(false);
      }
    });
  });
}

/**
 * Ensure system dependencies are available for a handler.
 *
 * Returns list of missing dependencies that couldn't be resolved.
 */
export async function ensureSystemDeps(
  deps: SystemDependency[],
  autoInstall: boolean,
  logger: Logger,
): Promise<{ missing: string[]; installed: string[] }> {
  const missing: string[] = [];
  const installed: string[] = [];

  for (const dep of deps) {
    if (await binaryExists(dep.binary)) continue;

    // Binary not found
    if (!autoInstall) {
      const pm = await detectPackageManager();
      const pkg = pm ? dep.packages[pm] : null;
      const installCmd = pkg && pm
        ? `sudo ${pm === 'apt' ? 'apt-get' : pm} install ${pkg}`
        : `Install "${dep.binary}" manually`;

      if (dep.optional) {
        logger.warn({ binary: dep.binary, install: installCmd }, 'Optional system dependency missing');
      } else {
        logger.warn({ binary: dep.binary, install: installCmd }, 'System dependency missing');
        missing.push(dep.binary);
      }
      continue;
    }

    // Auto-install enabled
    const pm = await detectPackageManager();
    if (!pm) {
      logger.error({ binary: dep.binary }, 'No supported package manager found — cannot auto-install');
      missing.push(dep.binary);
      continue;
    }

    const pkg = dep.packages[pm];
    if (!pkg) {
      logger.error({ binary: dep.binary, pm }, 'No package name configured for this package manager');
      missing.push(dep.binary);
      continue;
    }

    if (!canInstall()) {
      logger.warn({ binary: dep.binary, install: `sudo ${pm === 'apt' ? 'apt-get' : pm} install ${pkg}` },
        'Cannot auto-install: not running as root');
      missing.push(dep.binary);
      continue;
    }

    // Install
    const success = await installPackage(pm, pkg, logger);
    if (success && await binaryExists(dep.binary)) {
      installed.push(dep.binary);
    } else {
      missing.push(dep.binary);
    }
  }

  return { missing, installed };
}
