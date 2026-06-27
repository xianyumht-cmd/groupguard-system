import { configStateService } from '../../core/state-services/config_state_service';
import { saveConfigStrict } from '../../commands/common';
import type { QAEntry } from '../../types';
import type { SnowLumaAdminServerOptions } from './types';

export type QaScope = 'global' | 'group';

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

function normalizeQaEntry(input: any): QAEntry {
  const keyword = String(input?.keyword || '').trim();
  const reply = String(input?.reply || '').trim();
  if (!keyword) throw new Error('关键词不能为空');
  if (!reply) throw new Error('回复内容不能为空');
  return { keyword, reply, mode: normalizeMode(input?.mode) };
}

function getGroupQaList(groupId: string): QAEntry[] {
  const id = cleanGroupId(groupId);
  const group = configStateService.getGroupSettings(id);
  return Array.isArray(group?.qaList) ? group!.qaList! : [];
}

function ensureGroupConfig(groupId: string) {
  const id = cleanGroupId(groupId);
  const config = configStateService.getConfig();
  if (!config.groups[id]) {
    config.groups[id] = { ...configStateService.resolveGroupSettings(id), useGlobal: false, qaList: [] };
  }
  config.groups[id].useGlobal = false;
  if (!Array.isArray(config.groups[id].qaList)) config.groups[id].qaList = [];
  return config.groups[id];
}

function filterQa(list: QAEntry[], keyword: string) {
  const q = String(keyword || '').trim().toLowerCase();
  return list.map((entry, index) => ({ index, ...entry })).filter(item => {
    if (!q) return true;
    return String(item.keyword || '').toLowerCase().includes(q) || String(item.reply || '').toLowerCase().includes(q);
  });
}

export function listQaEntries(scopeInput: any, groupIdInput: any, keyword = '') {
  const scope = normalizeScope(scopeInput);
  const config = configStateService.getConfig();
  if (scope === 'global') {
    const list = Array.isArray(config.qaList) ? config.qaList : [];
    return { scope, groupId: '', list: filterQa(list, keyword), total: list.length };
  }
  const groupId = cleanGroupId(groupIdInput);
  const list = getGroupQaList(groupId);
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
  const config = configStateService.getConfig();
  if (scope === 'global') {
    if (!Array.isArray(config.qaList)) config.qaList = [];
    config.qaList.push(entry);
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    group.qaList!.push(entry);
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
  const config = configStateService.getConfig();
  if (scope === 'global') {
    if (!Array.isArray(config.qaList) || !config.qaList[index]) throw new Error('问答不存在');
    config.qaList[index] = entry;
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    if (!group.qaList![index]) throw new Error('问答不存在');
    group.qaList![index] = entry;
  }
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}

export function deleteQaEntry(options: SnowLumaAdminServerOptions, scopeInput: any, groupIdInput: any, indexInput: any) {
  const scope = normalizeScope(scopeInput);
  const index = Number(indexInput);
  if (!Number.isInteger(index) || index < 0) throw new Error('问答序号不正确');
  const config = configStateService.getConfig();
  if (scope === 'global') {
    if (!Array.isArray(config.qaList) || !config.qaList[index]) throw new Error('问答不存在');
    config.qaList.splice(index, 1);
  } else {
    const groupId = cleanGroupId(groupIdInput);
    const group = ensureGroupConfig(groupId);
    if (!group.qaList![index]) throw new Error('问答不存在');
    group.qaList!.splice(index, 1);
  }
  configStateService.setConfig(config);
  saveConfigStrict(options.ctx);
  return listQaEntries(scope, groupIdInput);
}
