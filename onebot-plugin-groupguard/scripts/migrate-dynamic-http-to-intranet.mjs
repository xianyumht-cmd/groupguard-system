#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SERVICE_SCHEMA = 'lolapi-dynamic-query-providers.v1';

function parseArgs(argv) {
  const result = { input: '', clientOut: '', serviceOut: '', reportOut: '', apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--input') result.input = String(argv[++index] || '').trim();
    else if (key === '--client-out') result.clientOut = String(argv[++index] || '').trim();
    else if (key === '--service-out') result.serviceOut = String(argv[++index] || '').trim();
    else if (key === '--report-out') result.reportOut = String(argv[++index] || '').trim();
    else if (key === '--apply') result.apply = true;
  }
  return result;
}

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringMap(value) {
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || '').trim();
    const item = String(rawValue || '').trim();
    if (key && item) result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeCommand(raw, seen) {
  if (!isRecord(raw)) fail('dynamic command must be an object');
  const id = String(raw.id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(id)) fail(`invalid command id: ${id || '<empty>'}`);
  if (seen.has(id)) fail(`duplicate command id: ${id}`);
  seen.add(id);
  const trigger = isRecord(raw.trigger) ? raw.trigger : {};
  const triggerType = trigger.type === 'exact' || trigger.type === 'prefix' ? trigger.type : '';
  const triggerValue = String(trigger.value || '').trim();
  if (!triggerType || !triggerValue) fail(`invalid trigger: ${id}`);
  const provider = isRecord(raw.provider) ? raw.provider : {};
  if (provider.type !== 'http' && provider.type !== 'intranet') fail(`unsupported provider type for ${id}`);
  const parameterSchema = isRecord(raw.parameterSchema) ? raw.parameterSchema : {};
  const required = Array.isArray(parameterSchema.required)
    ? [...new Set(parameterSchema.required.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  const optional = Array.isArray(parameterSchema.optional)
    ? [...new Set(parameterSchema.optional.map((value) => String(value || '').trim()).filter((value) => value && !required.includes(value)))]
    : [];
  const parameters = stringMap(raw.parameters);

  const clientCommand = {
    id,
    enabled: raw.enabled !== false,
    priority: Number.isFinite(raw.priority) ? Math.trunc(raw.priority) : 0,
    featureType: 'query',
    featureKey: String(raw.featureKey || `query.dynamic_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`).trim(),
    scope: ['global', 'group', 'private', 'both'].includes(raw.scope) ? raw.scope : 'group',
    allowedGroups: Array.isArray(raw.allowedGroups) ? raw.allowedGroups.map(String) : [],
    blockedGroups: Array.isArray(raw.blockedGroups) ? raw.blockedGroups.map(String) : [],
    requiresLicense: raw.requiresLicense !== false,
    permission: ['all', 'admin', 'owner'].includes(raw.permission) ? raw.permission : 'all',
    trigger: { type: triggerType, value: triggerValue },
    ...(parameters ? { parameters } : {}),
    parameterSchema: { required, optional },
    provider: { type: 'intranet' },
    response: { type: 'structured' },
    fallbackText: String(raw.fallbackText || '动态查询暂时不可用，请稍后再试').trim()
  };

  let serviceCommand = null;
  if (provider.type === 'http') {
    const method = provider.method === 'POST' ? 'POST' : provider.method === 'GET' ? 'GET' : '';
    const url = String(provider.url || '').trim();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail(`invalid provider URL: ${id}`);
    }
    if (!method || !['http:', 'https:'].includes(parsed.protocol)) fail(`invalid provider definition: ${id}`);
    const response = isRecord(raw.response) ? raw.response : {};
    const textPath = String(response.textPath || '').trim();
    const template = String(response.template || '').trim();
    if (textPath && template) fail(`response selector conflict: ${id}`);
    if (!textPath && !template) fail(`response selector missing: ${id}`);
    serviceCommand = {
      id,
      provider: {
        method,
        url,
        ...(stringMap(provider.headers) ? { headers: stringMap(provider.headers) } : {}),
        ...(stringMap(provider.query) ? { query: stringMap(provider.query) } : {}),
        ...(stringMap(provider.body) ? { body: stringMap(provider.body) } : {}),
        timeout_ms: Math.max(1000, Math.min(Number(provider.timeoutMs || 5000), 15000))
      },
      response: template ? { template } : { text_path: textPath },
      fallback_text: clientCommand.fallbackText,
      snapshot_seconds: 3600
    };
  }
  return { clientCommand, serviceCommand, alreadyIntranet: provider.type === 'intranet' };
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeAtomic(target, value) {
  const resolved = path.resolve(target);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, resolved);
  return resolved;
}

export function migrateDynamicCommands(rawConfig) {
  if (!isRecord(rawConfig)) fail('input config must be an object');
  const commands = Array.isArray(rawConfig.commands) ? rawConfig.commands : [];
  const seen = new Set();
  const migrated = commands.map((command) => normalizeCommand(command, seen));
  const clientConfig = { version: '2.0.0', commands: migrated.map((item) => item.clientCommand) };
  const serviceCatalog = { schema: SERVICE_SCHEMA, commands: migrated.map((item) => item.serviceCommand).filter(Boolean) };
  const report = {
    schema: 'groupguard-dynamic-http-migration-report.v1',
    generated_at: new Date().toISOString(),
    counts: {
      total: migrated.length,
      migrated_http: migrated.filter((item) => !!item.serviceCommand).length,
      already_intranet: migrated.filter((item) => item.alreadyIntranet).length
    },
    command_ids: migrated.map((item) => item.clientCommand.id),
    client_sha256: sha256(canonical(clientConfig)),
    service_sha256: sha256(canonical(serviceCatalog))
  };
  return { clientConfig, serviceCatalog, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/migrate-dynamic-http-to-intranet.mjs --input commands.json --client-out commands.intranet.json --service-out dynamic-query-providers.json [--report-out report.json] [--apply]');
    process.exitCode = 2;
    return;
  }
  const input = path.resolve(args.input);
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const migrated = migrateDynamicCommands(raw);
  const clientOut = args.apply ? input : path.resolve(args.clientOut || `${input}.intranet.json`);
  const serviceOut = path.resolve(args.serviceOut || path.join(path.dirname(input), 'dynamic-query-providers.json'));
  const reportOut = path.resolve(args.reportOut || `${serviceOut}.migration-report.json`);
  let backup = '';
  if (args.apply) {
    backup = `${input}.before-intranet-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.copyFileSync(input, backup, fs.constants.COPYFILE_EXCL);
  }
  const clientPath = writeAtomic(clientOut, migrated.clientConfig);
  const servicePath = writeAtomic(serviceOut, migrated.serviceCatalog);
  const reportPath = writeAtomic(reportOut, { ...migrated.report, input, backup, client_path: clientPath, service_path: servicePath });
  console.log(JSON.stringify({ ok: true, client: clientPath, service: servicePath, report: reportPath, backup, counts: migrated.report.counts }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
