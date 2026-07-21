import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeSystemCommand } from '../../services/system_service';

export const SYSTEM_PREFIXES = [
  '多群广播 ',
  '定时任务 ',
  '删除定时任务 ',
  '设置欢迎词 ',
  '设置入群私聊 ',
  '队列日志 ',
  '/队列日志 '
];

export const SYSTEM_EXACT = [
  '菜单',
  '帮助',
  'help',
  '主人菜单',
  '功能菜单',
  '状态',
  '诊断',
  '配置路径',
  '动态命令状态',
  '功能开关状态',
  '群管帮助',
  '群管菜单',
  '运行状态',
  '队列状态',
  '/队列状态',
  '队列重置',
  '/队列重置',
  '队列日志',
  '/队列日志',
  '查看SQLite状态',
  '查看存储状态',
  '清空群配置',
  '确认清空群配置',
  '定时列表',
  '开启入群私聊',
  '关闭入群私聊'
];

export async function handleSystemCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeSystemCommand({ event, ctx, raw, text, userId, groupId });
}
