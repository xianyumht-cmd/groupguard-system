#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const EXPORT_SCHEMA = 'groupguard-contact-risk-export.v1';

function usage() {
  console.error('Usage: node scripts/export-contact-risk-data.mjs --db <groupguard.db> --out <export.json>');
}

function parseArgs(argv) {
  const result = { db: '', out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--db') result.db = String(argv[++i] || '').trim();
    else if (key === '--out') result.out = String(argv[++i] || '').trim();
  }
  return result;
}

function parseStringArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeCategory(value) {
  return value === 'peer' ? 'peer' : 'scammer';
}

function normalizeIdentifierType(value) {
  return value === 'wechat' ? 'wechat' : 'qq';
}

function validIdentifier(type, value) {
  return type === 'qq'
    ? /^\d{5,13}$/.test(value)
    : /^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(value);
}

function normalizeRecord(row) {
  const category = normalizeCategory(String(row.category || 'scammer'));
  const identifierType = normalizeIdentifierType(String(row.identifier_type || 'qq'));
  const identifierValue = String(row.identifier_value || row.qq || '').trim();
  if (!validIdentifier(identifierType, identifierValue)) return null;
  return {
    category,
    identifier_type: identifierType,
    identifier_value: identifierValue,
    report_count: Math.max(0, Number(row.report_count || 0) || 0),
    last_report_content: String(row.last_report_content || '').replace(/\s+/g, ' ').trim().slice(0, 5000),
    recent_reports: parseStringArray(row.recent_reports_json).slice(0, 50),
    sources: parseStringArray(row.sources_json).slice(0, 20),
    first_reported_at: Math.max(0, Number(row.first_reported_at || 0) || 0),
    last_reported_at: Math.max(0, Number(row.last_reported_at || 0) || 0),
    last_checked_at: Math.max(0, Number(row.last_checked_at || 0) || 0),
    updated_at: Math.max(0, Number(row.updated_at || 0) || 0)
  };
}

function tableExists(db, name) {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function buildContactRiskExport(dbPath) {
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) throw new Error(`database not found: ${resolved}`);
  const db = new DatabaseSync(resolved, { readOnly: true });
  try {
    const merged = new Map();
    if (tableExists(db, 'scammer_records')) {
      const rows = db.prepare(`SELECT qq, report_count, last_report_content, recent_reports_json, sources_json,
        first_reported_at, last_reported_at, last_checked_at, updated_at FROM scammer_records`).all();
      for (const row of rows) {
        const record = normalizeRecord({ ...row, category: 'scammer', identifier_type: 'qq', identifier_value: row.qq });
        if (record) merged.set(`scammer:qq:${record.identifier_value}`, record);
      }
    }
    if (tableExists(db, 'contact_risk_records')) {
      const rows = db.prepare(`SELECT category, identifier_type, identifier_value, report_count, last_report_content,
        recent_reports_json, sources_json, first_reported_at, last_reported_at, last_checked_at, updated_at
        FROM contact_risk_records`).all();
      for (const row of rows) {
        const record = normalizeRecord(row);
        if (record) merged.set(`${record.category}:${record.identifier_type}:${record.identifier_value}`, record);
      }
    }
    const records = [...merged.values()].sort((a, b) => {
      const left = `${a.category}:${a.identifier_type}:${a.identifier_value}`;
      const right = `${b.category}:${b.identifier_type}:${b.identifier_value}`;
      return left.localeCompare(right, 'en');
    });
    const contentSha256 = sha256(canonicalJson(records));
    return {
      schema: EXPORT_SCHEMA,
      exported_at: new Date().toISOString(),
      source: { database: path.basename(resolved) },
      counts: {
        total: records.length,
        scammer: records.filter((item) => item.category === 'scammer').length,
        peer: records.filter((item) => item.category === 'peer').length
      },
      content_sha256: contentSha256,
      records
    };
  } finally {
    db.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db || !args.out) {
    usage();
    process.exitCode = 2;
    return;
  }
  const payload = buildContactRiskExport(args.db);
  const output = path.resolve(args.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, output);
  console.log(JSON.stringify({ ok: true, output, counts: payload.counts, content_sha256: payload.content_sha256 }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
