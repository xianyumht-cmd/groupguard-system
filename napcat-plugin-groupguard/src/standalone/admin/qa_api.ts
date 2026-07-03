import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import { storageAdapter } from '../../storage_adapter';
import type { QAEntry } from '../../types';
import type { SnowLumaAdminServerOptions } from './types';

export type QaScope = 'global' | 'group';
type QaEntryWithEnabled = QAEntry & { enabled?: boolean };

const DISABLED_PREFIX = '__GG_QA_DISABLED__:';

function cleanGroupId(groupId: string): string {
  const normalized = String(groupId || '').trim();
  if (!/^\d{4,20}$/.test(normalized)) throw new Error('群号格式不正确');
  return normalized;
}

function normalizeScope(scope: any): QaScope {
  return scope === 'group' ? 'group' : 'global';
}

function normalizeMode(mode: any): QAEntry['mode'] {
  return mode === 'contains' || mode === 'regex' ? mode : 'exact';
}

function stripDisabledPrefix(keyword: any): string {
  const text = String(keyword || '').trim();
  return text.startsWith(DISABLED_PREFIX) ? text.slice(DISABLED_PREFIX.length) : text;
}

function withDisabledPrefix(keyword: string): string {
  const clean = stripDisabledPrefix(keyword);
  return `${DISABLED_PREFIX}${clean}`;
}

function isPrefixedDisabled(entry: any): boolean {
  return String(entry?.keyword || '').startsWith(DISABLED_PREFIX);
}

function qaKey(entry: Pick<QAEntry, 'keyword' | 'mode'>): string {
  return `${normalizeMode(entry.mode)}:${stripDisabledPrefix(entry.keyword)}`;
}

function normalizeDisabledKeys(value: any): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function loadStoredGroupConfig(groupId: string): any {
  const id = cleanGroupId(groupId);
  try {
    return (storageAdapter.loadAllGroupConfigs() as any)[id] || {};
  } catch {
    return {};
  }
}

function normalizeQaEntry(input: any): QaEntryWithEnabled {
  const keyword = stripDisabledPrefix(input?.keyword);
  const reply = String(input?.reply || '').trim();
  if (!keyword) throw new Error('关键词不能为空');
  if (!reply) throw new Error('回复内容不能为空');
  const enabled = input?.enabled !== false;
  return { keyword: enabled ? keyword : withDisabledPrefix(keyword), reply, mode: normalizeMode(input?.mode), enabled };
}

function toDisplayEntry(entry: any, disabledSet: Set<string>): QaEntryWithEnabled {
  const clean: QAEntry = {
    keyword: stripDisabledPrefix(entry?.keyword),
    reply: String(entry?.reply || ''),
    mode: normalizeMode(entry?.mode)
  };
  const disabled = isPrefixedDisabled(entry) || entry?.enabled === false || disabledSet.has(qaKey(clean));
  return { ...clean, enabled: !disabled };
}

function getGroupQaList(groupId: string): QaEntryWithEnabled[] {
  const id = cleanGroupId(groupId);
  const group = configStateService.getGroupSettings(id) as any;
  const stored = loadStoredGroupConfig(id);
  const disabled = new Set(normalizeDisabledKeys(group?.qaDisabledKeys ?? stored?.qaDisabledKeys));
  const memoryList = Array.isArray(group?.qaList) ? group.qaList : [];
  const storedList = Array.isArray(stored?.qaList) ? stored.qaList : [];
  const list = memoryList.length ? memoryList : storedList;
  return list.map((entry: QAEntry) => toDisplayEntry(entry, disabled));
}

function ensureGroupConfig(groupId: string) {
  const id = cleanGroupId(groupId);
  const config = configStateService.getConfig();
  const stored = loadStoredGroupConfig(id);
  if (!config.groups[id]) {
    config.groups[id] = {
      ...configStateService.resolveGroupSettings(id),
      ...stored,
      useGlobal: false,
      qaList: Array.isArray(stored?.qaList) ? stored.qaList : []
    };
  }
  config.groups[id].useGlobal = false;
  if (!Array.isArray(config.groups[id].qaList)) {
    config.groups[id].qaList = Array.isArray(stored?.qaList) ? stored.qaList : [];
  }
  return config.groups[id] as any;
}

