/**
 * Database migration runner (ADR-003)
 *
 * Reads SQL files from db/migrations/ in order,
 * applies those not yet tracked in _migrations table.
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database, migrationsDir: string): number {
  // Ensure _migrations table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Get already applied migrations
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all()
      .map((row) => (row as { name: string }).name)
  );

  // Read migration files, sorted by name
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();

    count++;
  }

  return count;
}
