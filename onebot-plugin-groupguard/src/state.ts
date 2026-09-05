// 插件全局状态管理
import type { RuntimeLogger } from './runtime/runtime_context';
import type { OneBotActionClient } from './protocol/onebot11/action_client';
import type { PluginConfig, VerifySession, GroupGuardSettings, ActivityRecord, SigninData, InviteData, BotSendEventRecord } from './types';
import { DEFAULT_PLUGIN_CONFIG } from './config';
import { getBuildInfo } from './build_info';
import type { ReplyPersona } from './types';
import { generateReply, isReplyTemplateSceneAllowed } from './reply_generator';
import { shouldBlockByBotRole } from './core/bot_role';
import { packageForwardMessages, packageOutgoingSegments } from './services/outgoing_risk_packager';

// Build metadata is embedded by Vite and is the single runtime version source.
function getPluginVersion(): string {
  return String(getBuildInfo().version || 'unknown');
}

interface LogEntry {
  time: number;
  level: string;
  msg: string;
}

interface GroupSendTask {
  groupId: string;
  message: any[];
  force: boolean;
  requireDelivery: boolean;
  applyTemplate: boolean;
  scene: string;
  queuedAt: number;
  templateApplied: boolean;
  suffixApplied: boolean;
  suffixMode: string;
  contentLength: number;
  hasMedia: boolean;
  messageType: string;
  resolve: () => void;
  reject: (err?: any) => void;
}

