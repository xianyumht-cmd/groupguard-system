import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changed = [];

function absolute(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(absolute(rel), 'utf8');
}

function write(rel, value) {
  const target = absolute(rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === value) return;
  fs.writeFileSync(target, value, 'utf8');
  changed.push(rel);
}

function replaceOnce(rel, before, after, label = rel) {
  const source = read(rel);
  if (source.includes(after)) return;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`patch target missing: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`patch target not unique: ${label}`);
  write(rel, source.slice(0, first) + after + source.slice(first + before.length));
}

function replaceRegex(rel, regex, replacement, marker, label = rel) {
  const source = read(rel);
  if (marker && source.includes(marker)) return;
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`regex target count ${matches.length}: ${label}`);
  write(rel, source.replace(regex, replacement));
}

function appendBefore(rel, needle, addition, marker, label = rel) {
  const source = read(rel);
  if (marker && source.includes(marker)) return;
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`append target missing: ${label}`);
  write(rel, source.slice(0, index) + addition + source.slice(index));
}

const p = (rel) => `onebot-plugin-groupguard/${rel}`;

// GG-BUG-002 / 003: awaitable, retryable command initialization.
replaceRegex(
  p('src/commands.ts'),
  /let commandValidationRan = false;[\s\S]*?export async function handleCommand/,
  `let commandValidationRan = false;\nlet commandInitializationPromise: Promise<void> | null = null;\n\nexport async function initCommandValidation(): Promise<void> {\n  if (commandValidationRan) return;\n  if (commandInitializationPromise) return commandInitializationPromise;\n\n  commandInitializationPromise = (async () => {\n    registerIntranetQueryCommandPlugins();\n    registerIntranetBattleCommandPlugins();\n    registerIntranetRiskCommandPlugins();\n    registerLegacyRuntimePlugins();\n    registerSendWrapperCommandPlugins();\n    registerEleBuildCommandPlugins();\n    registerSubGameplayCommandPlugins();\n    await initializeDynamicCommands();\n    refreshCommandPluginRegistry();\n    assertCommandPluginRegistryReady();\n    refreshDynamicCommandRegistry();\n    await initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));\n    commandValidationRan = true;\n  })();\n\n  try {\n    await commandInitializationPromise;\n  } catch (error) {\n    commandValidationRan = false;\n    commandInitializationPromise = null;\n    throw error;\n  }\n}\n\nexport async function handleCommand`,
  'commandInitializationPromise',
  'commands async initialization'
);
replaceOnce(
  p('src/commands.ts'),
  `  initCommandValidation();\n  try {`,
  `  await initCommandValidation();\n  try {`,
  'handleCommand awaits command init'
);
replaceOnce(
  p('src/index.ts'),
  `  initCommandValidation();`,
  `  await initCommandValidation();`,
  'plugin init awaits command init'
);

// GG-BUG-010 / 011 / 012: strict propagation and coordinated JSON + SQLite persistence.
replaceRegex(
  p('src/commands/common.ts'),
  /export function saveConfig\(ctx: NapCatPluginContext\): void \{[\s\S]*?export async function sendGroupScene/,
  `export function saveConfig(ctx: NapCatPluginContext): void {\n  if (!ctx?.configPath) return;\n  try {\n    saveConfigStrict(ctx);\n  } catch (e) {\n    loggingStateService.error(\`保存配置失败: \${e}\`);\n    throw e;\n  }\n}\n\nexport function saveConfigStrict(ctx: NapCatPluginContext): void {\n  if (!ctx?.configPath) throw new Error('missing_config_path');\n  const config = configStateService.getConfig();\n  const mainConfig = { ...config, groups: {} };\n  const serialized = JSON.stringify(mainConfig, null, 2);\n  const existed = fs.existsSync(ctx.configPath);\n  const previous = existed ? fs.readFileSync(ctx.configPath, 'utf-8') : null;\n\n  try {\n    storageAdapter.replaceAllGroupConfigs(config.groups || {}, () => {\n      writeTextFileAtomically(ctx.configPath, serialized);\n    });\n  } catch (error) {\n    try {\n      if (previous !== null) writeTextFileAtomically(ctx.configPath, previous);\n      else if (!existed && fs.existsSync(ctx.configPath)) fs.unlinkSync(ctx.configPath);\n    } catch (restoreError) {\n      loggingStateService.error(\`配置回滚失败: \${restoreError}\`);\n    }\n    throw error;\n  }\n}\n\nexport async function sendGroupScene`,
  'replaceAllGroupConfigs',
  'strict coordinated config save'
);

replaceRegex(
  p('src/storage_adapter.ts'),
  /  init\(configDir: string\): void \{[\s\S]*?  private assertReady\(\): SqliteDb \{/,
  `  init(configDir: string): void {\n    const nextDataDir = path.resolve(contextStateService.getDataDir() || path.join(configDir, 'data'));\n    const nextDbPath = path.join(nextDataDir, 'groupguard.db');\n    if (this.inited && this.db && this.dbPath === nextDbPath) return;\n    if (this.inited) this.close();\n    this.dataDir = nextDataDir;\n    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });\n    this.dbPath = nextDbPath;\n    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');\n    this.db = new DatabaseSync(this.dbPath);\n    this.db.exec(SCHEMA_SQL);\n    this.inited = true;\n  }\n\n  close(): void {\n    try { this.db?.close?.(); } finally {\n      this.db = null;\n      this.inited = false;\n      this.dbPath = '';\n      this.dataDir = '';\n    }\n  }\n\n  private assertReady(): SqliteDb {`,
  'close(): void',
  'storage rebind and close'
);

replaceRegex(
  p('src/storage_adapter.ts'),
  /  saveGroupConfig\(groupId: string, cfg: GroupGuardSettings\): void \{[\s\S]*?  loadAllGroupConfigs\(\): Record<string, GroupGuardSettings> \{/,
  `  private saveGroupConfigUnsafe(groupId: string, cfg: GroupGuardSettings): void {\n    const db = this.assertReady();\n    const now = Date.now();\n    const qaList = Array.isArray((cfg as any).qaList) ? (cfg as any).qaList : [];\n    const configToSave: any = { ...(cfg as any) };\n    delete configToSave.qaList;\n    db.prepare('INSERT OR REPLACE INTO group_config(group_id, config_json, updated_at) VALUES (?, ?, ?)').run(groupId, JSON.stringify(configToSave), now);\n    db.prepare('DELETE FROM group_qa WHERE group_id = ?').run(groupId);\n    const stmt = db.prepare('INSERT OR REPLACE INTO group_qa(group_id, keyword, mode, reply, updated_at) VALUES (?, ?, ?, ?, ?)');\n    for (const qa of qaList) {\n      stmt.run(groupId, String(qa.keyword || ''), String(qa.mode || 'exact'), String(qa.reply || ''), now);\n    }\n  }\n\n  saveGroupConfig(groupId: string, cfg: GroupGuardSettings): void {\n    this.runInTransaction(() => this.saveGroupConfigUnsafe(groupId, cfg));\n  }\n\n  deleteGroupConfig(groupId: string): void {\n    const db = this.assertReady();\n    this.runInTransaction(() => {\n      db.prepare('DELETE FROM group_qa WHERE group_id = ?').run(groupId);\n      db.prepare('DELETE FROM group_config WHERE group_id = ?').run(groupId);\n    });\n  }\n\n  replaceAllGroupConfigs(groups: Record<string, GroupGuardSettings>, beforeCommit?: () => void): void {\n    const db = this.assertReady();\n    const ids = Object.keys(groups || {});\n    this.runInTransaction(() => {\n      for (const gid of ids) {\n        const cfg = groups[gid];\n        if (cfg) this.saveGroupConfigUnsafe(gid, cfg);\n      }\n      if (ids.length === 0) {\n        db.prepare('DELETE FROM group_qa').run();\n        db.prepare('DELETE FROM group_config').run();\n      } else {\n        const placeholders = ids.map(() => '?').join(',');\n        db.prepare(\`DELETE FROM group_qa WHERE group_id NOT IN (\${placeholders})\`).run(...ids);\n        db.prepare(\`DELETE FROM group_config WHERE group_id NOT IN (\${placeholders})\`).run(...ids);\n      }\n      beforeCommit?.();\n    });\n  }\n\n  saveGroupConfigs(groups: Record<string, GroupGuardSettings>): void {\n    this.replaceAllGroupConfigs(groups);\n  }\n\n  loadAllGroupConfigs(): Record<string, GroupGuardSettings> {`,
  'replaceAllGroupConfigs(groups',
  'storage replace all groups'
);

replaceOnce(
  p('src/storage_adapter.ts'),
  `      try {\n        cfg = JSON.parse(String(row.config_json || '{}'));\n      } catch {\n        cfg = {};\n      }`,
  `      try {\n        cfg = JSON.parse(String(row.config_json || '{}'));\n      } catch (error) {\n        throw new Error(\`invalid_group_config_json:\${gid}\`, { cause: error });\n      }`,
  'corrupt sqlite group config fail closed'
);
replaceOnce(
  p('src/storage_adapter.ts'),
  `function readJsonFile(filePath: string): any {\n  if (!fs.existsSync(filePath)) return null;\n  try {\n    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));\n  } catch {\n    return null;\n  }\n}`,
  `function readJsonFile(filePath: string): any {\n  if (!fs.existsSync(filePath)) return null;\n  try {\n    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));\n  } catch (error) {\n    throw new Error(\`invalid_migration_json:\${filePath}\`, { cause: error });\n  }\n}`,
  'migration invalid json must abort'
);

replaceOnce(
  p('src/standalone/admin/group_api.ts'),
  `  configStateService.deleteGroupSettings(id);\n  saveConfigStrict(options.ctx);`,
  `  configStateService.deleteGroupSettings(id);\n  saveConfigStrict(options.ctx);`,
  'group delete persisted through replace-all'
);

// GG-BUG-013 / 027 / 044: finite numeric normalization and retired public defaults.
replaceOnce(
  p('src/config.ts'),
  `  const inputVersion = Number((input as any)?.configVersion || 1);`,
  `  const rawInputVersion = Number((input as any)?.configVersion);\n  const inputVersion = Number.isFinite(rawInputVersion) && rawInputVersion > 0 ? rawInputVersion : 1;`,
  'finite config version'
);
replaceOnce(
  p('src/config.ts'),
  `  shardDataUrl: 'https://raw.githubusercontent.com/badspacebar/release/master/files/shards.json',`,
  `  shardDataUrl: '',`,
  'remove public shard default'
);
replaceOnce(
  p('src/config.ts'),
  `  merged.global.auditRetentionMaxAgeDays = Math.max(1, Math.min(3650, Number(merged.global.auditRetentionMaxAgeDays || 30)));\n  merged.global.auditRetentionMaxRows = Math.max(100, Math.min(1000000, Number(merged.global.auditRetentionMaxRows || 20000)));\n  merged.global.actionQueueEventRetentionMaxAgeDays = Math.max(1, Math.min(3650, Number(merged.global.actionQueueEventRetentionMaxAgeDays || 7)));\n  merged.global.actionQueueEventRetentionMaxRows = Math.max(100, Math.min(1000000, Number(merged.global.actionQueueEventRetentionMaxRows || 50000)));`,
  `  merged.global.auditRetentionMaxAgeDays = normalizeNumber(merged.global.auditRetentionMaxAgeDays, 30, 1, 3650);\n  merged.global.auditRetentionMaxRows = normalizeNumber(merged.global.auditRetentionMaxRows, 20000, 100, 1000000);\n  merged.global.actionQueueEventRetentionMaxAgeDays = normalizeNumber(merged.global.actionQueueEventRetentionMaxAgeDays, 7, 1, 3650);\n  merged.global.actionQueueEventRetentionMaxRows = normalizeNumber(merged.global.actionQueueEventRetentionMaxRows, 50000, 100, 1000000);`,
  'finite retention settings'
);
replaceOnce(
  p('src/config.ts'),
  `  merged.scammerMaxRecords = Math.max(100, Math.min(100000, Number(merged.scammerMaxRecords || 5000)));\n  merged.scammerMaxEvidenceLength = Math.max(50, Math.min(5000, Number(merged.scammerMaxEvidenceLength || 500)));\n  merged.scammerMaxRecentReportsPerQQ = Math.max(1, Math.min(50, Number(merged.scammerMaxRecentReportsPerQQ || 10)));\n  merged.scammerQueryUserCooldownSeconds = Math.max(0, Math.min(3600, Number(merged.scammerQueryUserCooldownSeconds ?? 10)));\n  merged.scammerQueryGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Number(merged.scammerQueryGroupRateLimitPerMinute ?? 20)));\n  merged.scammerQueryCacheSeconds = Math.max(0, Math.min(86400, Number(merged.scammerQueryCacheSeconds ?? 300)));\n  merged.scammerReportUserCooldownSeconds = Math.max(0, Math.min(86400, Number(merged.scammerReportUserCooldownSeconds ?? 60)));\n  merged.scammerReportGroupRateLimitPerMinute = Math.max(1, Math.min(1000, Number(merged.scammerReportGroupRateLimitPerMinute ?? 5)));\n  merged.scammerReportUserDailyLimit = Math.max(1, Math.min(1000, Number(merged.scammerReportUserDailyLimit ?? 20)));\n  merged.scammerReportDedupHours = Math.max(0, Math.min(720, Number(merged.scammerReportDedupHours ?? 24)));`,
  `  merged.scammerMaxRecords = normalizeNumber(merged.scammerMaxRecords, 5000, 100, 100000);\n  merged.scammerMaxEvidenceLength = normalizeNumber(merged.scammerMaxEvidenceLength, 500, 50, 5000);\n  merged.scammerMaxRecentReportsPerQQ = normalizeNumber(merged.scammerMaxRecentReportsPerQQ, 10, 1, 50);\n  merged.scammerQueryUserCooldownSeconds = normalizeNumber(merged.scammerQueryUserCooldownSeconds, 10, 0, 3600);\n  merged.scammerQueryGroupRateLimitPerMinute = normalizeNumber(merged.scammerQueryGroupRateLimitPerMinute, 20, 1, 1000);\n  merged.scammerQueryCacheSeconds = normalizeNumber(merged.scammerQueryCacheSeconds, 300, 0, 86400);\n  merged.scammerReportUserCooldownSeconds = normalizeNumber(merged.scammerReportUserCooldownSeconds, 60, 0, 86400);\n  merged.scammerReportGroupRateLimitPerMinute = normalizeNumber(merged.scammerReportGroupRateLimitPerMinute, 5, 1, 1000);\n  merged.scammerReportUserDailyLimit = normalizeNumber(merged.scammerReportUserDailyLimit, 20, 1, 1000);\n  merged.scammerReportDedupHours = normalizeNumber(merged.scammerReportDedupHours, 24, 0, 720);`,
  'finite scammer settings'
);

// GG-BUG-014 / 015 / 028 / 029: fail-closed mirror configuration and durable state.
replaceOnce(
  p('src/services/group_file_mirror_service.ts'),
  `    const fileNamePattern = String(raw.fileNamePattern ?? raw.file_name_pattern ?? '').trim();\n    rules.push({\n      id,\n      enabled: raw.enabled !== false,`,
  `    const fileNamePattern = String(raw.fileNamePattern ?? raw.file_name_pattern ?? '').trim();\n    const patternValid = isValidPattern(fileNamePattern);\n    rules.push({\n      id,\n      enabled: raw.enabled !== false && patternValid,`,
  'invalid mirror regex disables rule'
);
replaceOnce(
  p('src/services/group_file_mirror_service.ts'),
  `      fileNamePattern: isValidPattern(fileNamePattern) ? fileNamePattern : '',`,
  `      fileNamePattern,`,
  'preserve invalid regex for diagnosis'
);
replaceOnce(
  p('src/services/group_file_mirror_service.ts'),
  `  private loadedStatePath = '';\n  private readonly recentMessages`,
  `  private loadedStatePath = '';\n  private stateWritable = true;\n  private readonly recentMessages`,
  'mirror state writable guard'
);
replaceRegex(
  p('src/services/group_file_mirror_service.ts'),
  /  private ensureStateLoaded\(\): void \{[\s\S]*?  private saveState\(\): void \{[\s\S]*?\n  \}/,
  `  private ensureStateLoaded(): void {\n    const filePath = this.getStateFilePath();\n    if (this.loadedStatePath === filePath) return;\n    this.loadedStatePath = filePath;\n    this.state = { version: 1, rules: {} };\n    this.stateWritable = true;\n    try {\n      if (!fs.existsSync(filePath)) return;\n      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));\n      if (!isRecord(parsed) || !isRecord(parsed.rules)) throw new Error('invalid_state_shape');\n      this.state = { version: 1, rules: parsed.rules as Record<string, MirrorRuleState> };\n    } catch (error) {\n      const backupPath = \`\${filePath}.corrupt-\${new Date().toISOString().replace(/[:.]/g, '-')}-.bak\`;\n      try { fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL); } catch { /* preserve original even if backup fails */ }\n      this.stateWritable = false;\n      this.config = { ...this.config, enabled: false };\n      this.log('error', \`状态文件损坏，群文件搬运已停用且不会覆盖原文件: \${String(error)}\`);\n    }\n  }\n\n  private saveState(): void {\n    this.ensureStateLoaded();\n    if (!this.stateWritable) throw new Error('group_file_mirror_state_not_writable');\n    const filePath = this.getStateFilePath();\n    fs.mkdirSync(path.dirname(filePath), { recursive: true });\n    const tempPath = \`\${filePath}.\${process.pid}.\${Date.now()}.tmp\`;\n    try {\n      fs.writeFileSync(tempPath, \`\${JSON.stringify(this.state, null, 2)}\\n\`, 'utf-8');\n      fs.renameSync(tempPath, filePath);\n    } catch (error) {\n      try { fs.unlinkSync(tempPath); } catch { /* noop */ }\n      this.log('error', \`状态文件保存失败: \${String(error)}\`);\n      throw error;\n    }\n  }`,
  'group_file_mirror_state_not_writable',
  'mirror corrupt state protection'
);
replaceRegex(
  p('src/services/group_file_mirror_service.ts'),
  /          if \(targetFileId && file\.fileId && targetFileId === file\.fileId\) return true;\n            return file\.fileName === fileName && \(fileSize <= 0 \|\| file\.fileSize <= 0 \|\| file\.fileSize === fileSize\);/,
  `          return Boolean(targetFileId && file.fileId && targetFileId === file.fileId);`,
  'Boolean(targetFileId && file.fileId',
  'mirror history strong identity only'
);

// GG-BUG-016 / 017 / 018 / 043: usable token, bounded body, authenticated pages, single save path.
replaceRegex(
  p('src/standalone/admin/http.ts'),
  /export function readBody\(req: IncomingMessage\): Promise<string> \{[\s\S]*?\n\}/,
  `export class HttpBodyTooLargeError extends Error {\n  readonly statusCode = 413;\n  constructor() { super('请求体过大'); }\n}\n\nexport function readBody(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {\n  return new Promise((resolve, reject) => {\n    const chunks: Buffer[] = [];\n    let bytes = 0;\n    let settled = false;\n    const cleanup = () => {\n      req.off('data', onData);\n      req.off('end', onEnd);\n      req.off('error', onError);\n    };\n    const fail = (error: Error) => {\n      if (settled) return;\n      settled = true;\n      cleanup();\n      req.pause();\n      reject(error);\n    };\n    const onData = (chunk: Buffer | string) => {\n      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);\n      bytes += buffer.length;\n      if (bytes > maxBytes) {\n        fail(new HttpBodyTooLargeError());\n        return;\n      }\n      chunks.push(buffer);\n    };\n    const onEnd = () => {\n      if (settled) return;\n      settled = true;\n      cleanup();\n      resolve(Buffer.concat(chunks, bytes).toString('utf-8'));\n    };\n    const onError = (error: Error) => fail(error);\n    req.on('data', onData);\n    req.on('end', onEnd);\n    req.on('error', onError);\n  });\n}`,
  'HttpBodyTooLargeError',
  'bounded request body'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `import fs from 'fs';\nimport { URL } from 'node:url';`,
  `import fs from 'fs';\nimport path from 'node:path';\nimport { URL } from 'node:url';`,
  'server path import'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `import { readBody, send, sendBuffer, sendJson } from './http';`,
  `import { HttpBodyTooLargeError, readBody, send, sendBuffer, sendJson } from './http';`,
  'server body error import'
);
replaceRegex(
  p('src/standalone/admin/server.ts'),
  /function resolveServerConfig\(options: SnowLumaAdminServerOptions\) \{[\s\S]*?\n\}/,
  `function resolveServerConfig(options: SnowLumaAdminServerOptions) {\n  const host = options.host || process.env.GROUPGUARD_WEBUI_HOST || '127.0.0.1';\n  const parsedPort = options.port || Number(process.env.GROUPGUARD_WEBUI_PORT || 6108);\n  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6108;\n  const configuredToken = String(options.token || process.env.GROUPGUARD_WEBUI_TOKEN || '').trim();\n  const tokenPath = path.join(options.dataDir, '.groupguard-webui-token');\n  let token = configuredToken;\n  let tokenSource = configuredToken ? 'configuration' : 'file';\n  if (!token) {\n    try { token = fs.readFileSync(tokenPath, 'utf-8').trim(); } catch { /* create below */ }\n  }\n  if (!token) {\n    token = createToken();\n    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });\n    fs.writeFileSync(tokenPath, \`\${token}\\n\`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });\n    tokenSource = 'generated_file';\n  }\n  if (!token) throw new Error('groupguard_webui_token_unavailable');\n  return { host, port, token, tokenSource, tokenPath };\n}`,
  'tokenSource',
  'persistent webui token'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `  const { host, port, token, tokenFromEnv } = resolveServerConfig(options);`,
  `  const { host, port, token, tokenSource, tokenPath } = resolveServerConfig(options);`,
  'server token source'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `    try {\n      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {`,
  `    try {\n      if (!requireAuth(req, res, url, token)) return;\n\n      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {`,
  'authenticate pages before rendering'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `\n      if (!requireAuth(req, res, url, token)) return;\n\n      if (req.method === 'GET' && url.pathname === '/api/group-file-mirror') {`,
  `\n      if (req.method === 'GET' && url.pathname === '/api/group-file-mirror') {`,
  'remove duplicate auth'
);
replaceOnce(
  p('src/standalone/admin/server.ts'),
  `      const statusCode = error instanceof GroupFileMirrorConfigError ? 400 : 500;`,
  `      const statusCode = error instanceof HttpBodyTooLargeError ? 413 : error instanceof GroupFileMirrorConfigError ? 400 : 500;`,
  'return 413 for oversized body'
);
replaceRegex(
  p('src/standalone/admin/server.ts'),
  /    if \(tokenFromEnv\) \{[\s\S]*?    \}/,
  `    logger.info(\`[GroupGuard:SnowLumaWebUI] authentication token source=\${tokenSource}\`);\n    if (tokenSource === 'generated_file') logger.warn(\`[GroupGuard:SnowLumaWebUI] generated token stored with mode 0600 at \${tokenPath}\`);`,
  'authentication token source=',
  'webui token startup log'
);
replaceOnce(
  p('src/standalone/admin/config_api.ts'),
  `import { ensureObjectConfig, readJsonFile, writeJsonFile } from './json_file';`,
  `import { ensureObjectConfig, readJsonFile } from './json_file';`,
  'remove raw pre-write import'
);
replaceRegex(
  p('src/standalone/admin/config_api.ts'),
  /export function saveRawConfig\(options: SnowLumaAdminServerOptions, nextConfig: any\): void \{[\s\S]*?\n\}/,
  `export function saveRawConfig(options: SnowLumaAdminServerOptions, nextConfig: any): void {\n  const configObject = ensureObjectConfig(nextConfig);\n  const normalized = normalizePluginConfig(configObject as any);\n  const previous = configStateService.getConfig();\n  backupFile(options.configPath, options.backupDir, 'config.json');\n  try {\n    configStateService.setConfig(normalized);\n    saveConfigStrict(options.ctx);\n  } catch (error) {\n    configStateService.setConfig(previous);\n    throw error;\n  }\n}`,
  'const normalized = normalizePluginConfig',
  'single validated config save path'
);
replaceRegex(
  p('src/standalone/admin/json_file.ts'),
  /export function writeJsonFile\(filePath: string, value: any\): void \{[\s\S]*?\n\}/,
  `export function writeJsonFile(filePath: string, value: any): void {\n  ensureDir(path.dirname(filePath));\n  const tempPath = path.join(path.dirname(filePath), \`.\${path.basename(filePath)}.\${process.pid}.\${Date.now()}.tmp\`);\n  try {\n    fs.writeFileSync(tempPath, \`\${JSON.stringify(value, null, 2)}\\n\`, 'utf-8');\n    fs.renameSync(tempPath, filePath);\n  } catch (error) {\n    try { fs.unlinkSync(tempPath); } catch { /* noop */ }\n    throw error;\n  }\n}`,
  'const tempPath = path.join',
  'atomic json file write'
);

// GG-BUG-019 / 034 / 044: strict private endpoint and streaming response limit.
replaceRegex(
  p('src/services/groupguard_query_delivery_client.ts'),
  /export function isIntranetHostname\(hostname: string\): boolean \{[\s\S]*?\n\}/,
  `export function isIntranetHostname(hostname: string): boolean {\n  const host = String(hostname || '').trim().toLowerCase().replace(/^\\[|\\]$/g, '');\n  if (!host) return false;\n  if (host === 'localhost' || host === '::1') return true;\n  if (/^127(?:\\.\\d{1,3}){3}$/.test(host)) return true;\n  if (/^10(?:\\.\\d{1,3}){3}$/.test(host)) return true;\n  if (/^192\\.168(?:\\.\\d{1,3}){2}$/.test(host)) return true;\n  const match172 = host.match(/^172\\.(\\d{1,3})(?:\\.\\d{1,3}){2}$/);\n  if (match172) {\n    const second = Number(match172[1]);\n    if (second >= 16 && second <= 31) return true;\n  }\n  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;\n  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;\n  return false;\n}`,
  "replace(/^\\[|\\]$/g, '')",
  'strict intranet host validation'
);
appendBefore(
  p('src/services/groupguard_query_delivery_client.ts'),
  `export async function requestGroupGuardQueryDelivery(`,
  `async function readResponseTextBounded(response: Response, maxBytes: number): Promise<string> {\n  if (!response.body) return '';\n  const reader = response.body.getReader();\n  const decoder = new TextDecoder();\n  const chunks: string[] = [];\n  let bytes = 0;\n  try {\n    while (true) {\n      const { done, value } = await reader.read();\n      if (done) break;\n      bytes += value.byteLength;\n      if (bytes > maxBytes) {\n        await reader.cancel('delivery_response_too_large');\n        throw new Error('delivery_response_too_large');\n      }\n      chunks.push(decoder.decode(value, { stream: true }));\n    }\n    chunks.push(decoder.decode());\n    return chunks.join('');\n  } finally {\n    reader.releaseLock();\n  }\n}\n\n`,
  'readResponseTextBounded',
  'bounded response reader'
);
replaceOnce(
  p('src/services/groupguard_query_delivery_client.ts'),
  `    const text = await response.text();\n    if (text.length > maxResponseChars) throw new Error('delivery_response_too_large');`,
  `    const text = await readResponseTextBounded(response, maxResponseChars);`,
  'stream query response'
);
replaceOnce(
  p('src/services/groupguard_query_delivery_client.ts'),
  `  | 'video'\n`,
  ``,
  'remove retired video feature type'
);

// GG-BUG-001 / 009 / 030 / 031 / 033 / 020: gated startup, fail-closed join checks, bounded mirror dedup, fatal exit.
replaceRegex(
  p('src/standalone/snowluma_service.ts'),
  /  client\.onEvent\(async \(event\) => \{[\s\S]*?  \}\);\n\n  const refreshBotIdentity/,
  `  let runtimeReady = false;\n  const pendingEvents: any[] = [];\n  const MAX_PENDING_EVENTS = 500;\n  const dispatchEvent = async (event: any): Promise<void> => {\n    if (!event || typeof event !== 'object') return;\n    const eventSelfId = String(event.self_id || '').trim();\n    if (eventSelfId && eventSelfId !== identityStateService.getBotId()) contextStateService.setBotId(eventSelfId);\n    if (!consumeGeneratedUploadEvent(event)) groupFileMirrorService.observeEvent(event);\n    if (isMessageEvent(event)) {\n      observeQunGuanjiaRealtimeMessage(event);\n      await plugin_onmessage(ctx, event as any);\n      return;\n    }\n    await plugin_onevent(ctx, event);\n  };\n\n  client.onEvent(async (event) => {\n    if (!runtimeReady) {\n      if (pendingEvents.length >= MAX_PENDING_EVENTS) pendingEvents.shift();\n      pendingEvents.push(event);\n      return;\n    }\n    await dispatchEvent(event);\n  });\n\n  const refreshBotIdentity`,
  'MAX_PENDING_EVENTS',
  'snowluma startup event gate'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `      const key = generatedUploadKey(raw.group_id ?? raw.groupId, raw.name);\n      if (key) generatedFileUploads.set(key, Date.now() + GENERATED_FILE_UPLOAD_TTL_MS);`,
  `      pruneGeneratedUploads();\n      const key = generatedUploadKey(raw.group_id ?? raw.groupId, raw.name);\n      if (key) {\n        if (generatedFileUploads.size >= 2000) generatedFileUploads.delete(generatedFileUploads.keys().next().value);\n        generatedFileUploads.set(key, Date.now() + GENERATED_FILE_UPLOAD_TTL_MS);\n      }`,
  'bounded generated upload map'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `    const key = generatedUploadKey(event?.group_id, event?.file?.name ?? event?.file?.file_name);\n    if (!key || !generatedFileUploads.has(key)) return false;`,
  `    const uploaderId = String(event?.user_id ?? event?.operator_id ?? '').trim();\n    const botId = identityStateService.getBotId();\n    if (!botId || uploaderId !== botId) return false;\n    const key = generatedUploadKey(event?.group_id, event?.file?.name ?? event?.file?.file_name);\n    if (!key || !generatedFileUploads.has(key)) return false;`,
  'generated upload requires bot uploader'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `  await client.start();\n  await plugin_init(ctx);`,
  `  await plugin_init(ctx);\n  await client.start();\n  await refreshBotIdentity();\n  runtimeReady = true;\n  for (const event of pendingEvents.splice(0)) await dispatchEvent(event);`,
  'initialize before consuming events'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `async function stop(signal: string): Promise<void> {`,
  `async function stop(signal: string, exitCode = 0): Promise<void> {`,
  'stop exit code'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `  process.exit(0);`,
  `  process.exit(exitCode);`,
  'stop uses exit code'
);
replaceOnce(
  p('src/standalone/snowluma_service.ts'),
  `process.on('uncaughtException', (error) => {\n  console.error(\`[GroupGuard:SnowLuma] uncaughtException: \${String(error)}\`);\n});`,
  `process.on('uncaughtException', (error) => {\n  console.error(\`[GroupGuard:SnowLuma] uncaughtException: \${String(error)}\`);\n  void stop('uncaughtException', 1);\n});`,
  'fatal uncaught exception exit'
);

replaceOnce(
  p('src/runtime/runtime_event_pipeline.ts'),
  `    const isAdmin = await authStateService.isBotAdmin(groupId);\n    if (!isAdmin) {\n      loggingStateService.debug(\`机器人在群 \${groupId} 不是管理员，跳过验证\`);\n      return;\n    }`,
  `    let isAdmin = false;\n    let adminStatusKnown = true;\n    try {\n      isAdmin = await authStateService.isBotAdmin(groupId);\n    } catch (error) {\n      adminStatusKnown = false;\n      loggingStateService.warn(\`机器人管理员状态查询失败，继续执行保护流程 group=\${groupId}: \${String(error)}\`);\n    }\n    if (!isAdmin && adminStatusKnown) {\n      loggingStateService.debug(\`机器人在群 \${groupId} 不是管理员，跳过需要管理员权限的验证\`);\n      return;\n    }`,
  'admin status unknown continues protection'
);
replaceRegex(
  p('src/runtime/runtime_event_pipeline.ts'),
  /    if \(!config\.blacklist\) config\.blacklist = \[\];[\s\S]*?      saveConfig\(ctx\);\n    \}/,
  `    if (globalLeave) {\n      if (!config.blacklist) config.blacklist = [];\n      if (!config.blacklist.includes(userId)) config.blacklist.push(userId);\n    } else if (groupLeave) {\n      const own = configStateService.getGroupSettings(groupId) || ({ useGlobal: false } as any);\n      own.useGlobal = false;\n      own.groupBlacklist = Array.from(new Set([...(own.groupBlacklist || []), userId]));\n      configStateService.setGroupSettings(groupId, own);\n    }\n    loggingStateService.info(\`退群拉黑: 用户 \${userId} 退出群 \${groupId}，已加入\${globalLeave ? '全局' : '本群'}黑名单\`);\n    saveConfig(ctx);`,
  '已加入${globalLeave',
  'leave blacklist scope'
);

// GG-BUG-032 / 033: await connected handlers and recover from socket errors.
replaceRegex(
  p('src/standalone/onebot_ws_client.ts'),
  /        const settleOk = \(\) => \{[\s\S]*?          resolve\(\);\n        \};/,
  `        const settleOk = () => {\n          if (settled) return;\n          settled = true;\n          clearTimeout(connectionTimer);\n          if (!this.started || this.manuallyClosed) {\n            try { ws.close(); } catch { /* noop */ }\n            reject(new Error('onebot_client_closed'));\n            return;\n          }\n          this.ws = ws;\n          this.connectedAt = Date.now();\n          this.lastError = '';\n          this.reconnectAttempts = 0;\n          this.bindSocket(ws);\n          void (async () => {\n            for (const handler of this.connectedHandlers) {\n              try { await handler(); }\n              catch (error) { this.options.logger?.warn?.(\`OneBot connected handler failed: \${this.safeError(error)}\`); }\n            }\n            this.options.logger?.info?.('OneBot WS connected');\n            resolve();\n          })();\n        };`,
  'for (const handler of this.connectedHandlers)',
  'await connected handlers'
);
replaceOnce(
  p('src/standalone/onebot_ws_client.ts'),
  `    ws.addEventListener('error', (event: any) => {\n      if (this.ws !== ws) return;\n      this.lastError = this.safeError(event?.error || 'websocket_error');\n      this.options.logger?.error?.(\`OneBot WS error: \${this.lastError}\`);\n    });`,
  `    ws.addEventListener('error', (event: any) => {\n      if (this.ws !== ws) return;\n      this.handleSocketFailure(ws, event?.error || 'websocket_error');\n    });`,
  'socket error triggers recovery'
);
appendBefore(
  p('src/standalone/onebot_ws_client.ts'),
  `  private scheduleReconnect(): void {`,
  `  private handleSocketFailure(ws: OneBotWebSocketLike, error: unknown): void {\n    if (this.ws !== ws) return;\n    this.lastError = this.safeError(error);\n    this.options.logger?.error?.(\`OneBot WS error: \${this.lastError}\`);\n    this.ws = null;\n    this.disconnectedAt = Date.now();\n    this.rejectPending(new Error('onebot_ws_error'));\n    try { ws.close(); } catch { /* noop */ }\n    this.scheduleReconnect();\n  }\n\n`,
  'handleSocketFailure',
  'socket failure helper'
);

// GG-BUG-004 / 005 / 006 / 021 / 022 / 023 / 036 / 037 / 044 in state.
replaceOnce(
  p('src/state.ts'),
  `import fs from 'fs';\nimport path from 'path';\nimport { fileURLToPath } from 'node:url';`,
  `import { getBuildInfo } from './build_info';`,
  'state build info import'
);
replaceRegex(
  p('src/state.ts'),
  /\/\/ 运行时从 package\.json 读取版本号[\s\S]*?return '1\.0\.0';\n\}/,
  `// Build metadata is embedded by Vite and is the single runtime version source.\nfunction getPluginVersion(): string {\n  return String(getBuildInfo().version || 'unknown');\n}`,
  'single runtime version source',
  'state version source'
);
replaceOnce(
  p('src/state.ts'),
  `  private selfRecallScheduleMap: Map<string, number> = new Map();`,
  `  private selfRecallScheduleMap: Map<string, number> = new Map();\n  private selfRecallTimers: Map<string, NodeJS.Timeout> = new Map();`,
  'self recall timer registry'
);
replaceOnce(
  p('src/state.ts'),
  `    if (max > min && max > 0) {\n      const delay = Math.floor(Math.random() * (max - min + 1)) + min;`,
  `    if (max >= min && max > 0) {\n      const delay = max === min ? min : Math.floor(Math.random() * (max - min + 1)) + min;`,
  'fixed random delay'
);
replaceOnce(
  p('src/state.ts'),
  `    setTimeout(() => {\n      import('./services/action_queue_service')`,
  `    const timer = setTimeout(() => {\n      this.selfRecallTimers.delete(dedupKey);\n      import('./services/action_queue_service')`,
  'track self recall timeout'
);
replaceOnce(
  p('src/state.ts'),
  `    }, delay);\n    return dueAt;\n  }\n\n  private applyReplyTemplate`,
  `    }, delay);\n    timer.unref?.();\n    this.selfRecallTimers.set(dedupKey, timer);\n    return dueAt;\n  }\n\n  clearSelfRecallTimers(): void {\n    for (const timer of this.selfRecallTimers.values()) clearTimeout(timer);\n    this.selfRecallTimers.clear();\n    this.selfRecallScheduleMap.clear();\n  }\n\n  private applyReplyTemplate`,
  'clearSelfRecallTimers',
  'clearable self recall timers'
);
replaceRegex(
  p('src/state.ts'),
  /        if \(this\.globalSendQueue\.length >= this\.getMaxQueueSizeGlobal\(\)\) \{[\s\S]*?        \}\n        this\.globalSendQueue\.push\(task\);/,
  `        if (this.globalSendQueue.length >= this.getMaxQueueSizeGlobal()) {\n          this.settleDroppedGroupTask(task, task.force ? 'send_queue_force_overflow' : 'send_queue_overflow');\n          return;\n        }\n        this.globalSendQueue.push(task);`,
  'send_queue_force_overflow',
  'do not evict global queue'
);
replaceRegex(
  p('src/state.ts'),
  /        if \(q\.length >= this\.getMaxQueueSizePerGroup\(\)\) \{[\s\S]*?        \}\n        q\.push\(task\);/,
  `        if (q.length >= this.getMaxQueueSizePerGroup()) {\n          this.settleDroppedGroupTask(task, task.force ? 'group_send_queue_force_overflow' : 'group_send_queue_overflow');\n          return;\n        }\n        q.push(task);`,
  'group_send_queue_force_overflow',
  'do not evict group queue'
);
replaceOnce(
  p('src/state.ts'),
  `    const force = options?.force !== false;`,
  `    const force = options?.force === true;`,
  'group text force defaults false'
);
replaceOnce(
  p('src/state.ts'),
  `    const force = options?.force !== false;`,
  `    const force = options?.force === true;`,
  'group array force defaults false'
);
replaceOnce(
  p('src/state.ts'),
  `    const force = options?.force !== false;`,
  `    const force = options?.force === true;`,
  'private force defaults false'
);
replaceOnce(
  p('src/state.ts'),
  `      this.recordBotSendEvent({\n        groupId: task.groupId,`,
  `      const sentAt = Date.now();\n      const selfRecallDueAt = this.scheduleSelfRecall(task.groupId, messageId, 'send_group_msg');\n      this.markGroupSend(task.groupId);\n      this.recordBotSendEvent({\n        groupId: task.groupId,`,
  'forward fallback participates in history and recall'
);
replaceOnce(
  p('src/state.ts'),
  `        sentAt: Date.now(),\n        status: 'sent',`,
  `        sentAt,\n        selfRecallDueAt,\n        status: 'sent',`,
  'forward fallback recall audit'
);
replaceOnce(
  p('src/state.ts'),
  `      const packed = packageForwardMessages(params.messages, settings, 'raw_text');`,
  `      const scene = String(params.__groupguard_scene || 'raw_text');\n      const packed = packageForwardMessages(params.messages, settings, scene);`,
  'forward API preserves scene'
);
replaceRegex(
  p('src/state.ts'),
  /      if \(action === 'delete_msg'\) \{[\s\S]*?          return null;\n      \}\n      \n      this\.log\('error'/,
  `      if (action === 'delete_msg') {\n        this.log('error', \`撤回消息 API 调用失败: \${errMsg}\`);\n        throw e;\n      }\n\n      this.log('error'`,
  '撤回消息 API 调用失败',
  'delete message failure propagation'
);
replaceRegex(
  p('src/state.ts'),
  /  async isBotAdmin \(groupId: string\): Promise<boolean> \{[\s\S]*?\n  \}/,
  `  async isBotAdmin(groupId: string): Promise<boolean> {\n    if (!this.botId) throw new Error('bot_identity_unavailable');\n    if (!this.actions || !this.networkConfig) throw new Error('group_send_transport_unavailable');\n    const info = await this.actions.call('get_group_member_info', { group_id: groupId, user_id: this.botId } as never, this.adapterName, this.networkConfig) as any;\n    return info?.role === 'admin' || info?.role === 'owner';\n  }`,
  'bot_identity_unavailable',
  'bot admin unknown is error'
);

replaceOnce(
  p('src/index.ts'),
  `    saveConfig(ctx);\n    // 顺便清理缓存`,
  `    try { saveConfig(ctx); } catch (error) { loggingStateService.error(\`后台保存配置失败: \${error}\`); }\n    // 顺便清理缓存`,
  'background save handles strict error'
);
replaceOnce(
  p('src/index.ts'),
  `  stopSelfRecallRecovery();`,
  `  stopSelfRecallRecovery();\n  configStateService.getConfig();\n  const { pluginState } = await import('./state');\n  pluginState.clearSelfRecallTimers();`,
  'cleanup self recall timers'
);
replaceOnce(
  p('src/index.ts'),
  `  cacheStateService.clearAdminCache();\n};`,
  `  cacheStateService.clearAdminCache();\n  storageAdapter.close();\n};`,
  'close storage on cleanup'
);

// GG-BUG-007 / 024 / 025: timeout ambiguity and correct queue policy/codes.
replaceRegex(
  p('src/services/action_queue_service.ts'),
  /async function executeWithTimeout<T>\(promise: Promise<T>, timeoutMs: number\): Promise<\{ timeout: boolean; value\?: T; \}> \{[\s\S]*?\n\}/,
  `async function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timeout: boolean; value?: T; error?: unknown; }> {\n  let timer: NodeJS.Timeout | null = null;\n  const valuePromise = promise.then(\n    (value) => ({ timeout: false, value }),\n    (error) => ({ timeout: false, error })\n  );\n  try {\n    const timeoutPromise = new Promise<{ timeout: boolean; value?: T; error?: unknown; }>((resolve) => {\n      timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);\n    });\n    return await Promise.race([valuePromise, timeoutPromise]);\n  } finally {\n    if (timer) clearTimeout(timer);\n    void valuePromise; // observe late completion/rejection; mutating actions are not retried on ambiguous timeout.\n  }\n}`,
  'error?: unknown',
  'observe late action completion'
);
replaceOnce(
  p('src/services/action_queue_service.ts'),
  `  const cap = Math.max(1, Math.min(20, getConcurrency(queue[0]?.groupId || '0')));`,
  `  const cap = Math.max(1, Math.min(20, getConcurrency('')));`,
  'global action queue concurrency'
);
appendBefore(
  p('src/services/action_queue_service.ts'),
  `export async function enqueueRecallAction`,
  `function mapEnqueueFailureCode(result: Exclude<ReturnType<typeof enqueueTask>, 'ok'>): string {\n  if (result === 'backpressure_reject') return 'backpressure_reject';\n  if (result === 'queue_overflow') return 'skip_queue_overflow';\n  if (result === 'skip_duplicate') return 'skip_duplicate';\n  if (result === 'bot_role_blocked') return 'bot_role_blocked';\n  return result;\n}\n\n`,
  'mapEnqueueFailureCode',
  'queue failure mapping helper'
);
replaceRegex(
  p('src/services/action_queue_service.ts'),
  /if \(enqueueResult !== 'ok'\) resolve\(\{ ok: false, code: enqueueResult === 'backpressure_reject' \? 'backpressure_reject' : '[^']+', taskId, actionId \}\);/g,
  `if (enqueueResult !== 'ok') resolve({ ok: false, code: mapEnqueueFailureCode(enqueueResult), taskId, actionId });`,
  'mapEnqueueFailureCode(enqueueResult), taskId, actionId',
  'exact ban kick enqueue codes'
);
replaceRegex(
  p('src/services/action_queue_service.ts'),
  /if \(enqueueResult !== 'ok'\) resolve\(\{ ok: false, code: enqueueResult === 'backpressure_reject' \? 'backpressure_reject' : 'skip_queue_overflow' \}\);/g,
  `if (enqueueResult !== 'ok') resolve({ ok: false, code: mapEnqueueFailureCode(enqueueResult) });`,
  'mapEnqueueFailureCode(enqueueResult) });',
  'exact queue failure codes'
);

// GG-BUG-038 / 044: forward risk scene and retired video scene.
replaceOnce(
  p('src/core/state-infra/plugin_state_context_adapter.ts'),
  `      next.messages = packageForwardMessages(next.messages, pluginState.getGroupSettings(groupId), 'raw_text').messages;`,
  `      const scene = this.getSendScene(params);\n      next.messages = packageForwardMessages(next.messages, pluginState.getGroupSettings(groupId), scene).messages;`,
  'forward wrapper preserves scene'
);
replaceOnce(
  p('src/core/state-infra/plugin_state_context_adapter.ts'),
  `    || key === 'video_query'\n`,
  ``,
  'remove retired video scene'
);

// GG-BUG-035 / 041 / 042: clean builds, no duplicate debug, synchronized badge.
replaceOnce(
  p('src/standalone/standalone_context.ts'),
  `    debug: (message: string) => logger.debug?.(message) ?? logger.info(message)`,
  `    debug: (message: string) => {\n      if (typeof logger.debug === 'function') logger.debug(message);\n      else logger.info(message);\n    }`,
  'standalone debug once'
);
replaceOnce(
  p('vite.config.ts'),
  `      emptyDirBeforeWrite: !isSnowLuma,`,
  `      emptyDirBeforeWrite: true,`,
  'clean every build output'
);
replaceRegex(
  'README.md',
  /version-1\.2\.14/g,
  'version-1.3.0',
  'version-1.3.0',
  'readme version badge'
);

// Build-all now merges two clean staging builds rather than relying on stale dist.
const buildAllScript = `import fs from 'node:fs';\nimport path from 'node:path';\nimport { spawnSync } from 'node:child_process';\nconst root = path.resolve(import.meta.dirname, '..');\nconst run = (args) => { const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };\nconst npmCli = process.env.npm_execpath;\nif (!npmCli) throw new Error('npm_execpath_missing');\nrun([npmCli, 'run', 'build:release']);\nconst napcat = path.join(root, '.dist-napcat-temp');\nfs.rmSync(napcat, { recursive: true, force: true });\nfs.renameSync(path.join(root, 'dist'), napcat);\nrun([npmCli, 'run', 'build:snowluma']);\nfs.cpSync(napcat, path.join(root, 'dist'), { recursive: true, force: false, errorOnExist: false });\nfs.rmSync(napcat, { recursive: true, force: true });\n`;
write(p('scripts/build-all-clean.mjs'), buildAllScript);

const verifier = `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport { normalizePluginConfig } from '../src/config';\nimport { normalizeGroupFileMirrorConfig } from '../src/services/group_file_mirror_service';\nimport { isIntranetHostname } from '../src/services/groupguard_query_delivery_client';\nconst invalid = normalizePluginConfig({ configVersion: 'bad', global: { auditRetentionMaxRows: 'bad' } } as any);\nassert.equal(invalid.configVersion, 8);\nassert.equal(invalid.global.auditRetentionMaxRows, 20000);\nconst mirror = normalizeGroupFileMirrorConfig({ enabled: true, rules: [{ sourceGroupId: '1', targetGroupId: '2', fileNamePattern: '[' }] });\nassert.equal(mirror.rules[0]?.enabled, false);\nassert.equal(isIntranetHostname('192.168.3.89'), true);\nassert.equal(isIntranetHostname('public-host'), false);\nassert.equal(isIntranetHostname('example.com'), false);\nconst root = path.resolve(import.meta.dirname, '..');\nconst state = fs.readFileSync(path.join(root, 'src/state.ts'), 'utf8');\nassert.ok(state.includes('const force = options?.force === true'));\nassert.ok(!state.includes("return '1.0.0'"));\nconsole.log('project-wide bugfix regression passed');\n`;
write(p('scripts/verify-project-wide-bugfixes.ts'), verifier);

// Update package scripts idempotently.
{
  const rel = p('package.json');
  const pkg = JSON.parse(read(rel));
  pkg.scripts['verify:project-wide-bugfixes'] = 'node --experimental-strip-types --import ./scripts/register-ts-loader.mjs scripts/verify-project-wide-bugfixes.ts';
  if (!pkg.scripts.test.includes('verify:project-wide-bugfixes')) pkg.scripts.test += ' && npm run verify:project-wide-bugfixes';
  pkg.scripts['build:all'] = 'node scripts/build-all-clean.mjs';
  write(rel, `${JSON.stringify(pkg, null, 2)}\n`);
}

// Update audit document with a machine-readable progress section.
{
  const rel = 'docs/PROJECT_WIDE_BUG_AUDIT_20260801.md';
  let doc = read(rel);
  const marker = '## 0. 修复执行状态';
  if (!doc.includes(marker)) {
    doc = doc.replace('# GroupGuard 全仓 Bug 审计与缺陷台账（2026-08-01）\n', `# GroupGuard 全仓 Bug 审计与缺陷台账（2026-08-01）\n\n${marker}\n\n- 修复分支：\`fix/project-wide-bugs-20260801\`\n- 状态：代码修复已应用，等待 CI 与真实 SnowLuma/QQ 环境验收。\n- 原则：源码可确认项必须有自动回归；环境依赖项在未实机验收前保持“待验证”，不得伪报已闭环。\n`);
    write(rel, doc);
  }
}

console.log(JSON.stringify({ ok: true, changed }, null, 2));
