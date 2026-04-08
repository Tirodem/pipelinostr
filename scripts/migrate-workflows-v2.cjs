/**
 * Migrate v1 workflow YAML files to v2 flat format.
 *
 * Changes:
 * - trigger.type: nostr_event → removed (default)
 * - trigger.filters.* → trigger.*
 * - actions.*.config.* → flattened into action
 * - kinds: [4, 1059] → source: nostr.dm
 * - kinds: [9735] → source: nostr.zap
 * - kinds: [1] → source: nostr.note
 * - kinds: [7] → source: nostr.reaction
 * - trigger.type: http_webhook → source: webhook.post
 * - trigger.type: internal → internal_source field
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Kind → source mapping
const KIND_SOURCE_MAP = {
  '4,1059': 'nostr.dm',
  '4': 'nostr.dm',
  '1059': 'nostr.dm',
  '9735': 'nostr.zap',
  '1': 'nostr.note',
  '7': 'nostr.reaction',
  '6': 'nostr.repost',
};

function migrateWorkflow(input) {
  const wf = yaml.parse(input);
  if (!wf || !wf.trigger) return yaml.stringify(wf);

  // Migrate trigger
  const oldTrigger = wf.trigger;
  const newTrigger = {};

  // Determine source from trigger type + kinds
  if (oldTrigger.type === 'http_webhook') {
    newTrigger.source = 'webhook.post';
    if (oldTrigger.config) {
      if (oldTrigger.config.path) newTrigger.path = oldTrigger.config.path;
      if (oldTrigger.config.method) newTrigger.method = oldTrigger.config.method;
    }
  } else if (oldTrigger.type === 'internal') {
    if (oldTrigger.source) newTrigger.internal_source = oldTrigger.source;
  } else {
    // nostr_event (default)
    const filters = oldTrigger.filters || {};
    const kinds = filters.kinds;

    if (kinds && kinds.length > 0) {
      const kindKey = kinds.sort((a, b) => a - b).join(',');
      newTrigger.source = KIND_SOURCE_MAP[kindKey] || `nostr.raw`;
      if (!KIND_SOURCE_MAP[kindKey]) {
        newTrigger.kinds = kinds;
      }
    } else {
      newTrigger.source = 'nostr.dm'; // default for most workflows
    }

    // Copy filter fields (flatten trigger.filters.* → trigger.*)
    for (const [key, value] of Object.entries(filters)) {
      if (key === 'kinds') continue; // Already handled via source
      newTrigger[key] = value;
    }

    // Rename zap_min_amount to min_amount
    if (newTrigger.zap_min_amount !== undefined) {
      newTrigger.min_amount = newTrigger.zap_min_amount;
      delete newTrigger.zap_min_amount;
    }
  }

  wf.trigger = newTrigger;

  // Migrate actions: flatten config
  if (wf.actions) {
    wf.actions = wf.actions.map(action => {
      if (!action.config) return action;

      const { config, ...rest } = action;
      // Merge config fields into the action (flattened)
      return { ...rest, ...config };
    });
  }

  // Remove trigger.type if it was nostr_event
  delete wf.trigger.type;

  return yaml.stringify(wf, { lineWidth: 0 });
}

// --- Main ---

const inputDir = path.join(__dirname, '..', 'examples', 'workflows');
const outputDir = path.join(__dirname, '..', 'workflows');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.yml.example'));

let migrated = 0;
let skipped = 0;

for (const file of files) {
  const inputPath = path.join(inputDir, file);
  const outputPath = path.join(outputDir, file);

  // Skip if already migrated
  if (fs.existsSync(outputPath)) {
    skipped++;
    continue;
  }

  try {
    const input = fs.readFileSync(inputPath, 'utf-8');
    const output = migrateWorkflow(input);
    fs.writeFileSync(outputPath, output);
    migrated++;
    console.log(`✓ ${file}`);
  } catch (err) {
    console.error(`✗ ${file}: ${err.message}`);
  }
}

console.log(`\nMigrated: ${migrated}, Skipped: ${skipped} (already exist), Total: ${files.length}`);
