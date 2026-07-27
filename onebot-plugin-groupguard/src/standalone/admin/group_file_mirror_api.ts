import fs from 'fs';
import path from 'path';
import {
  groupFileMirrorService,
  normalizeGroupFileMirrorConfig,
  type GroupFileMirrorConfig,
  type GroupFileMirrorRule,
} from '../../services/group_file_mirror_service';

export type GroupFileMirrorFileMode = 'all' | 'sevenZip' | 'archive' | 'custom';

export interface GroupFileMirrorEditorRule {
  name: string;
  enabled: boolean;
  sourceGroupId: string;
  targetGroupId: string;
  sourceUploaderText: string;
  fileMode: GroupFileMirrorFileMode;
  customPattern: string;
  maxFileSizeMb: number;
}

export interface GroupFileMirrorEditorConfig {
  enabled: boolean;
  rules: GroupFileMirrorEditorRule[];
}

export interface GroupFileMirrorRuleStatus {
  name: string;
  currentFileName: string;
  currentFileSize: number;
  mirroredAt: number;
  lastSuccessAt: number;
  lastErrorAt: number;
  lastError: string;
  pendingCleanupCount: number;
}

export class GroupFileMirrorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupFileMirrorConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function requireNumericId(label: string, value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new GroupFileMirrorConfigError(`${label}必须填写纯数字 QQ 群号或 QQ 号。`);
  return text;
}

function parseUploaderIds(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[\s,，;；]+/g);
  const output = Array.from(new Set(items.map(item => String(item ?? '').trim()).filter(Boolean)));
  for (const id of output) {
    if (!/^\d+$/.test(id)) throw new GroupFileMirrorConfigError(`发送者 QQ“${id}”格式不正确，只能填写数字。`);
  }
  return output;
}

function patternForMode(mode: GroupFileMirrorFileMode, customPattern: unknown): string {
  if (mode === 'all') return '';
  if (mode === 'sevenZip') return '\\.7z$';
  if (mode === 'archive') return '\\.(7z|zip|rar)$';
  const pattern = String(customPattern ?? '').trim();
  if (!pattern) throw new GroupFileMirrorConfigError('选择“自定义文件规则”后，必须填写文件名匹配规则。');
  try {
    void new RegExp(pattern, 'i');
  } catch {
    throw new GroupFileMirrorConfigError('自定义文件名匹配规则格式不正确，请检查括号、斜杠和符号。');
  }
  return pattern;
}

function fileModeForPattern(pattern: string): { mode: GroupFileMirrorFileMode; customPattern: string } {
  if (!pattern) return { mode: 'all', customPattern: '' };
  if (pattern === '\\.7z$') return { mode: 'sevenZip', customPattern: '' };
  if (pattern === '\\.(7z|zip|rar)$') return { mode: 'archive', customPattern: '' };
  return { mode: 'custom', customPattern: pattern };
}

function createRuleName(value: unknown, index: number): string {
  const name = String(value ?? '').trim() || `转发规则 ${index + 1}`;
  if (name.length > 80) throw new GroupFileMirrorConfigError(`第 ${index + 1} 条规则名称不能超过 80 个字。`);
  return name;
}

export function normalizeGroupFileMirrorWebInput(value: unknown): GroupFileMirrorConfig {
  const input = isRecord(value) && isRecord(value.config) ? value.config : value;
  const raw = isRecord(input) ? input : {};
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rawRules.length > 50) throw new GroupFileMirrorConfigError('转发规则最多只能添加 50 条。');

  const names = new Set<string>();
  const pairs = new Set<string>();
  const rules: GroupFileMirrorRule[] = rawRules.map((item, index) => {
    const rule = isRecord(item) ? item : {};
    const name = createRuleName(rule.name ?? rule.id, index);
    if (names.has(name)) throw new GroupFileMirrorConfigError(`规则名称“${name}”重复，请修改后再保存。`);
    names.add(name);

    const sourceGroupId = requireNumericId(`第 ${index + 1} 条规则的监控群号`, rule.sourceGroupId ?? rule.source_group_id);
    const targetGroupId = requireNumericId(`第 ${index + 1} 条规则的接收群号`, rule.targetGroupId ?? rule.target_group_id);
    if (sourceGroupId === targetGroupId) throw new GroupFileMirrorConfigError(`规则“${name}”的监控群和接收群不能相同。`);

    const pair = `${sourceGroupId}->${targetGroupId}`;
    if (pairs.has(pair)) throw new GroupFileMirrorConfigError(`监控群 ${sourceGroupId} 到接收群 ${targetGroupId} 的规则重复。`);
    if (pairs.has(`${targetGroupId}->${sourceGroupId}`)) {
      throw new GroupFileMirrorConfigError(`检测到 ${sourceGroupId} 和 ${targetGroupId} 互相转发，为防止循环已拒绝保存。`);
    }
    pairs.add(pair);

    const mode = rule.fileMode === 'sevenZip'
      || rule.fileMode === 'archive'
      || rule.fileMode === 'custom'
      ? rule.fileMode
      : rule.fileMode === 'all'
        ? 'all'
        : fileModeForPattern(String(rule.fileNamePattern ?? '')).mode;
    const customPattern = rule.customPattern ?? rule.fileNamePattern ?? '';

    return {
      id: name,
      enabled: rule.enabled !== false,
      sourceGroupId,
      targetGroupId,
      sourceUploaderIds: parseUploaderIds(rule.sourceUploaderText ?? rule.sourceUploaderIds ?? rule.source_uploader_ids),
      fileNamePattern: patternForMode(mode, customPattern),
      maxFileSizeMb: clampInteger(rule.maxFileSizeMb ?? rule.max_file_size_mb, 512, 1, 4096),

      // 固定流程：原样转发新文件消息，只保留接收群最新一条，并同步来源撤回。
      keepLatestOnly: true,
      recallPreviousTargetMessage: true,
      syncSourceRecall: true,
      retryCount: 2,
      retryDelayMs: 1500,
    };
  });

  return normalizeGroupFileMirrorConfig({
    enabled: raw.enabled === true,
    rules,
  });
}

