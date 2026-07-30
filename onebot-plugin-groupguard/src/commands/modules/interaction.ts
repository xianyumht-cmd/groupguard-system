import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeInteractionCommand } from '../../services/interaction_service';

export const INTERACTION_PREFIXES = [
  '兑换 ',
  '开启发言奖励 ',
  '查邀请',
  '查来源',
  '活跃统计',
  '设置战绩接口',
  '设置战绩全局开关',
  '设置战绩全局限流',
  '设置战绩分群开关',
  '设置战绩分群限流',
  '设置战绩指令开关'
];

export const INTERACTION_EXACT = [
  '签到',
  '签到榜',
  '我的积分',
  '抽奖',
  '邀请查询',
  '邀请榜',
  '重置邀请统计',
  '清空邀请统计',
  '积分商城',
  '商城',
  '关闭发言奖励',
  '战绩接口状态',
  '战绩配置'
];

export async function handleInteractionCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeInteractionCommand({ event, ctx, raw, text, userId, groupId });
}
