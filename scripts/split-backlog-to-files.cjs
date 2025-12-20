#!/usr/bin/env node
/**
 * Split BACKLOG.md and backlog-old.md into individual feature files
 * with timestamps for chronological ordering
 */

const fs = require('fs');
const path = require('path');

const BACKLOG_DIR = path.join(__dirname, '..', 'backlog');
const BACKLOG_PATH = path.join(__dirname, '..', 'BACKLOG.md');
const BACKLOG_OLD_PATH = path.join(__dirname, '..', 'backlog-old.md');

// Ensure directories exist
['to-do', 'wip', 'to-test', 'done'].forEach(dir => {
  const dirPath = path.join(BACKLOG_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Parse a backlog file and extract sections
function parseBacklog(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const sections = [];
  let currentSection = null;
  let sectionLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New section starts with ###
    if (line.startsWith('### ')) {
      // Save previous section
      if (currentSection) {
        currentSection.content = sectionLines.join('\n');
        sections.push(currentSection);
      }

      // Start new section
      const title = line.replace('### ', '').trim();
      currentSection = {
        title,
        status: null,
        priority: null,
        content: ''
      };
      sectionLines = [line];
    } else if (currentSection) {
      sectionLines.push(line);

      // Extract status
      if (line.includes('**Status:**')) {
        const match = line.match(/\*\*Status:\*\*\s*(\w+)/);
        if (match) {
          currentSection.status = match[1];
        }
      }

      // Extract priority
      if (line.includes('**Priority:**')) {
        const match = line.match(/\*\*Priority:\*\*\s*(.+)/);
        if (match) {
          currentSection.priority = match[1].trim();
        }
      }
    }
  }

  // Don't forget last section
  if (currentSection) {
    currentSection.content = sectionLines.join('\n');
    sections.push(currentSection);
  }

  return sections;
}

// Convert title to filename slug
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')    // Remove special chars
    .replace(/\s+/g, '-')             // Spaces to dashes
    .replace(/-+/g, '-')              // Multiple dashes to single
    .replace(/^-|-$/g, '')            // Trim dashes
    .substring(0, 50);                 // Limit length
}

// Determine target directory based on status
function getTargetDir(status) {
  if (!status) return 'to-do';

  const s = status.toUpperCase();
  if (s === 'DONE' || s === 'CANCELLED' || s === 'DEPRECATED') return 'done';
  if (s === 'WIP' || s === 'IN_PROGRESS' || s === 'IN PROGRESS') return 'wip';
  if (s === 'TO_TEST' || s === 'TESTING' || s === 'TO TEST') return 'to-test';
  return 'to-do';  // Proposed, Pending, Research, etc.
}

// Get today's date in YYYY-MM-DD format
function getToday() {
  return new Date().toISOString().split('T')[0];
}

// Main
const today = getToday();
let created = 0;
let skipped = 0;

// Process BACKLOG.md (active items)
console.log('Processing BACKLOG.md...');
const activeSections = parseBacklog(BACKLOG_PATH);

for (const section of activeSections) {
  // Skip non-feature sections (tables, summaries, etc.)
  if (!section.status && !section.priority) {
    console.log(`  Skipping (no status/priority): ${section.title}`);
    skipped++;
    continue;
  }

  const targetDir = getTargetDir(section.status);
  const slug = slugify(section.title);
  const filename = `${today}-${slug}.md`;
  const filePath = path.join(BACKLOG_DIR, targetDir, filename);

  // Add frontmatter
  const frontmatter = `---
title: "${section.title.replace(/"/g, '\\"')}"
priority: "${section.priority || 'Medium'}"
status: "${section.status || 'Proposed'}"
created: "${today}"
---

`;

  const content = frontmatter + section.content.trim() + '\n';

  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${targetDir}/${filename}`);
  created++;
}

// Process backlog-old.md (completed items)
console.log('\nProcessing backlog-old.md...');
const doneSections = parseBacklog(BACKLOG_OLD_PATH);

for (const section of doneSections) {
  // Skip non-feature sections
  if (!section.status && !section.priority) {
    console.log(`  Skipping (no status/priority): ${section.title}`);
    skipped++;
    continue;
  }

  const targetDir = getTargetDir(section.status);
  const slug = slugify(section.title);
  const filename = `${today}-${slug}.md`;
  const filePath = path.join(BACKLOG_DIR, targetDir, filename);

  // Add frontmatter
  const frontmatter = `---
title: "${section.title.replace(/"/g, '\\"')}"
priority: "${section.priority || 'Medium'}"
status: "${section.status || 'DONE'}"
created: "${today}"
completed: "${today}"
---

`;

  const content = frontmatter + section.content.trim() + '\n';

  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${targetDir}/${filename}`);
  created++;
}

console.log(`\nSummary:`);
console.log(`  Created: ${created} files`);
console.log(`  Skipped: ${skipped} sections (no status/priority)`);
console.log(`\nFiles are in:`);
console.log(`  backlog/to-do/    - Proposed, Pending, Research`);
console.log(`  backlog/wip/      - In Progress`);
console.log(`  backlog/to-test/  - Testing`);
console.log(`  backlog/done/     - Done, Cancelled, Deprecated`);
