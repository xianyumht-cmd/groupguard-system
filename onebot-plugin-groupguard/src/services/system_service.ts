import { getLogsText } from '../app/use-cases/system/get_logs';
import { getQueueStatusText } from '../app/use-cases/system/get_queue_status';
import { getRuntimeStatusText } from '../app/use-cases/system/get_runtime_status';
import { getStorageStatusText } from '../app/use-cases/system/get_storage_status';
import fs from 'fs';
import path from 'path';
import { authStateService } from '../core/state-services/auth_state_service';
import { contextStateService } from '../core/state-services/context_state_service';
import { getFeatureGateSnapshot } from '../core/feature_gate';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { getAccountDynamicCommandsConfigPath, getDynamicCommandsConfigPath, loadDynamicCommands } from '../dynamic-commands/command_loader';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { isAdminOrOwner, sendGroupScene, sendPrivateScene } from '../commands/common';
import { parseSystemWriteCommand } from '../commands/modules/system/write';
import type { CommandExecutionContext } from './command_service_types';
import { executeSystemWriteCommand, sendSystemWriteResult } from './system_write_dispatcher';
import type { AuditEventQuery, AuditEventType } from '../types';

function parseAuditQuery(text: string): AuditEventQuery {
  const rest = text.replace(/^\/?审计日志/, '').trim();
  const parts = rest ? rest.split(/\s+/).filter(Boolean) : [];
  const query: AuditEventQuery = { limit: 10 };
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      query.limit = Math.max(1, Math.min(50, Number(part)));
      continue;
    }
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=').trim();
    if (!value) continue;
    if (key === '群' || key.toLowerCase() === 'group' || key.toLowerCase() === 'group_id') query.groupId = value;
    if (key === '用户' || key.toLowerCase() === 'user' || key.toLowerCase() === 'user_id') query.userId = value;
    if (key === '类型' || key.toLowerCase() === 'type' || key.toLowerCase() === 'event_type') {
      if (value === 'risk_signal' || value === 'risk_assessment' || value === 'policy_decision' || value === 'manual_policy_action') {
        query.eventType = value as AuditEventType;
      }
    }
  }
  return query;
}

function formatAuditTime(ts: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN');
}

const OWNER_MENU_TRIGGERS = new Set(['菜单', '帮助', 'help', '主人菜单', '功能菜单']);
const OWNER_DIAGNOSTIC_TRIGGERS = new Set(['状态', '诊断', '配置路径', '动态命令状态', '功能开关状态']);

