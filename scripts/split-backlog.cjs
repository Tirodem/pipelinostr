#!/usr/bin/env node
/**
 * Split BACKLOG.md into active (Proposed/Pending) and archived (DONE/CANCELLED)
 */

const fs = require('fs');
const path = require('path');

const BACKLOG_PATH = path.join(__dirname, '..', 'BACKLOG.md');
const BACKLOG_OLD_PATH = path.join(__dirname, '..', 'backlog-old.md');

const content = fs.readFileSync(BACKLOG_PATH, 'utf-8');
const lines = content.split('\n');

// Find all ### sections with their status
const sections = [];
let currentSection = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // New section starts
  if (line.startsWith('### ')) {
    if (currentSection) {
      currentSection.endLine = i - 1;
      sections.push(currentSection);
    }
    currentSection = {
      title: line,
      startLine: i,
      endLine: null,
      status: null,
    };
  }

  // Find status
  if (currentSection && line.includes('**Status:**')) {
    const match = line.match(/\*\*Status:\*\*\s*(\w+)/);
    if (match) {
      currentSection.status = match[1];
    }
  }
}

// Don't forget last section
if (currentSection) {
  currentSection.endLine = lines.length - 1;
  sections.push(currentSection);
}

// Separate sections
const doneStatuses = ['DONE', 'CANCELLED', 'DEPRECATED'];
const doneSections = sections.filter(s => doneStatuses.includes(s.status));
const activeSections = sections.filter(s => !doneStatuses.includes(s.status));

console.log(`Found ${sections.length} sections total`);
console.log(`  - Active (Proposed/Pending): ${activeSections.length}`);
console.log(`  - Done/Cancelled: ${doneSections.length}`);

// Build new files
let activeContent = '# PipeliNostr Backlog\n\n## Features\n\n';
let oldContent = '# PipeliNostr Backlog - Archives\n\n> Fonctionnalités terminées ou annulées.\n\n';

// Get content for each section
function getSectionContent(section) {
  const sectionLines = lines.slice(section.startLine, section.endLine + 1);
  return sectionLines.join('\n') + '\n\n---\n\n';
}

// Add active sections
for (const section of activeSections) {
  activeContent += getSectionContent(section);
}

// Add done sections
for (const section of doneSections) {
  oldContent += getSectionContent(section);
}

// Write files
fs.writeFileSync(BACKLOG_PATH, activeContent.trim() + '\n');
fs.writeFileSync(BACKLOG_OLD_PATH, oldContent.trim() + '\n');

console.log(`\nWritten:`);
console.log(`  - BACKLOG.md: ${activeSections.length} active sections`);
console.log(`  - backlog-old.md: ${doneSections.length} archived sections`);

// List what was moved
console.log(`\nMoved to backlog-old.md:`);
for (const section of doneSections) {
  console.log(`  - ${section.title.replace('### ', '')} (${section.status})`);
}
