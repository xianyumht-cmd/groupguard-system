import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
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
  const disabled = new Set(normalizeDisabledKeys(group?.qaDisabledKeys));
  const list = Array.isArray(group?.qaList) ? group.qaList : [];
  return list.map((entry: QAEntry) => toDisplayEntry(entry, disabled));
}

function ensureGroupConfig(groupId: string) {
  const id = cleanGroupId(groupId);
  const config = configStateService.getConfig();
  if (!config.groups[id]) {
    config.groups[id] = { ...configStateService.resolveGroupSettings(id), useGlobal: false, qaList: [] };
  }
  config.groups[id].useGlobal = false;
  if (!Array.isArray(config.groups[id].qaList)) config.groups[id].qaList = [];
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

export function listQaEntries(scopeInput: any, groupIdInput: any, keyword = '') {
  const scope = normalizeScope(scopeInput);
  const config = configStateService.getConfig() as any;
  if (scope === 'global') {
    const list = getQaListForScope(scope, groupIdInput);
    return { scope, groupId: '', list: filterQa(list, keyword), total: list.length };
  }
  const groupId = cleanGroupId(groupIdInput);
  const list = getQaListForScope(scope, groupId);
  return {
    scope,
    groupId,
    list: filterQa(list, keyword),
    total: list.length,
    groupConfigured: Boolean(config.groups[groupId]),
    useGlobal: config.groups[groupId]?.useGlobal ?? true,
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
