#!/bin/bash
# PipeliNostr queue monitoring script
# Displays real-time queue status

cd "$(dirname "$0")/.." || exit 1

DB_PATH="./data/pipelinostr.db"

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    exit 1
fi

echo "Monitoring PipeliNostr queue (Ctrl+C to stop)..."
echo ""

watch -n 2 "
echo '=== Queue Statistics ==='
sqlite3 -header -column $DB_PATH \"SELECT status, COUNT(*) as count FROM event_queue GROUP BY status;\"

echo ''
echo '=== Recent Events (last 20) ==='
sqlite3 -header -column $DB_PATH \"
SELECT
    id,
    event_type,
    status,
    retry_count as retry,
    max_retries as max,
    strftime('%H:%M:%S', created_at) as created,
    COALESCE(workflow_id, '-') as workflow,
    COALESCE(substr(error_message, 1, 40), '-') as error
FROM event_queue
ORDER BY created_at DESC
LIMIT 20;
\"
"