class PluginState {
  /** 插件版本（运行时从 package.json 读取） */
  version: string = getPluginVersion();
  /** NapCat 配置页 HTML，由运行时适配器读取。 */
  configSchemaHtml = '';
  logger: RuntimeLogger | null = null;
  actions: OneBotActionClient | undefined;
  hostProfileId = '';
  workDir = '';
  configPath = '';
  configDir = '';
  dataDir = '';
  backupDir = '';
  dynamicCommandsConfigPath = '';
  config: PluginConfig = JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG));
  sessions: Map<string, VerifySession> = new Map();
  pendingComments: Map<string, string> = new Map();
  botId = '';  // 机器人自身QQ号
  /** 防撤回消息缓存 key: messageId */
  msgCache: Map<string, { userId: string; groupId: string; raw: string; segments: any[]; time: number; }> = new Map();
  /** 刷屏检测缓存 key: `${groupId}:${userId}`, value: 时间戳数组 */
  spamCache: Map<string, number[]> = new Map();
  /** 复读检测缓存 key: `${groupId}:${userId}`, value: { content: string, count: number } */
  repeatCache: Map<string, { content: string; count: number; time?: number }> = new Map();
  /** 调试日志缓冲区 */
  logBuffer: LogEntry[] = [];
  private readonly maxLogEntries = 500;

  /** 管理员权限缓存 key: `${groupId}:${userId}`, value: { role: string, expire: number } */
  adminCache: Map<string, { role: string; expire: number }> = new Map();
  /** 启动时间 */
  startTime: number = Date.now();
  /** 处理消息数 */
  msgCount: number = 0;
  /** 问答关键词冷却缓存 key: `${groupId}:${keyword}` */
  qaCooldownMap: Map<string, number> = new Map();
  /** 全局发送队列 */
  private globalSendQueue: GroupSendTask[] = [];
  /** 分群发送队列 */
  private groupSendQueues: Map<string, GroupSendTask[]> = new Map();
  /** 队列调度索引（分群轮询） */
  private queueRoundRobinIndex = 0;
  /** 当前发送中的 worker 数 */
  private activeWorkers = 0;
  private acceptingSends = true;
  /** TokenBucket 当前令牌 */
  private tokenBucketTokens = 0;
  /** TokenBucket 上次补充时间 */
  private tokenBucketLastRefill = Date.now();
  /** TokenBucket 仅在首次使用时装满，耗尽后只能按时间补充。 */
  private tokenBucketInitialized = false;
  /** 分群发送记录（用于熔断） */
  private groupSendHistory: Map<string, number[]> = new Map();
  /** 分群熔断截止时间 */
  private groupFuseUntil: Map<string, number> = new Map();
  private selfRecallScheduleMap: Map<string, number> = new Map();
  private selfRecallTimers: Map<string, NodeJS.Timeout> = new Map();

  // ===== 内存优化 =====
  /** 清理内存缓存 */
  cleanCache() {
    const now = Date.now();
    // 1. 清理防撤回缓存 (保留 5 分钟)
    for (const [key, val] of this.msgCache.entries()) {
      if (now - val.time > 300000) this.msgCache.delete(key);
    }
    // 2. 清理权限缓存 (保留 10 分钟内未过期)
    for (const [key, val] of this.adminCache.entries()) {
      if (now > val.expire + 600000) this.adminCache.delete(key);
    }
    // 3. 清理会话 (保留 10 分钟)
    for (const [key, val] of this.sessions.entries()) {
      if (now - val.startTime > 600000) this.sessions.delete(key);
    }
    // 4. 限制日志缓冲区
    if (this.logBuffer.length > 200) {
      this.logBuffer = this.logBuffer.slice(-200);
    }
    // 5. 清理问答冷却缓存（最多保留 10 分钟）
    for (const [key, ts] of this.qaCooldownMap.entries()) {
      if (now - ts > 600000) this.qaCooldownMap.delete(key);
    }
    for (const [key, timestamps] of this.spamCache.entries()) {
      const pruned = timestamps.filter(t => now - t < 600000).slice(-300);
      if (pruned.length) this.spamCache.set(key, pruned);
      else this.spamCache.delete(key);
    }
    for (const [key, val] of this.repeatCache.entries()) {
      const lastSeen = Number(val.time || 0);
      if (!lastSeen || now - lastSeen > 600000) this.repeatCache.delete(key);
    }
    if (this.spamCache.size > 5000) {
      for (const key of Array.from(this.spamCache.keys()).slice(0, this.spamCache.size - 5000)) this.spamCache.delete(key);
    }
    if (this.repeatCache.size > 5000) {
      for (const key of Array.from(this.repeatCache.keys()).slice(0, this.repeatCache.size - 5000)) this.repeatCache.delete(key);
    }
    for (const [groupId, list] of this.groupSendHistory.entries()) {
      const pruned = list.filter(t => now - t < 300000);
      if (pruned.length) this.groupSendHistory.set(groupId, pruned);
      else this.groupSendHistory.delete(groupId);
    }
    for (const [groupId, until] of this.groupFuseUntil.entries()) {
      if (now >= until) this.groupFuseUntil.delete(groupId);
    }
  }

  private pushLog (level: string, msg: string): void {
    this.logBuffer.push({ time: Date.now(), level, msg });
    if (this.logBuffer.length > this.maxLogEntries) this.logBuffer.splice(0, this.logBuffer.length - this.maxLogEntries);
  }

  log (level: 'info' | 'warn' | 'error', msg: string): void {
    this.logger?.[level](`[GroupGuard] ${msg}`);
    this.pushLog(level, msg);
  }

  clearLogs(): void {
    this.logBuffer = [];
  }

  debug (msg: string): void {
    if (this.config.debug) {
      this.logger?.info(`[GroupGuard][Debug] ${msg}`);
      this.pushLog('info', `[Debug] ${msg}`);
    }
  }

  getGroupSettings (groupId: string): GroupGuardSettings {
    if (this.config.groups[groupId]) {
      if (this.config.groups[groupId].useGlobal) return this.config.global;
      return { ...this.config.global, ...this.config.groups[groupId] };
    }
    return this.config.global;
  }

  isWhitelisted (userId: string): boolean {
    return this.config.whitelist.includes(userId);
  }

  isBlacklisted (userId: string): boolean {
    return this.config.blacklist.includes(userId);
  }

  isOwner (userId: string): boolean {
    // 强制转换为字符串并分割，防止配置格式错误
    const ownersStr = String(this.config.ownerQQs || '');
    const configOwners = ownersStr.split(/[,，]/).map(s => s.trim()).filter(s => s);
    const target = String(userId);
    const isMatch = configOwners.includes(target);
    
    // 调试日志：输出详细比对信息
    if (this.config.debug) {
         this.log('info', `[AuthCheck] User: "${target}", Config: "${ownersStr}", Parsed: ${JSON.stringify(configOwners)}, Result: ${isMatch}`);
    }
    return isMatch;
  }

  // ===== 辅助方法 =====
  /** 生成随机后缀 */
  private getScenePolicy(scene?: string) {
    const settings = this.getGlobalSettings();
    const policies = settings.botAntiRiskScenePolicies || {};
    return policies[String(scene || 'raw_text')] || {};
  }

  private getRandomSuffixInfo(groupId?: string, scene?: string): { suffix: string; mode: string; } {
    // 强制使用全局配置，防风控策略统一管理
    const settings = this.config.global;
    if (!settings.randomSuffix) return { suffix: '', mode: 'disabled' };
    if (!isReplyTemplateSceneAllowed(scene)) return { suffix: '', mode: 'scene_disabled' };
    const scenePolicy = this.getScenePolicy(scene);
    const globalMode = settings.botAntiRiskSuffixMode || 'punctuation';
    const mode = scenePolicy.suffixMode && scenePolicy.suffixMode !== 'global'
      ? scenePolicy.suffixMode
      : globalMode;
    if (mode === 'none') return { suffix: '', mode };

    const punctuation = [' ', '.', '..', '~'];
    const chars = punctuation;
    const len = Math.floor(Math.random() * 3) + 1;
    let suffix = '';
    for (let i = 0; i < len; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return { suffix, mode };
  }

  private getRandomSuffix(groupId?: string, scene?: string): string {
    return this.getRandomSuffixInfo(groupId, scene).suffix;
  }

  /** 随机延迟 */
  private async randomSleep(groupId?: string, scene?: string): Promise<number> {
    // 强制使用全局配置，防风控策略统一管理
    const settings = this.config.global;
    const scenePolicy = this.getScenePolicy(scene);
    const min = scenePolicy.delayMinMs !== undefined ? Number(scenePolicy.delayMinMs) : (settings.randomDelayMin || 0);
    const max = scenePolicy.delayMaxMs !== undefined ? Number(scenePolicy.delayMaxMs) : (settings.randomDelayMax || 0);
    
    if (max >= min && max > 0) {
      const delay = max === min ? min : Math.floor(Math.random() * (max - min + 1)) + min;
      if (delay > 0) {
        if (this.config.debug) this.log('info', `[AntiRisk] 随机延迟: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return delay;
      }
    }
    return 0;
  }

  private describeMessage(message: any[]): { contentLength: number; hasMedia: boolean; messageType: string; } {
    const list = Array.isArray(message) ? message : [];
    let contentLength = 0;
    let hasMedia = false;
    const types = new Set<string>();
    for (const seg of list) {
      const type = String(seg?.type || 'unknown');
      types.add(type);
      if (type === 'text') contentLength += String(seg?.data?.text || '').length;
      if (type !== 'text') hasMedia = true;
    }
    return {
      contentLength,
      hasMedia,
      messageType: types.size === 1 ? Array.from(types)[0] || 'text' : 'mixed'
    };
  }

  private recordBotSendEvent(entry: BotSendEventRecord): void {
    import('./repositories/groupguard_repository')
      .then(mod => mod.groupguardRepository.insertBotSendEvent(entry))
      .catch((err) => this.debug(`[AntiRisk] bot_send_event_write_failed err=${String(err)}`));
  }

  private getGlobalSettings() {
    return this.config.global || ({} as GroupGuardSettings);
  }

  private getSelfRecallSettings(groupId?: string): GroupGuardSettings {
    const gid = String(groupId || '').trim();
    return gid ? this.getGroupSettings(gid) : this.getGlobalSettings();
  }

  private packageOutgoingMessage(groupId: string, scene: string, message: any[], channel: 'group' | 'private' | 'forward' = 'group'): any[] {
    const settings = channel === 'private' ? this.getGlobalSettings() : this.getGroupSettings(groupId);
    const packed = packageOutgoingSegments(message, settings, scene, channel);
    if (packed.urlCount > 0) {
      const action = packed.changed ? 'wrapped' : 'detected';
      this.log('warn', `[OutgoingRisk] url_${action} channel=${channel} group=${groupId || '-'} scene=${scene || 'raw_text'} count=${packed.urlCount}`);
    }
    return packed.message;
  }

  private getQueueConcurrency(): number {
    const n = Number(this.getGlobalSettings().queueConcurrency || 1);
    return Math.max(1, Math.min(20, Number.isFinite(n) ? n : 1));
  }

  private getQueueMode(): 'global' | 'group' {
    return this.getGlobalSettings().queueMode === 'global' ? 'global' : 'group';
  }

  private getMaxQueueSizeGlobal(): number {
    const n = Number(this.getGlobalSettings().maxQueueSizeGlobal ?? 3000);
    return Math.max(100, Number.isFinite(n) ? n : 3000);
  }

  private getMaxQueueSizePerGroup(): number {
    const n = Number(this.getGlobalSettings().maxQueueSizePerGroup ?? 120);
    return Math.max(20, Number.isFinite(n) ? n : 120);
  }

  private randomBetweenMs(minMs: number, maxMs: number): number {
    const min = Math.max(0, Math.floor(minMs));
    const max = Math.max(min, Math.floor(maxMs));
    if (max <= min) return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private computeSelfRecallDelayMs(groupId?: string): number {
    const globalSettings = this.getSelfRecallSettings(groupId);
    const globalPolicy = globalSettings?.selfRecall;
    const enabled = (globalPolicy ? globalPolicy.enabled === true : false) || globalSettings?.autoRecallSelf === true;
    if (!enabled) return -1;
    const policy = globalPolicy;
    const delaySeed = Math.min(300, Math.max(0, Number(globalSettings?.autoRecallSelfDelay ?? 60)));
    const mode = policy?.mode === 'random' ? 'random' : 'fixed';
    const fixedDelayMs = Math.min(300000, Math.max(0, Number(policy?.fixedDelay ?? delaySeed)) * 1000);
    const minDelayMs = Math.min(300000, Math.max(0, Number(policy?.minDelay ?? Math.max(0, delaySeed - 15)) * 1000));
    const maxDelayMs = Math.min(300000, Math.max(minDelayMs, Number(policy?.maxDelay ?? Math.max(delaySeed, delaySeed + 30)) * 1000));
    const jitterMs = Math.min(300000, Math.max(0, Number(policy?.jitter ?? 0)) * 1000);
    const base = mode === 'random' ? this.randomBetweenMs(minDelayMs, maxDelayMs) : fixedDelayMs;
    return Math.min(300000, base + this.randomBetweenMs(0, jitterMs));
  }

  private shouldScheduleSelfRecall(groupId?: string): boolean {
    const settings = this.getSelfRecallSettings(groupId);
    const p = Number(settings.selfRecall?.probability ?? settings.autoRecallSelfProbability ?? 100);
    const probability = Math.max(0, Math.min(100, Number.isFinite(p) ? p : 100));
    return Math.random() * 100 < probability;
  }

  private extractSendMessageId(res: any): string {
    const direct = res?.message_id ?? res?.messageId;
    if (direct !== undefined && direct !== null && `${direct}` !== '') return String(direct);
    const nested = res?.data?.message_id ?? res?.data?.messageId ?? res?.retdata?.message_id ?? res?.retdata?.messageId;
    if (nested !== undefined && nested !== null && `${nested}` !== '') return String(nested);
    return '';
  }

  scheduleSelfRecall(groupId: string, messageId: string, source: 'send_group_msg' | 'message_event' = 'send_group_msg'): number {
    const gid = String(groupId || '');
    const msgId = String(messageId || '');
    const roleBlock = shouldBlockByBotRole({ source: 'send_wrapper', rawMessage: `group=${gid} message=${msgId}`, intent: 'self_recall_like', actionType: 'self_recall' });
    if (roleBlock.blocked) {
      this.debug(roleBlock.logLine || `bot_role_blocked role=${roleBlock.role} intent=self_recall_like rawMessage=group=${gid} message=${msgId} source=send_wrapper`);
      return 0;
    }
    if (!gid || !msgId) {
      this.debug(`[SelfRecall] skipped reason=msgId_missing source=${source} groupId=${gid || 'unknown'}`);
      return 0;
    }
    const delay = this.computeSelfRecallDelayMs(gid);
    if (delay < 0) {
      this.debug(`[SelfRecall] skipped reason=disabled source=${source} groupId=${gid} msgId=${msgId}`);
      return 0;
    }
    if (!this.shouldScheduleSelfRecall(gid)) {
      this.debug(`[SelfRecall] skipped reason=probability source=${source} groupId=${gid} msgId=${msgId}`);
      return 0;
    }
    const now = Date.now();
    for (const [k, ts] of this.selfRecallScheduleMap.entries()) {
      if (now - ts > 5 * 60 * 1000) this.selfRecallScheduleMap.delete(k);
    }
    const dedupKey = `${gid}:${msgId}`;
    if (this.selfRecallScheduleMap.has(dedupKey)) {
      this.debug(`[SelfRecall] skipped reason=duplicate_schedule source=${source} groupId=${gid} msgId=${msgId}`);
      return 0;
    }
    this.selfRecallScheduleMap.set(dedupKey, now);
    const taskId = `${gid}:${msgId}`;
    const reason = source === 'send_group_msg' ? 'self_recall_send_queue' : 'self_recall_event';
    const dueAt = now + delay;
    this.debug(`[SelfRecall] enqueue source=${source} groupId=${gid} msgId=${msgId} delay=${delay}`);
    import('./repositories/groupguard_repository')
      .then(mod => mod.groupguardRepository.scheduleSelfRecallTask({
        taskId,
        groupId: gid,
        messageId: msgId,
        reason,
        source,
        dueAt,
        maxAttempts: 6
      }))
      .catch((err) => {
        this.debug(`[SelfRecall] persist_failed source=${source} groupId=${gid} msgId=${msgId} err=${String(err)}`);
      });
    const timer = setTimeout(() => {
      this.selfRecallTimers.delete(dedupKey);
      import('./services/action_queue_service')
        .then(mod => mod.enqueueSelfRecallAction({
          taskId,
          groupId: gid,
          messageId: msgId,
          reason,
          source,
          automatic: false,
          allowSelfTarget: true,
          maxRetries: 6
        }))
        .then((result) => {
          this.debug(`[SelfRecall] enqueue_result source=${source} groupId=${gid} msgId=${msgId} code=${result.code}`);
        })
        .catch((err) => {
          this.debug(`[SelfRecall] enqueue_failed source=${source} groupId=${gid} msgId=${msgId} err=${String(err)}`);
        });
    }, delay);
    timer.unref?.();
    this.selfRecallTimers.set(dedupKey, timer);
    return dueAt;
  }

  clearSelfRecallTimers(): void {
    for (const timer of this.selfRecallTimers.values()) clearTimeout(timer);
    this.selfRecallTimers.clear();
    this.selfRecallScheduleMap.clear();
  }

  private applyReplyTemplate(text: string): string {
    const settings = this.getGlobalSettings();
    const templates = Array.isArray(settings.replyTemplatePool)
      ? settings.replyTemplatePool.filter(t => typeof t === 'string' && t.includes('{msg}'))
      : [];
    if (!templates.length) return text;
    const tpl = templates[Math.floor(Math.random() * templates.length)] || '{msg}';
    return tpl.replace(/\{msg\}/g, text);
  }

  private isReplyTemplateDisabled(): boolean {
    return this.getGlobalSettings().disableReplyTemplate === true;
  }

  private shouldSendByProbability(scene?: string): boolean {
    const settings = this.getGlobalSettings();
    const scenePolicy = this.getScenePolicy(scene);
    const p = Number(scenePolicy.replyProbability ?? settings.replyProbability ?? 100);
    const probability = Math.max(0, Math.min(100, Number.isFinite(p) ? p : 100));
    return Math.random() * 100 < probability;
  }

  private refillTokens(perMinute: number, now = Date.now()): void {
    if (!this.tokenBucketInitialized) {
      this.tokenBucketTokens = perMinute;
      this.tokenBucketLastRefill = now;
      this.tokenBucketInitialized = true;
      return;
    }
    // 配置下调时立即收紧桶容量，不能继续消费旧的超额令牌。
    this.tokenBucketTokens = Math.min(perMinute, this.tokenBucketTokens);
    const elapsed = now - this.tokenBucketLastRefill;
    if (elapsed <= 0) return;
    const refill = elapsed * (perMinute / 60000);
    this.tokenBucketTokens = Math.min(perMinute, this.tokenBucketTokens + refill);
    this.tokenBucketLastRefill = now;
  }

  private async acquireToken(): Promise<boolean> {
    const settings = this.getGlobalSettings();
    const perMinuteRaw = Number(settings.globalMaxPerMinute ?? 180);
    const perMinute = Math.max(1, Number.isFinite(perMinuteRaw) ? perMinuteRaw : 180);
    const enqueueOnLimit = settings.rateLimitEnqueue !== false;
    // JavaScript 在第一个 await 前按顺序执行；补充和扣减放在同一同步区间，
    // 并发调用也不会消费同一枚令牌。
    this.refillTokens(perMinute);
    if (this.tokenBucketTokens >= 1) {
      this.tokenBucketTokens -= 1;
      return true;
    }
    if (!enqueueOnLimit) return false;
    const need = 1 - this.tokenBucketTokens;
    const waitMs = Math.max(30, Math.ceil(need * (60000 / perMinute)));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.acquireToken();
  }

  private settleDroppedGroupTask(task: GroupSendTask, reason: string): void {
    this.recordBotSendEvent({
      groupId: task.groupId,
      scene: task.scene,
      messageType: task.messageType,
      contentLength: task.contentLength,
      hasMedia: task.hasMedia,
      force: task.force,
      applyTemplate: task.applyTemplate,
      templateApplied: task.templateApplied,
      suffixApplied: task.suffixApplied,
      suffixMode: task.suffixMode,
      randomDelayMs: 0,
      queuedAt: task.queuedAt,
      status: 'dropped',
      reason,
      createdAt: Date.now()
    });
    if (task.requireDelivery) task.reject(new Error(`group_send_not_delivered:${reason}`));
    else task.resolve();
  }

  private cloneMessage(message: any[]): any[] {
    return Array.isArray(message) ? message.map(seg => ({ ...seg, data: seg?.data ? { ...seg.data } : seg?.data })) : [];
  }

  private isGroupFused(groupId: string): boolean {
    const until = this.groupFuseUntil.get(groupId) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this.groupFuseUntil.delete(groupId);
      return false;
    }
    return true;
  }

  private markGroupSend(groupId: string): void {
    const settings = this.getGlobalSettings();
    const windowSec = Math.max(10, Number(settings.groupFuseWindowSeconds ?? 60));
    const threshold = Math.max(10, Number(settings.groupFuseThreshold ?? 45));
    const cooldownSec = Math.max(10, Number(settings.groupFuseCooldownSeconds ?? 90));
    const now = Date.now();
    const history = (this.groupSendHistory.get(groupId) || []).filter(t => now - t < windowSec * 1000);
    history.push(now);
    this.groupSendHistory.set(groupId, history);
    if (history.length >= threshold) {
      this.groupFuseUntil.set(groupId, now + cooldownSec * 1000);
      this.log('warn', `群 ${groupId} 触发发送熔断，持续 ${cooldownSec}s`);
    }
  }

  private enqueueGroupTask(groupId: string, message: any[], options?: { force?: boolean; requireDelivery?: boolean; applyTemplate?: boolean; scene?: string; templateApplied?: boolean; suffixApplied?: boolean; suffixMode?: string; }): Promise<void> {
    if (!this.acceptingSends) return Promise.reject(new Error('group_send_shutting_down'));
    if (!this.actions) {
      return options?.requireDelivery
        ? Promise.reject(new Error('group_send_transport_unavailable'))
        : Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const desc = this.describeMessage(message);
      const task: GroupSendTask = {
        groupId,
        message,
        force: options?.force === true,
        requireDelivery: options?.requireDelivery === true,
        applyTemplate: options?.applyTemplate !== false,
        scene: options?.scene || 'raw_text',
        queuedAt: Date.now(),
        templateApplied: options?.templateApplied === true,
        suffixApplied: options?.suffixApplied === true,
        suffixMode: options?.suffixMode || '',
        contentLength: desc.contentLength,
        hasMedia: desc.hasMedia,
        messageType: desc.messageType,
        resolve,
        reject
      };
      if (this.getQueueMode() === 'global') {
        if (this.globalSendQueue.length >= this.getMaxQueueSizeGlobal()) {
          this.settleDroppedGroupTask(task, task.force ? 'send_queue_force_overflow' : 'send_queue_overflow');
          return;
        }
        this.globalSendQueue.push(task);
      } else {
        const q = this.groupSendQueues.get(groupId) || [];
        if (q.length >= this.getMaxQueueSizePerGroup()) {
          this.settleDroppedGroupTask(task, task.force ? 'group_send_queue_force_overflow' : 'group_send_queue_overflow');
          return;
        }
        q.push(task);
        this.groupSendQueues.set(groupId, q);
      }
      this.kickQueueWorkers();
    });
  }

  private pickNextTask(): GroupSendTask | null {
    // 配置可在运行时切换。先排空旧模式残留队列，避免新流量持续进入后
    // 让旧任务永久饥饿、对应 Promise 悬空。
    if (this.getQueueMode() === 'global') {
      return this.pickNextGroupTask() || this.globalSendQueue.shift() || null;
    }
    return this.globalSendQueue.shift() || this.pickNextGroupTask();
  }

  private pickNextGroupTask(): GroupSendTask | null {
    const keys = Array.from(this.groupSendQueues.keys());
    if (!keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const idx = (this.queueRoundRobinIndex + i) % keys.length;
      const gid = keys[idx];
      const q = this.groupSendQueues.get(gid);
      if (q && q.length) {
        const task = q.shift() || null;
        if (!q.length) this.groupSendQueues.delete(gid);
        this.queueRoundRobinIndex = idx + 1;
        return task;
      }
    }
    return null;
  }

  private kickQueueWorkers(): void {
    const maxWorkers = this.getQueueConcurrency();
    while (this.activeWorkers < maxWorkers) {
      const task = this.pickNextTask();
      if (!task) return;
      this.activeWorkers += 1;
      this.processTask(task)
        .catch(err => this.log('error', `队列发送异常: ${err}`))
        .finally(() => {
          this.activeWorkers = Math.max(0, this.activeWorkers - 1);
          this.kickQueueWorkers();
        });
    }
  }

  private async processTask(task: GroupSendTask): Promise<void> {
    try {
      if (!task.force && this.isGroupFused(task.groupId)) {
        if (await this.sendGroupForwardFallback(task, 'group_send_fused')) {
          task.resolve();
          return;
        }
        this.recordBotSendEvent({
          groupId: task.groupId,
          scene: task.scene,
          messageType: task.messageType,
          contentLength: task.contentLength,
          hasMedia: task.hasMedia,
          force: task.force,
          applyTemplate: task.applyTemplate,
          templateApplied: task.templateApplied,
          suffixApplied: task.suffixApplied,
          suffixMode: task.suffixMode,
          randomDelayMs: 0,
          queuedAt: task.queuedAt,
          status: 'dropped',
          reason: 'group_send_fused',
          createdAt: Date.now()
        });
        if (task.requireDelivery) task.reject(new Error('group_send_not_delivered:group_send_fused'));
        else task.resolve();
        return;
      }
      const randomDelayMs = await this.randomSleep(task.groupId, task.scene);
      const canSend = await this.acquireToken();
      if (!canSend) {
        if (await this.sendGroupForwardFallback(task, 'send_rate_limited', randomDelayMs)) {
          task.resolve();
          return;
        }
        this.recordBotSendEvent({
          groupId: task.groupId,
          scene: task.scene,
          messageType: task.messageType,
          contentLength: task.contentLength,
          hasMedia: task.hasMedia,
          force: task.force,
          applyTemplate: task.applyTemplate,
          templateApplied: task.templateApplied,
          suffixApplied: task.suffixApplied,
          suffixMode: task.suffixMode,
          randomDelayMs,
          queuedAt: task.queuedAt,
          status: 'dropped',
          reason: 'send_rate_limited',
          createdAt: Date.now()
        });
        if (task.requireDelivery) task.reject(new Error('group_send_not_delivered:send_rate_limited'));
        else task.resolve();
        return;
      }
      const sent = await this.sendGroupMessageRaw(task.groupId, task.message);
      this.recordBotSendEvent({
        groupId: task.groupId,
        scene: task.scene,
        messageType: task.messageType,
        messageId: sent.messageId,
        contentLength: task.contentLength,
        hasMedia: task.hasMedia,
        force: task.force,
        applyTemplate: task.applyTemplate,
        templateApplied: task.templateApplied,
        suffixApplied: task.suffixApplied,
        suffixMode: task.suffixMode,
        randomDelayMs,
        queuedAt: task.queuedAt,
        sentAt: sent.sentAt,
        selfRecallDueAt: sent.selfRecallDueAt,
        status: 'sent',
        createdAt: Date.now()
      });
      this.markGroupSend(task.groupId);
      task.resolve();
    } catch (e) {
      this.recordBotSendEvent({
        groupId: task.groupId,
        scene: task.scene,
        messageType: task.messageType,
        contentLength: task.contentLength,
        hasMedia: task.hasMedia,
        force: task.force,
        applyTemplate: task.applyTemplate,
        templateApplied: task.templateApplied,
        suffixApplied: task.suffixApplied,
        suffixMode: task.suffixMode,
        randomDelayMs: 0,
        queuedAt: task.queuedAt,
        status: 'failed',
        reason: String(e),
        createdAt: Date.now()
      });
      this.log('error', `发送群消息失败: ${e}`);
      task.reject(e);
    }
  }

  private async sendGroupMessageRaw(groupId: string, message: any[]): Promise<{ messageId: string; sentAt: number; selfRecallDueAt: number; }> {
    if (!this.actions) throw new Error('group_send_transport_unavailable');
    const res = await this.actions.call('send_group_msg', {
      group_id: groupId,
      message
    } as never) as { message_id?: number | string };
    const messageId = this.extractSendMessageId(res);
    this.debug(`[SelfRecall] message_sent groupId=${groupId} msgId=${messageId || 'missing'}`);
    const selfRecallDueAt = this.scheduleSelfRecall(groupId, messageId, 'send_group_msg');
    return { messageId, sentAt: Date.now(), selfRecallDueAt };
  }

  resumeSendQueue(): void {
    this.acceptingSends = true;
  }

  async drainSendQueue(timeoutMs = 30_000): Promise<void> {
    this.acceptingSends = false;
    const deadline = Date.now() + Math.max(1, timeoutMs);
    while (this.activeWorkers > 0 || this.globalSendQueue.length > 0 || this.groupSendQueues.size > 0) {
      if (Date.now() >= deadline) {
        const error = new Error('group_send_drain_timeout');
        const queued = [
          ...this.globalSendQueue.splice(0),
          ...Array.from(this.groupSendQueues.values()).flatMap(queue => queue.splice(0)),
        ];
        this.groupSendQueues.clear();
        for (const task of queued) task.reject(error);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /** 发送群消息 (Text) */
  private async sendGroupForwardFallback(task: GroupSendTask, reason: string, randomDelayMs = 0): Promise<boolean> {
    if (!this.actions) return false;
    const settings = this.getGlobalSettings();
    if (settings.botAntiRiskLimitFallbackMode !== 'forward') return false;
    try {
      const res = await this.actions.call('send_group_forward_msg', {
        group_id: task.groupId,
        messages: [{
          type: 'node',
          data: {
            nickname: 'GroupGuard',
            user_id: this.botId || '0',
            content: task.message
          }
        }]
      } as never) as { message_id?: number | string };
      this.log('warn', `forward_send_direct source=send_queue_fallback group=${task.groupId} reason=${reason}`);
      const messageId = this.extractSendMessageId(res);
      const sentAt = Date.now();
      const selfRecallDueAt = this.scheduleSelfRecall(task.groupId, messageId, 'send_group_msg');
      this.markGroupSend(task.groupId);
      this.recordBotSendEvent({
        groupId: task.groupId,
        scene: task.scene,
        messageType: 'forward',
        messageId,
        contentLength: task.contentLength,
        hasMedia: task.hasMedia,
        force: task.force,
        applyTemplate: task.applyTemplate,
        templateApplied: task.templateApplied,
        suffixApplied: task.suffixApplied,
        suffixMode: task.suffixMode,
        randomDelayMs,
        queuedAt: task.queuedAt,
        sentAt,
        selfRecallDueAt,
        status: 'sent',
        reason: `forward_fallback_${reason}`,
        createdAt: Date.now()
      });
      return true;
    } catch (e) {
      this.log('warn', `合并转发兜底发送失败: ${String(e)}`);
      return false;
    }
  }

  async sendGroupText (groupId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; requireDelivery?: boolean; }): Promise<void> {
    if (!this.actions) {
      if (options?.requireDelivery) throw new Error('group_send_transport_unavailable');
      return;
    }
    const templateDisabled = this.isReplyTemplateDisabled();
    const scene = options?.scene || 'raw_text';
    const allowSemanticTemplate = isReplyTemplateSceneAllowed(scene);
    const settings = this.getGroupSettings(groupId);
    const renderedText = templateDisabled || !allowSemanticTemplate
      ? content
      : generateReply({
        scene,
        raw: content,
        vars: options?.vars,
        persona: options?.persona,
        settings
      }).text;
    const force = options?.force === true;
    const applyTemplate = options?.applyTemplate !== false;
    if (!force && options?.skipProbability !== true && !this.shouldSendByProbability(scene)) return;
    const templated = (!templateDisabled && allowSemanticTemplate && applyTemplate) ? this.applyReplyTemplate(renderedText) : renderedText;
    const suffixInfo = this.getRandomSuffixInfo(groupId, scene);
    const suffix = suffixInfo.suffix;
    const finalContent = templated + suffix;
    const outgoingMessage = this.packageOutgoingMessage(groupId, scene, [{ type: 'text', data: { text: finalContent } }], 'group');
    await this.enqueueGroupTask(groupId, outgoingMessage, {
      force,
      requireDelivery: options?.requireDelivery === true,
      applyTemplate,
      scene,
      templateApplied: !templateDisabled && applyTemplate,
      suffixApplied: !!suffix,
      suffixMode: suffix ? suffixInfo.mode : ''
    });
  }

  /** 发送群消息 (Array) */
  async sendGroupMsg (groupId: string, message: any[], options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; skipProbability?: boolean; requireDelivery?: boolean; }): Promise<void> {
    if (!this.actions) {
      if (options?.requireDelivery) throw new Error('group_send_transport_unavailable');
      return;
    }
    const force = options?.force === true;
    const applyTemplate = options?.applyTemplate !== false;
    const templateDisabled = this.isReplyTemplateDisabled();
    const scene = options?.scene || 'raw_text';
    const allowSemanticTemplate = isReplyTemplateSceneAllowed(scene);
    if (!force && options?.skipProbability !== true && !this.shouldSendByProbability(scene)) return;
    const cloned = this.cloneMessage(message);
    const firstText = cloned.find(seg => seg && seg.type === 'text' && seg.data && typeof seg.data.text === 'string');
    if (firstText) {
      const renderedText = templateDisabled
        || !allowSemanticTemplate
        ? String(firstText.data.text || '')
        : generateReply({
          scene,
          raw: String(firstText.data.text || ''),
          vars: options?.vars,
          persona: options?.persona,
          settings: this.getGroupSettings(groupId)
        }).text;
      firstText.data.text = (!templateDisabled && allowSemanticTemplate && applyTemplate) ? this.applyReplyTemplate(renderedText) : renderedText;
    }
    const suffixInfo = this.getRandomSuffixInfo(groupId, scene);
    const suffix = suffixInfo.suffix;
    if (suffix && Array.isArray(cloned)) {
      const lastNode = cloned[cloned.length - 1];
      if (lastNode && lastNode.type === 'text' && lastNode.data) {
        lastNode.data.text += suffix;
      } else {
        cloned.push({ type: 'text', data: { text: suffix } });
      }
    }
    const outgoingMessage = this.packageOutgoingMessage(groupId, scene, cloned, 'group');
    await this.enqueueGroupTask(groupId, outgoingMessage, {
      force,
      requireDelivery: options?.requireDelivery === true,
      applyTemplate,
      scene,
      templateApplied: !templateDisabled && applyTemplate && !!firstText,
      suffixApplied: !!suffix,
      suffixMode: suffix ? suffixInfo.mode : ''
    });
  }

  /** 发送私聊消息 (Text) */
  async sendPrivateMsg (userId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; scene?: string; vars?: Record<string, string | number | boolean>; persona?: ReplyPersona; requireDelivery?: boolean; }): Promise<void> {
    if (!this.actions) {
      if (options?.requireDelivery) throw new Error('private_send_transport_unavailable');
      return;
    }
    const force = options?.force === true;
    const applyTemplate = options?.applyTemplate !== false;
    const templateDisabled = this.isReplyTemplateDisabled();
    const scene = options?.scene || 'raw_text';
    const allowSemanticTemplate = isReplyTemplateSceneAllowed(scene);
    if (!force && !this.shouldSendByProbability(scene)) return;
    const renderedText = templateDisabled || !allowSemanticTemplate
      ? content
      : generateReply({
        scene,
        raw: content,
        vars: options?.vars,
        persona: options?.persona,
        settings: this.config.global
      }).text;

    await this.randomSleep(undefined, scene);

    const suffix = this.getRandomSuffix(undefined, scene);
    const templated = (!templateDisabled && allowSemanticTemplate && applyTemplate) ? this.applyReplyTemplate(renderedText) : renderedText;
    const finalContent = templated + suffix;
    const outgoingMessage = this.packageOutgoingMessage('', scene, [{ type: 'text', data: { text: finalContent } }], 'private');

    try {
      await this.actions.call('send_private_msg', {
        user_id: userId,
        message: outgoingMessage
      } as never);
    } catch (e) {
      this.log('error', `发送私聊消息失败: ${e}`);
      if (options?.requireDelivery) throw e;
    }
  }

  /** 调用 API */
  async callApi (action: string, params: any): Promise<any> {
    if (!this.actions) return;
    
    // 针对 delete_msg 做特殊处理 (类型转换 + 重试机制)
    if (action === 'delete_msg' && params && params.message_id) {
        // 某些 NT 版本下，message_id 作为 string 传递更稳定
        params.message_id = String(params.message_id);
    }
    if (action === 'send_group_msg' && params && Array.isArray(params.message)) {
      const groupId = String(params.group_id ?? params.groupId ?? '');
      const scene = String(params.__groupguard_scene || 'raw_text');
      params = { ...params, message: this.packageOutgoingMessage(groupId, scene, params.message, 'group') };
    }
    if (action === 'send_private_msg' && params && Array.isArray(params.message)) {
      const scene = String(params.__groupguard_scene || 'raw_text');
      params = { ...params, message: this.packageOutgoingMessage('', scene, params.message, 'private') };
    }
    if (action === 'send_group_forward_msg' && params && Array.isArray(params.messages)) {
      const groupId = String(params.group_id ?? params.groupId ?? '');
      const settings = this.getGroupSettings(groupId);
      const scene = String(params.__groupguard_scene || 'raw_text');
      const packed = packageForwardMessages(params.messages, settings, scene);
      if (packed.urlCount > 0) {
        const actionText = packed.changed ? 'wrapped' : 'detected';
        this.log('warn', `[OutgoingRisk] url_${actionText} channel=forward group=${groupId || '-'} scene=raw_text count=${packed.urlCount}`);
      }
      params = { ...params, messages: packed.messages };
    }

    try {
      return await this.actions.call(action, params as never);
    } catch (e: any) {
      const errMsg = String(e);
      
      // 针对 delete_msg 的特殊优化
      if (action === 'delete_msg') {
        this.log('error', `撤回消息 API 调用失败: ${errMsg}`);
        throw e;
      }

      this.log('error', `API调用失败 [${action}]: ${e}`);
      return null;
    }
  }

  /** 检查机器人是否为管理员 */
  async isBotAdmin(groupId: string): Promise<boolean> {
    if (!this.botId) throw new Error('bot_identity_unavailable');
    if (!this.actions) throw new Error('group_send_transport_unavailable');
    const info = await this.actions.call('get_group_member_info', { group_id: groupId, user_id: this.botId } as never) as any;
    return info?.role === 'admin' || info?.role === 'owner';
  }
}

export const pluginState = new PluginState();