function getQaListForScope(scope: QaScope, groupIdInput: any): QaEntryWithEnabled[] {
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    const disabled = new Set(normalizeDisabledKeys(config.qaDisabledKeys));
    const list = Array.isArray(config.qaList) ? config.qaList : [];
    return list.map((entry: QAEntry) => toDisplayEntry(entry, disabled));
  }
  return getGroupQaList(cleanGroupId(groupIdInput));
}

function setDisabledKey(scope: QaScope, groupIdInput: any, entry: QAEntry, enabled: boolean): void {
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    const set = new Set(normalizeDisabledKeys(config.qaDisabledKeys));
    if (enabled) set.delete(qaKey(entry));
    else set.add(qaKey(entry));
    config.qaDisabledKeys = Array.from(set);
    return;
  }
  const group = ensureGroupConfig(cleanGroupId(groupIdInput));
  const set = new Set(normalizeDisabledKeys(group.qaDisabledKeys));
  if (enabled) set.delete(qaKey(entry));
  else set.add(qaKey(entry));
  group.qaDisabledKeys = Array.from(set);
}

function storeEntryWithEnabled(entry: QaEntryWithEnabled, enabled: boolean): QaEntryWithEnabled {
  const keyword = enabled ? stripDisabledPrefix(entry.keyword) : withDisabledPrefix(entry.keyword);
  return { ...entry, keyword, enabled };
}

function filterQa(list: QaEntryWithEnabled[], keyword: string) {
  const q = String(keyword || '').trim().toLowerCase();
  return list.map((entry, index) => ({ index, ...entry, enabled: entry.enabled !== false })).filter(item => {
    if (!q) return true;
    return String(item.keyword || '').toLowerCase().includes(q) || String(item.reply || '').toLowerCase().includes(q);
  });
}

export function listQaGroups() {
  const config = configStateService.getConfig() as any;
  const groups = configStateService.getGroups() || {};
  const licenses = configStateService.getLicenses() || {};
  const groupNames = config.groupNames || {};
  const summaryMap = new Map<string, {
    groupId: string;
    configured: boolean;
    qaCount: number;
    config: Record<string, any>;
  }>();

  try {
    for (const item of storageAdapter.listGroupQaSummaries()) {
      summaryMap.set(item.groupId, item);
    }
  } catch {
    // WebUI can still show in-memory config/licensed groups if storage is unavailable.
  }

  for (const [groupId, group] of Object.entries(groups)) {
    const existing = summaryMap.get(groupId) || { groupId, configured: false, qaCount: 0, config: {} };
    existing.configured = true;
    existing.config = { ...existing.config, ...(group as Record<string, any>) };
    const qaList = Array.isArray((group as any)?.qaList) ? (group as any).qaList : [];
    existing.qaCount = Math.max(existing.qaCount, qaList.length);
    summaryMap.set(groupId, existing);
  }

  for (const groupId of Object.keys(licenses)) {
    if (!summaryMap.has(groupId)) {
      summaryMap.set(groupId, { groupId, configured: false, qaCount: 0, config: {} });
    }
  }

  return Array.from(summaryMap.values())
    .sort((a, b) => Number(a.groupId) - Number(b.groupId))
    .map(item => {
      const effective = configStateService.resolveGroupSettings(item.groupId) as any;
      const group = (groups as any)[item.groupId] || item.config || {};
      const qaEnabled = effective.disableQA !== true && effective.qaEnabled !== false;
      return {
        groupId: item.groupId,
        name: String(groupNames[item.groupId] || group.groupName || group.name || item.groupId),
        qaCount: item.qaCount,
        configured: item.configured || Boolean((groups as any)[item.groupId]),
        licensed: Boolean((licenses as any)[item.groupId]),
        useGlobal: group.useGlobal ?? true,
        qaEnabled,
        disableQA: effective.disableQA === true
      };
    });
}

