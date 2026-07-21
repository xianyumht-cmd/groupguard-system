import { cacheStateService } from '../../../core/state-services/cache_state_service';
import { configStateService } from '../../../core/state-services/config_state_service';
import { contextStateService } from '../../../core/state-services/context_state_service';
import { identityStateService } from '../../../core/state-services/identity_state_service';
import { getActionQueueSnapshot } from '../../../services/action_queue_service';

export function getRuntimeStatusText(): string {
  try {
    const startTime = Number(contextStateService.getStartTime()) || Date.now();
    const uptime = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const cacheStats = `Msg: ${cacheStateService.getMessageCache()?.size ?? 0} | Spam: ${cacheStateService.getSpamCache()?.size ?? 0} | Admin: ${cacheStateService.getAdminCache()?.size ?? 0}`;
    const actionQueue = getActionQueueSnapshot();
    const lastMinute = actionQueue?.lastMinute || { executed: 0, dropped: 0, rateLimited: 0, retried: 0, timeout: 0 };
    const licenseCount = Object.keys(configStateService.getConfig()?.licenses || {}).length;
    return `🤖 运行状态
⏱️ 运行时长：${h}小时${m}分${s}秒
📨 处理消息：${contextStateService.getMsgCount() ?? 0} 条
💾 内存占用：RSS ${rss}MB / Heap ${heap}MB
📦 缓存对象：${cacheStats}
⚙️ 动作队列：待执行 ${actionQueue?.totalPending ?? 0} / 工作中 ${actionQueue?.activeWorkers ?? 0}
📉 队列一分钟：执行${lastMinute.executed} 丢弃${lastMinute.dropped} 限流${lastMinute.rateLimited} 重试${lastMinute.retried} 超时${lastMinute.timeout}
🛡️ 当前版本：v${identityStateService.getVersion() || 'unknown'}
👥 授权群数：${licenseCount}`;
  } catch (error) {
    return `🤖 运行状态\n读取失败: ${String(error)}`;
  }
}
