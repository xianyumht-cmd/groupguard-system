import { getActionQueueSnapshot } from '../../../services/action_queue_service';

export function getQueueStatusText(): string {
  try {
    const q = getActionQueueSnapshot();
    const stats = q?.stats || { queueExecuted: 0, queueDropped: 0, queueRateLimited: 0, queueRetried: 0, timeoutCount: 0 };
    const lastMinute = q?.lastMinute || { executed: 0, dropped: 0, rateLimited: 0, retried: 0, timeout: 0 };
    const dist = Object.entries(q?.typeDistribution || {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '无';
    const activeDist = Object.entries(q?.activeTypeDistribution || {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '无';
    return `ActionQueue 状态\n\n当前队列长度: ${q?.totalPending ?? 0}\n执行中任务: ${q?.activeWorkers ?? 0}\n\n最近1分钟:\n执行动作: ${lastMinute.executed}\n丢弃动作: ${lastMinute.dropped}\n速率限制: ${lastMinute.rateLimited}\n重试次数: ${lastMinute.retried}\n超时次数: ${lastMinute.timeout}\n\n累计统计:\n执行动作: ${stats.queueExecuted}\n丢弃动作: ${stats.queueDropped}\n速率限制: ${stats.queueRateLimited}\n重试次数: ${stats.queueRetried}\n超时次数: ${stats.timeoutCount}\n\n队列类型分布:\n${dist}\n\n执行中类型分布:\n${activeDist}`;
  } catch (error) {
    return `ActionQueue 状态\n\n读取失败: ${String(error)}`;
  }
}
