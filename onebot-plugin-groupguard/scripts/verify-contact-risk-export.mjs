#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildContactRiskExport } from './export-contact-risk-data.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-risk-export-'));
const dbPath = path.join(root, 'groupguard.db');
const db = new DatabaseSync(dbPath);
try {
  db.exec(`
    CREATE TABLE scammer_records (
      qq TEXT PRIMARY KEY,
      report_count INTEGER NOT NULL DEFAULT 0,
      last_report_content TEXT NOT NULL DEFAULT '',
      recent_reports_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      first_reported_at INTEGER NOT NULL DEFAULT 0,
      last_reported_at INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE contact_risk_records (
      category TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0,
      last_report_content TEXT NOT NULL DEFAULT '',
      recent_reports_json TEXT NOT NULL DEFAULT '[]',
      sources_json TEXT NOT NULL DEFAULT '[]',
      first_reported_at INTEGER NOT NULL DEFAULT 0,
      last_reported_at INTEGER NOT NULL DEFAULT 0,
      last_checked_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (category, identifier_type, identifier_value)
    );
    CREATE TABLE group_config (group_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
  db.prepare(`INSERT INTO scammer_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('123456', 1, 'legacy', '["legacy"]', '["legacy-source"]', 10, 20, 0, 20);
  db.prepare(`INSERT INTO contact_risk_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('scammer', 'qq', '123456', 3, 'modern', '["modern"]', '["arm"]', 10, 30, 40, 50);
  db.prepare(`INSERT INTO contact_risk_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('peer', 'wechat', 'wx_peer_01', 2, 'peer evidence', '["peer evidence"]', '["arm"]', 11, 31, 0, 51);
  db.prepare(`INSERT INTO group_config VALUES (?, ?, ?)`)
    .run('10001', '{"lolToken":"must-not-export"}', 1);
} finally {
  db.close();
}

try {
  const payload = buildContactRiskExport(dbPath);
  assert.equal(payload.schema, 'groupguard-contact-risk-export.v1');
  assert.deepEqual(payload.counts, { total: 2, scammer: 1, peer: 1 });
  assert.match(payload.content_sha256, /^[a-f0-9]{64}$/);
  const scammer = payload.records.find((record) => record.category === 'scammer');
  assert.equal(scammer.report_count, 3, 'modern generic record must override legacy duplicate');
  assert.equal(scammer.last_report_content, 'modern');
  assert.equal(payload.records.some((record) => JSON.stringify(record).includes('must-not-export')), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'group_config'), false);
  console.log('contact risk export verification passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
