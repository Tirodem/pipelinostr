#!/usr/bin/env node
/**
 * CLI tool to generate DPO/GDPR data processing report
 *
 * Usage:
 *   npx ts-node src/cli/dpo-report.ts
 *   # or after build:
 *   node dist/cli/dpo-report.js
 *   # or via script:
 *   ./scripts/DPO.sh
 *
 * Output:
 *   - Prints report to stdout
 *   - Optionally saves to reports/dpo-report.md
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDPOReport } from '../core/dpo-reporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const saveToFile = args.includes('--save') || args.includes('-s');
  const quietMode = args.includes('--quiet') || args.includes('-q');
  const helpMode = args.includes('--help') || args.includes('-h');

  if (helpMode) {
    console.log(`
DPO Report Generator - PipeliNostr

Usage:
  node dist/cli/dpo-report.js [options]
  ./scripts/DPO.sh [options]

Options:
  -s, --save    Save report to reports/dpo-report.md
  -q, --quiet   Only output to file (requires --save)
  -h, --help    Show this help message

Examples:
  ./scripts/DPO.sh              # Print report to console
  ./scripts/DPO.sh --save       # Print and save to file
  ./scripts/DPO.sh -s -q        # Save to file only (no console output)
`);
    process.exit(0);
  }

  try {
    const report = await generateDPOReport();

    // Print to stdout unless quiet mode
    if (!quietMode) {
      console.log(report);
    }

    // Save to file if requested
    if (saveToFile) {
      const reportsDir = join(PROJECT_ROOT, 'reports');

      if (!existsSync(reportsDir)) {
        await mkdir(reportsDir, { recursive: true });
      }

      const reportPath = join(reportsDir, 'dpo-report.md');
      await writeFile(reportPath, report, 'utf-8');

      if (!quietMode) {
        console.log(`\n---\nReport saved to: ${reportPath}`);
      } else {
        console.log(reportPath);
      }
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error generating DPO report: ${message}`);
    process.exit(1);
  }
}

main();
