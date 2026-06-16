import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeInteractionCommand } from '../../services/interaction_service';

export const INTERACTION_PREFIXES = [
  '兑换 ',
  '开启发言奖励 ',
  '查邀请',
  '查来源',
  '查封号',
  '查隐藏',
  '我要看',
  '查战绩',
  '活跃统计',
  '设置战绩接口',
  '设置战绩全局开关',
  '设置战绩全局限流',
  '设置战绩分群开关',
  '设置战绩分群限流',
  '设置战绩指令开关',
  '设置看视频接口',
  '删除看视频接口',
  '设置lolurl',
  '设置lolkey',
  '设置loltoken',
  '设置封号主接口',
  '设置封号接口配置',
  '删除封号备用接口'
  ,
  '设置骗子查询接口',
  '添加骗子查询接口',
  '删除骗子查询接口',
  '设置骗子举报接口',
  '设置骗子库限制',
  '设置骗子风控',
  '查骗子',
  '举报骗子',
  '查同行',
  '举报同行'
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
  '封号接口列表',
  '战绩接口状态',
  '战绩配置',
  '看视频接口列表'
  ,
  '骗子接口状态'
];

export async function handleInteractionCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeInteractionCommand({ event, ctx, raw, text, userId, groupId });
}
