---
title: "Event Queue / Message Broker"
priority: "High"
status: "DONE"
created: "2025-12-20"
completed: "2025-12-20"
---

### Event Queue / Message Broker

**Priority:** High
**Status:** DONE

#### Description

Add a message queue layer to handle events reliably with persistence, retry, and replay capabilities.

#### Use Cases

1. **Queue during high traffic:** Buffer events when handlers are busy
2. **Replay failed events:** Re-execute workflows that failed due to handler unavailability
3. **Process missed events:** Handle events that weren't processed (system restart, etc.)
4. **Full audit trail:** Track every trigger from receipt to completion

#### Current State

The `event_log` table tracks events but doesn't support:
- Queuing (pending → processing → done)
- Automatic retry with backoff
- Manual replay of failed events

#### Proposed Implementation (SQLite-based)

1. **New `event_queue` table:**
   ```sql
   CREATE TABLE event_queue (
     id INTEGER PRIMARY KEY,
     event_type TEXT NOT NULL,          -- nostr_dm, api_webhook, hook
     event_data TEXT NOT NULL,          -- JSON payload
     status TEXT DEFAULT 'pending',     -- pending, processing, completed, failed, dead
     priority INTEGER DEFAULT 0,
     retry_count INTEGER DEFAULT 0,
     max_retries INTEGER DEFAULT 3,
     next_retry_at DATETIME,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     started_at DATETIME,
     completed_at DATETIME,
     error_message TEXT,
     workflow_id TEXT,
     result_data TEXT
   );
   ```

2. **Queue Worker:**
   - Polls queue for pending events
   - Marks as `processing` before execution
   - Updates to `completed` or `failed` after
   - Exponential backoff for retries
   - Dead-letter after max retries

3. **API Endpoints:**
   - `GET /api/queue` - List queued events
   - `POST /api/queue/:id/replay` - Replay a failed event
   - `POST /api/queue/replay-failed` - Replay all failed events
   - `DELETE /api/queue/:id` - Remove from queue

4. **CLI Commands:**
   ```bash
   pipelinostr queue list
   pipelinostr queue replay <id>
   pipelinostr queue replay-failed
   pipelinostr queue stats
   ```

#### Future: RabbitMQ/Redis Migration

Design with abstraction layer to allow future migration:
```typescript
interface MessageBroker {
  enqueue(event: QueuedEvent): Promise<string>;
  dequeue(): Promise<QueuedEvent | null>;
  ack(id: string): Promise<void>;
  nack(id: string, requeue: boolean): Promise<void>;
}
```

---


---
