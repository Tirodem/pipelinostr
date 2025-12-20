-- Migration: workflow_state schema change
-- From: UNIQUE(workflow_id, namespace, state_key)
-- To:   UNIQUE(namespace, state_key)
--
-- This migration merges duplicate rows by summing value_number values.
-- Run with: sqlite3 data/pipelinostr.db < tmp/migrate-workflow-state.sql
--
-- Date: 2025-12-20

-- Show current state before migration
.mode column
.headers on
SELECT 'BEFORE MIGRATION - Current workflow_state rows:' as info;
SELECT * FROM workflow_state WHERE namespace = 'balances';

-- 1. Create the new table with correct UNIQUE constraint
CREATE TABLE IF NOT EXISTS workflow_state_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    state_key TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'number',
    value_number REAL,
    value_string TEXT,
    value_json TEXT,
    value_boolean INTEGER,
    source_event_id TEXT,
    event_log_id INTEGER,
    source_pubkey TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(namespace, state_key)
);

-- 2. Migrate data, merging duplicates by summing value_number
INSERT INTO workflow_state_new (
    workflow_id, namespace, state_key, value_type,
    value_number, value_string, value_json, value_boolean,
    source_event_id, event_log_id, source_pubkey,
    created_at, updated_at
)
SELECT
    MAX(workflow_id) as workflow_id,
    namespace,
    state_key,
    MAX(value_type) as value_type,
    SUM(value_number) as value_number,
    MAX(value_string) as value_string,
    MAX(value_json) as value_json,
    MAX(value_boolean) as value_boolean,
    MAX(source_event_id) as source_event_id,
    MAX(event_log_id) as event_log_id,
    MAX(source_pubkey) as source_pubkey,
    MIN(created_at) as created_at,
    MAX(updated_at) as updated_at
FROM workflow_state
GROUP BY namespace, state_key;

-- 3. Show migrated data for verification
SELECT 'AFTER MIGRATION - New workflow_state rows:' as info;
SELECT * FROM workflow_state_new WHERE namespace = 'balances';

-- 4. Drop old table and rename new one
DROP TABLE workflow_state;
ALTER TABLE workflow_state_new RENAME TO workflow_state;

-- 5. Recreate indexes with new schema
DROP INDEX IF EXISTS idx_workflow_state_lookup;
CREATE INDEX idx_workflow_state_lookup ON workflow_state(namespace, state_key);
CREATE INDEX IF NOT EXISTS idx_workflow_state_pubkey ON workflow_state(source_pubkey);
CREATE INDEX IF NOT EXISTS idx_workflow_state_updated ON workflow_state(updated_at);

-- 6. Final verification
SELECT 'FINAL - workflow_state after migration:' as info;
SELECT * FROM workflow_state WHERE namespace = 'balances';

SELECT 'Migration completed successfully!' as status;
