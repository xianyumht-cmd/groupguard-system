import { getLogsText } from '../app/use-cases/system/get_logs';
import { getQueueStatusText } from '../app/use-cases/system/get_queue_status';
import { getRuntimeStatusText } from '../app/use-cases/system/get_runtime_status';
import { getStorageStatusText } from '../app/use-cases/system/get_storage_status';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
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

export async function executeSystemCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, ctx } = input;
  if (event.message_type === 'private') {
    if (text === '帮助' || text === '菜单') {
      const isOwner = authStateService.isOwner(userId);
      let menu = `🛡️ GroupGuard 私聊管理面板\n--------------------------\n`;
      if (isOwner) {
        menu += `📝 授权管理 (主人权限):\n` +
                `• 授权 <群号> <天数/永久> (默认专业版/企业版)\n` +
                `• 回收授权 <群号>\n` +
                `• 查询授权 <群号>\n\n` +
                `⚙️ 全局设置 (主人权限):\n` +
                `• 全局黑名单 <QQ> (跨群封禁)\n` +
                `• 全局白名单 <QQ> (豁免检测)\n` +
                `• 开启/关闭全局防撤回 (私聊接收撤回消息)\n`;
      } else {
        menu += `您当前仅有普通用户权限，无法执行管理指令。\n如需授权群组，请联系机器人主人。`;
      }
      menu += `\n--------------------------\n当前版本: ${identityStateService.getVersion()}`;
      await sendPrivateScene(userId, 'raw_text', menu);
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