function pathExists(p: string): boolean {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function findNestedDataHints(workDir: string, configDir: string, dataDir: string): string[] {
  const hints: string[] = [];
  const candidates = [
    path.join(workDir, 'data', 'data'),
    path.join(configDir, 'data', 'data'),
    path.join(dataDir, 'data')
  ];
  for (const candidate of candidates) {
    if (pathExists(candidate) && !hints.includes(candidate)) hints.push(candidate);
  }
  const parent = dataDir || path.join(workDir, 'data');
  try {
    for (const name of fs.readdirSync(parent)) {
      if (!/^qq\d+$/i.test(name)) continue;
      const nested = path.join(parent, name, 'data', 'data');
      if (pathExists(nested) && !hints.includes(nested)) hints.push(nested);
    }
  } catch {
    // best effort diagnostics only
  }
  return hints;
}

function buildOwnerMenu(): string {
  return [
    '【GroupGuard 主人菜单】',
    '',
    '1. 状态 / 诊断',
    '- 状态',
    '- 诊断',
    '- 配置路径',
    '- 动态命令状态',
    '- 功能开关状态',
    '',
    '2. 实验开关',
    '- queryEnabled：查询总开关',
    '- qaEnabled / disableQA：问答总开关',
    '- dynamicCommandEnabled：动态命令总开关',
    '- silentMode: off / noPassiveReply / noBotSend（当前可通过配置字段控制）',
    '',
    '3. 查询类',
    '- 查封号',
    '- 查战绩',
    '- 查隐藏',
    '- 查合集',
    '- 查骗子',
    '- 查同行',
    '',
    '4. 问答类',
    '- 添加问答 / 删除问答 / 问答列表',
    '- 清空问答',
    '',
    '5. 授权类',
    '- 授权群',
    '- 取消授权',
    '- 授权列表',
    '',
    '6. 风控/发送',
    '- 查看发送策略',
    '- 队列状态',
    '- 队列日志',
    '- 查看发送包装'
  ].join('\n');
}

function buildOwnerDiagnostics(): string {
  const workDir = contextStateService.getWorkDir() || process.cwd();
  const configDir = contextStateService.getConfigDir();
  const configPath = contextStateService.getConfigPath() || (configDir ? path.join(configDir, 'config.json') : '');
  const storageDataDir = contextStateService.getDataDir() || (configDir ? path.join(configDir, 'data') : '');
  const sqlitePath = storageDataDir ? path.join(storageDataDir, 'groupguard.db') : '';
  const backupDir = contextStateService.getBackupDir() || (workDir ? path.join(workDir, 'backups') : '');
  const accountDynamicPath = getAccountDynamicCommandsConfigPath();
  const dynamicCommandsPath = getDynamicCommandsConfigPath();
  const dynamicCommands = loadDynamicCommands();
  const nested = configDir ? findNestedDataHints(workDir, configDir, storageDataDir) : [];
  const feature = getFeatureGateSnapshot();
  return [
    '【GroupGuard 诊断】',
    `version: ${identityStateService.getVersion()}`,
    `workDir: ${workDir || '-'}`,
    `processCwd: ${process.cwd()}`,
    `configPath: ${configPath || '-'}`,
    `configDir: ${configDir || '-'}`,
    `dataDir(storage): ${storageDataDir || '-'}`,
    `sqlitePath: ${sqlitePath || '-'}`,
    `dynamicCommandsPath: ${dynamicCommandsPath}`,
    `dynamicCommandsAccountPath: ${accountDynamicPath || '-'}`,
    `backupDir: ${backupDir || '-'}`,
    `botId: ${identityStateService.getBotId() || '-'}`,
    `hostProfileId: ${contextStateService.getHostProfileId() || '-'}`,
    `dynamicCommandsCount: ${dynamicCommands.length}`,
    `accountCommandsExists: ${pathExists(accountDynamicPath) ? 'yes' : 'no'}`,
    `legacyCommandsFallback: ${dynamicCommandsPath === accountDynamicPath ? 'no' : 'yes'}`,
    `nestedDataPathFound: ${nested.length ? 'yes' : 'no'}`,
    ...(nested.length ? nested.map(item => `- ${item}`) : []),
    ...(nested.length ? ['提示：发现历史嵌套数据路径，建议人工确认后迁移，本次不会自动移动。'] : []),
    `feature.masterEnabled: ${feature.masterEnabled}`,
    `feature.silentMode: ${feature.silentMode}`,
    `feature.activeReplyEnabled: ${feature.activeReplyEnabled}`,
    `feature.queryEnabled: ${feature.queryEnabled}`,
    `feature.qaEnabled: ${feature.qaEnabled}`,
    `feature.dynamicCommandEnabled: ${feature.dynamicCommandEnabled}`,
    `legacy.disableQA: ${feature.legacy.disableQA}`,
    `legacy.disableLolQuery: ${feature.legacy.disableLolQuery}`
  ].join('\n');
}

export async function executeSystemCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, ctx } = input;
  if (event.message_type === 'private') {
    if (OWNER_MENU_TRIGGERS.has(text) || OWNER_DIAGNOSTIC_TRIGGERS.has(text)) {
      const isOwner = authStateService.isOwner(userId);
      if (!isOwner) {
        await sendPrivateScene(userId, 'permission_denied', '无权限');
        return true;
      }
      await sendPrivateScene(userId, 'raw_text', OWNER_DIAGNOSTIC_TRIGGERS.has(text) ? buildOwnerDiagnostics() : buildOwnerMenu());
      return true;
    }
    if (!authStateService.isOwner(userId)) {
      await sendPrivateScene(userId, 'permission_denied', '权限不足：该指令仅限机器人主人使用。');
      return true;
    }
    if (text === '查看SQLite状态' || text === '查看存储状态') {
      await sendPrivateScene(userId, 'raw_text', getStorageStatusText());
      return true;
    }
    if (text === '队列状态' || text === '/队列状态') {
      await sendPrivateScene(userId, 'raw_text', getQueueStatusText());
      return true;
    }
    if (text === '队列日志' || text.startsWith('队列日志 ') || text.startsWith('/队列日志')) {
      const match = text.match(/\/?队列日志\s*(\d+)?/);
      const limit = match?.[1] ? Math.max(1, Math.min(100, Number(match[1]))) : 10;
      await sendPrivateScene(userId, 'raw_text', getLogsText(limit));
      return true;
    }
    if (text === '审计日志' || text.startsWith('审计日志 ') || text.startsWith('/审计日志')) {
      const query = parseAuditQuery(text);
      const rows = await groupguardRepository.getRecentAuditEvents(query);
      if (!rows.length) {
        await sendPrivateScene(userId, 'raw_text', '暂无匹配审计记录');
        return true;
      }
      const lines = rows.map((row, index) => {
        const target = `${row.groupId || '-'} / ${row.userId || '-'}`;
        const score = row.riskScore ? ` score=${row.riskScore}` : '';
        return `${index + 1}. [${row.eventType}] ${row.kind} ${target} ${formatAuditTime(row.createdAt)} ${row.reason}${score}`;
      });
      await sendPrivateScene(userId, 'raw_text', `审计日志（${rows.length}条）\n${lines.join('\n')}`);
      return true;
    }
    const privateWrite = parseSystemWriteCommand({ channel: 'private', text, groupId, userId, ctx });
    if (privateWrite) {
      await sendSystemWriteResult(privateWrite, await executeSystemWriteCommand(privateWrite, ctx));
      return true;
    }
    return false;
  }

  if (text === '群管帮助' || text === '群管菜单') {
    await sendGroupScene(groupId, 'raw_text', '🛡️ 群管菜单\n发送“帮助”查看完整指令，发送“风控设置”查看风险相关指令。');
    return true;
  }
  if (text === '运行状态') {
    await sendGroupScene(groupId, 'raw_text', getRuntimeStatusText());
    return true;
  }
  const groupWrite = parseSystemWriteCommand({ channel: 'group', text, groupId, userId, ctx });
  if (groupWrite) {
    await sendSystemWriteResult(groupWrite, await executeSystemWriteCommand(groupWrite, ctx));
    return true;
  }
  if (text === '定时列表') {
    const tasks = configStateService.getConfig().groups[groupId]?.scheduledTasks || [];
    if (!tasks.length) { await sendGroupScene(groupId, 'list_empty', '本群无定时任务'); return true; }
    const list = tasks.map(t => `[${t.id}] ${t.cron} -> ${t.content}`).join('\n');
    await sendGroupScene(groupId, 'raw_text', `定时任务列表：\n${list}`);
    return true;
  }
  return false;
}