function ensureConfigFile(): string {
  const filePath = groupFileMirrorService.getConfigFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify({ enabled: false, rules: [] }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  }
  return filePath;
}

function readConfig(): GroupFileMirrorConfig {
  const filePath = ensureConfigFile();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return normalizeGroupFileMirrorConfig(parsed);
}

function readState(): Record<string, any> {
  const filePath = groupFileMirrorService.getStateFilePath();
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isRecord(parsed?.rules) ? parsed.rules : {};
  } catch {
    return {};
  }
}

function toEditorRule(rule: GroupFileMirrorRule): GroupFileMirrorEditorRule {
  const fileMode = fileModeForPattern(rule.fileNamePattern);
  return {
    name: rule.id,
    enabled: rule.enabled,
    sourceGroupId: rule.sourceGroupId,
    targetGroupId: rule.targetGroupId,
    sourceUploaderText: rule.sourceUploaderIds.join('，'),
    fileMode: fileMode.mode,
    customPattern: fileMode.customPattern,
    maxFileSizeMb: rule.maxFileSizeMb,
  };
}

function toRuleStatus(rule: GroupFileMirrorRule, stateRules: Record<string, any>): GroupFileMirrorRuleStatus {
  const state = isRecord(stateRules[rule.id]) ? stateRules[rule.id] : {};
  const current = isRecord(state.current) ? state.current : {};
  return {
    name: rule.id,
    currentFileName: String(current.sourceFileName ?? ''),
    currentFileSize: Math.max(0, Number(current.sourceFileSize ?? 0) || 0),
    mirroredAt: Math.max(0, Number(current.mirroredAt ?? 0) || 0),
    lastSuccessAt: Math.max(0, Number(state.lastSuccessAt ?? 0) || 0),
    lastErrorAt: Math.max(0, Number(state.lastErrorAt ?? 0) || 0),
    lastError: String(state.lastError ?? ''),
    pendingCleanupCount: Array.isArray(state.pendingCleanup) ? state.pendingCleanup.length : 0,
  };
}

export function getGroupFileMirrorOverview() {
  const config = readConfig();
  const stateRules = readState();
  return {
    ok: true,
    editor: {
      enabled: config.enabled,
      rules: config.rules.map(toEditorRule),
    } satisfies GroupFileMirrorEditorConfig,
    statuses: config.rules.map(rule => toRuleStatus(rule, stateRules)),
    fixedFlow: [
      '监控来源群的文件消息卡片',
      '匹配发送者 QQ、文件名和大小',
      '原样转发单条文件消息到接收群',
      '新消息成功后撤回上一条转发',
      '来源文件消息撤回时同步撤回接收群消息',
    ],
  };
}

function pruneWebBackups(filePath: string): void {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.bak.webui-`;
  const backups = fs.readdirSync(dir)
    .filter(name => name.startsWith(prefix))
    .sort()
    .reverse();
  for (const name of backups.slice(10)) {
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* 保留失败不影响保存 */ }
  }
}

export function saveGroupFileMirrorFromWeb(value: unknown) {
  const config = normalizeGroupFileMirrorWebInput(value);
  const filePath = ensureConfigFile();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.webui-${stamp}`;
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.copyFileSync(filePath, backupPath);
  try { fs.chmodSync(backupPath, 0o600); } catch { /* 非 POSIX 环境忽略 */ }

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    JSON.parse(fs.readFileSync(temporaryPath, 'utf-8'));
    fs.renameSync(temporaryPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* 非 POSIX 环境忽略 */ }
    pruneWebBackups(filePath);
  } catch (error) {
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* 忽略清理失败 */ }
    throw error;
  }

  return {
    ...getGroupFileMirrorOverview(),
    message: '文件消息转发设置已保存，将在下一条匹配的群文件消息到来时生效。',
  };
}
