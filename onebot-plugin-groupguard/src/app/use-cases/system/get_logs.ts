import { getActionQueueRecentLogs } from '../../../services/action_queue_service';

export function getLogsText(limit: number): string {
  try {
    const logs = getActionQueueRecentLogs(limit);
    return `[ActionQueue]\n${Array.isArray(logs) && logs.length ? logs.join('\n') : '暂无记录'}`;
  } catch (error) {
    return `[ActionQueue]\n读取失败: ${String(error)}`;
  }
}