export function listQaEntries(scopeInput: any, groupIdInput: any, keyword = '') {
  const scope = normalizeScope(scopeInput);
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    const list = getQaListForScope(scope, groupIdInput);
    return { scope, groupId: '', list: filterQa(list, keyword), total: list.length };
  }
  const groupId = cleanGroupId(groupIdInput);
  const stored = loadStoredGroupConfig(groupId);
  const list = getQaListForScope(scope, groupId);
  const group = config.groups[groupId] || stored || {};
  return {
    scope,
    groupId,
    list: filterQa(list, keyword),
    total: list.length,
    groupConfigured: Boolean(config.groups[groupId]) || Boolean(Object.keys(stored || {}).length),
    useGlobal: group.useGlobal ?? true,
    globalTotal: Array.isArray(config.qaList) ? config.qaList.length : 0
  };
}

export function addQaEntry(options: SnowLumaAdminServerOptions, scopeInput: any, groupIdInput: any, input: any) {
  const scope = normalizeScope(scopeInput);
  const entry = normalizeQaEntry(input);
  const enabled = entry.enabled !== false;
  const stored = storeEntryWithEnabled(entry, enabled);
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    if (!Array.isArray(config.qaList)) config.qaList = [];
    config.qaList.push(stored);
    setDisabledKey(scope, groupIdInput, stored, enabled);
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    group.qaList!.push(stored);
    setDisabledKey(scope, groupId, stored, enabled);
  }
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}

export function updateQaEntry(options: SnowLumaAdminServerOptions, scopeInput: any, groupIdInput: any, indexInput: any, input: any) {
  const scope = normalizeScope(scopeInput);
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0) throw new Error('问答序号不正确');
  const entry = normalizeQaEntry(input);
  const enabled = entry.enabled !== false;
  const stored = storeEntryWithEnabled(entry, enabled);
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    if (!Array.isArray(config.qaList) || !config.qaList[index]) throw new Error('问答不存在');
    setDisabledKey(scope, groupIdInput, config.qaList[index], true);
    config.qaList[index] = stored;
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    if (!group.qaList![index]) throw new Error('问答不存在');
    setDisabledKey(scope, groupId, group.qaList![index], true);
    group.qaList![index] = stored;
  }
  setDisabledKey(scope, groupIdInput, stored, enabled);
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}

export function setQaEntryEnabled(options: SnowLumaAdminServerOptions, scopeInput: any, groupIdInput: any, indexInput: any, enabledInput: any) {
  const scope = normalizeScope(scopeInput);
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0) throw new Error('问答序号不正确');
  const config = configStateService.getConfig() as any;
  const enabled = enabledInput !== false;
  if (scope === 'global') {
    if (!Array.isArray(config.qaList) || !config.qaList[index]) throw new Error('问答不存在');
    config.qaList[index] = storeEntryWithEnabled(config.qaList[index], enabled);
    setDisabledKey(scope, groupIdInput, config.qaList[index], enabled);
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    if (!group.qaList![index]) throw new Error('问答不存在');
    group.qaList![index] = storeEntryWithEnabled(group.qaList![index], enabled);
    setDisabledKey(scope, groupId, group.qaList![index], enabled);
  }
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}

export function deleteQaEntry(options: SnowLumaAdminServerOptions, scopeInput: any, groupIdInput: any, indexInput: any) {
  const scope = normalizeScope(scopeInput);
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0) throw new Error('问答序号不正确');
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    if (!Array.isArray(config.qaList) || !config.qaList[index]) throw new Error('问答不存在');
    setDisabledKey(scope, groupIdInput, config.qaList[index], true);
    config.qaList.splice(index, 1);
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    if (!group.qaList![index]) throw new Error('问答不存在');
    setDisabledKey(scope, groupId, group.qaList![index], true);
    group.qaList!.splice(index, 1);
  }
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}
