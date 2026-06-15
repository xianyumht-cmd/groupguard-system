import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { send } from '../dynamic-commands/response_capture_runtime';
import { saveConfig } from '../commands/common';
import { groupguardRepository } from '../repositories/groupguard_repository';
import {
  enqueueBanAction,
  enqueueKickAction,
  enqueueRecallAction
} from '../services/action_queue_service';
import type { RiskAssessment, PolicyAction, PolicyDecision, RiskSignal } from './signals';
import { riskAuditLog, type PolicyActionAuditResult } from './audit_log';
import type { AuditEventRecord, StandardAuditPayload } from '../types';

export interface ManualPolicyActionInput {
  type: 'ban' | 'kick';
  groupId: string;
  userId: string;
  reason: string;
  durationSeconds?: number;
  rejectAddRequest?: boolean;
  ignoreTargetProtection?: boolean;
  maxRetries?: number;
}

function randomDelayMs(minMs: number, maxMs: number): number {
  const min = Math.max(0, Math.floor(minMs));
  const max = Math.max(min, Math.floor(maxMs));
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function maskedKeyword(raw: unknown): string {
  const value = String(raw || '');
  return value.length > 1 ? value[0] + '*'.repeat(value.length - 1) : '*';
}

type LinkedPolicyActionResult = { ok: boolean; code: string; taskId?: string; actionId?: string; };

function action(input: Omit<PolicyAction, 'automatic'>): PolicyAction {
  return { ...input, automatic: true };
}

function expectedQueueTaskId(policyAction: PolicyAction): string {
  if (policyAction.type === 'recall') return `${policyAction.groupId}:${policyAction.messageId || ''}:recall`;
  if (policyAction.type === 'ban') return `${policyAction.groupId}:ban:${policyAction.userId}`;
  if (policyAction.type === 'kick') return `${policyAction.groupId}:kick:${policyAction.userId}`;
  return '';
}

function createManualCorrelationId(input: ManualPolicyActionInput): string {
  const seq = Math.random().toString(36).slice(2, 8);
  return `manual-${Date.now().toString(36)}-${String(input.type || 'action')}-${String(input.groupId || '0')}-${String(input.userId || '0')}-${seq}`;
}

export class PolicyEngine {
  decide(assessment: RiskAssessment): PolicyDecision {
    const signal = assessment.signal;
    const settings = configStateService.resolveGroupSettings(signal.groupId);
    const actions: PolicyAction[] = [];
    const notifications: PolicyDecision['notifications'] = [];

    if (signal.kind === 'target_user_message') {
      actions.push(action({
        type: 'recall',
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId,
        reason: 'target_user'
      }));
    }

    if (signal.kind === 'media_filter') {
      actions.push(action({
        type: 'recall',
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId,
        reason: String(signal.evidence?.actionReason || signal.reason)
      }));
    }

    if (signal.kind === 'blacklist_message') {
      const mode = settings.blacklistAction || 'recall';
      if (mode === 'ban') {
        const minutes = Math.max(1, Number(settings.blacklistBanMinutes ?? 30));
        actions.push(action({
          type: 'ban',
          groupId: signal.groupId,
          userId: signal.userId,
          durationSeconds: minutes * 60,
          reason: 'blacklist'
        }));
      } else if (mode === 'kick' || mode === 'kick_and_block') {
        if (mode === 'kick_and_block') {
          actions.push(action({
            type: 'add_global_blacklist',
            groupId: signal.groupId,
            userId: signal.userId,
            reason: 'blacklist_kick_and_block'
          }));
        }
        const minDelay = Math.max(0, Number(settings.blacklistKickDelayMinSeconds ?? settings.kickDelayMinSeconds ?? 5)) * 1000;
        const maxDelay = Math.max(minDelay, Number(settings.blacklistKickDelayMaxSeconds ?? settings.kickDelayMaxSeconds ?? 20)) * 1000;
        actions.push(action({
          type: 'kick',
          groupId: signal.groupId,
          userId: signal.userId,
          reason: mode === 'kick_and_block' ? 'blacklist_kick_and_block' : 'blacklist',
          rejectAddRequest: settings.blacklistKickRejectAddRequest !== false,
          delayMs: randomDelayMs(minDelay, maxDelay)
        }));
      } else {
        actions.push(action({
          type: 'recall',
          groupId: signal.groupId,
          userId: signal.userId,
          messageId: signal.messageId,
          reason: 'blacklist'
        }));
      }
    }

    if (signal.kind === 'blacklist_join') {
      actions.push(action({
        type: 'kick',
        groupId: signal.groupId,
        userId: signal.userId,
        reason: 'blacklist_join',
        rejectAddRequest: settings.blacklistKickRejectAddRequest !== false
      }));
    }

    if (signal.kind === 'keyword_filter') {
      const matched = String(signal.evidence?.matched || '');
      const masked = maskedKeyword(matched);
      const level = Number(signal.evidence?.level ?? settings.filterPunishLevel ?? 1);
      actions.push(action({
        type: 'recall',
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId,
        reason: 'keyword_filter'
      }));
      if (level >= 2) {
        const banMin = Math.max(1, Number(signal.evidence?.banMinutes ?? settings.filterBanMinutes ?? 10));
        actions.push(action({
          type: 'ban',
          groupId: signal.groupId,
          userId: signal.userId,
          durationSeconds: banMin * 60,
          reason: 'keyword_filter'
        }));
        notifications.push({
          channel: 'group',
          targetId: signal.groupId,
          message: `⚠️ ${signal.userId} 消息已撤回并禁言 ${banMin} 分钟，原因：触发违禁词「${masked}」`
        });
      }
      if (level >= 3) {
        actions.push(action({
          type: 'kick',
          groupId: signal.groupId,
          userId: signal.userId,
          rejectAddRequest: false,
          reason: 'keyword_filter'
        }));
        notifications.push({
          channel: 'group',
          targetId: signal.groupId,
          message: `⚠️ ${signal.userId} 已被移出群聊，原因：触发违禁词「${masked}」`
        });
      }
      if (level >= 4) {
        actions.push(action({
          type: 'add_global_blacklist',
          groupId: signal.groupId,
          userId: signal.userId,
          reason: 'keyword_filter'
        }));
        notifications.push({
          channel: 'group',
          targetId: signal.groupId,
          message: `⚠️ ${signal.userId} 已被加入黑名单，原因：触发违禁词「${masked}」`
        });
      }
    }

    if (signal.kind === 'spam_rate' || signal.kind === 'spam_repeat') {
      const banMin = Math.max(1, Number(signal.evidence?.banMinutes ?? settings.spamBanMinutes ?? 5));
      actions.push(action({
        type: 'ban',
        groupId: signal.groupId,
        userId: signal.userId,
        durationSeconds: banMin * 60,
        reason: signal.kind === 'spam_rate' ? 'spam_rate' : 'spam_repeat'
      }));
      notifications.push({
        channel: 'group',
        targetId: signal.groupId,
        message: `⚠️ ${signal.userId} 刷屏检测触发（${signal.kind === 'spam_rate' ? '频率' : '复读'}），已禁言 ${banMin} 分钟`
      });
    }

    if (signal.kind === 'verify_non_number' || signal.kind === 'verify_wrong_answer') {
      actions.push(action({
        type: 'recall',
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId,
        reason: signal.kind
      }));
    }

    if (signal.kind === 'verify_timeout' || signal.kind === 'verify_exhausted') {
      actions.push(action({
        type: 'kick',
        groupId: signal.groupId,
        userId: signal.userId,
        rejectAddRequest: false,
        reason: signal.kind
      }));
    }

    return {
      signal,
      assessment,
      actions,
      notifications,
      handled: actions.length > 0 || notifications.length > 0,
      reason: actions.length ? 'policy_actions_selected' : 'no_policy_action'
    };
  }
}

export const policyEngine = new PolicyEngine();

async function executeAction(policyAction: PolicyAction, ctx?: unknown): Promise<LinkedPolicyActionResult> {
  const run = async () => {
    if (policyAction.type === 'recall') {
      return enqueueRecallAction({
        groupId: policyAction.groupId,
        messageId: String(policyAction.messageId || ''),
        targetUserId: policyAction.userId,
        reason: policyAction.reason,
        automatic: policyAction.automatic,
        maxRetries: policyAction.maxRetries ?? 1
      });
    }
    if (policyAction.type === 'ban') {
      return enqueueBanAction({
        groupId: policyAction.groupId,
        userId: policyAction.userId,
        durationSeconds: policyAction.durationSeconds || 0,
        reason: policyAction.reason,
        automatic: policyAction.automatic,
        ignoreTargetProtection: policyAction.ignoreTargetProtection,
        maxRetries: policyAction.maxRetries ?? 1
      });
    }
    if (policyAction.type === 'kick') {
      return enqueueKickAction({
        groupId: policyAction.groupId,
        userId: policyAction.userId,
        reason: policyAction.reason,
        rejectAddRequest: policyAction.rejectAddRequest,
        automatic: policyAction.automatic,
        maxRetries: policyAction.maxRetries ?? 1
      });
    }
    if (policyAction.type === 'add_global_blacklist') {
      const config = configStateService.getConfig();
      if (!config.blacklist) config.blacklist = [];
      if (!config.blacklist.includes(policyAction.userId)) {
        config.blacklist.push(policyAction.userId);
        if (ctx) saveConfig(ctx as never);
      }
      return { ok: true, code: 'ok' };
    }
    return { ok: false, code: 'unknown_action' };
  };

  if (policyAction.delayMs && policyAction.delayMs > 0) {
    const taskId = expectedQueueTaskId(policyAction);
    setTimeout(() => {
      void run().then(result => {
        loggingStateService.debug(`延迟策略动作执行: ${policyAction.type} ${policyAction.groupId}/${policyAction.userId} code=${result.code}`);
      });
    }, policyAction.delayMs);
    return { ok: true, code: 'scheduled', taskId };
  }

  return run();
}

export async function executePolicyDecision(decision: PolicyDecision, ctx?: unknown): Promise<boolean> {
  let handled = false;
  const actionResults: PolicyActionAuditResult[] = [];

  for (const policyAction of decision.actions) {
    const result = await executeAction(policyAction, ctx);
    handled = handled || result.ok || result.code === 'scheduled';
    actionResults.push({
      actionType: policyAction.type,
      ok: result.ok,
      code: result.code,
      queueTaskId: result.taskId,
      actionId: result.actionId
    });
    loggingStateService.debug(`策略动作执行: ${policyAction.type} ${policyAction.groupId}/${policyAction.userId} code=${result.code}`);
  }
  riskAuditLog.recordDecision(decision, actionResults);

  for (const notification of decision.notifications) {
    await send({
      channel: notification.channel,
      targetId: notification.targetId,
      scene: 'raw_text',
      message: notification.message,
      force: true,
      applyTemplate: true
    });
  }

  return handled;
}

export async function executeManualPolicyAction(input: ManualPolicyActionInput): Promise<{ ok: boolean; code: string; }> {
  const correlationId = createManualCorrelationId(input);
  const policyAction: PolicyAction = {
    type: input.type,
    groupId: String(input.groupId),
    userId: String(input.userId),
    reason: input.reason,
    durationSeconds: input.durationSeconds,
    rejectAddRequest: input.rejectAddRequest,
    ignoreTargetProtection: input.ignoreTargetProtection,
    maxRetries: input.maxRetries,
    automatic: false
  };
  loggingStateService.info(JSON.stringify({
    event: 'manual_policy_action',
    type: policyAction.type,
    groupId: policyAction.groupId,
    userId: policyAction.userId,
    reason: policyAction.reason,
    durationSeconds: policyAction.durationSeconds || 0
  }));
  const result = await executeAction(policyAction);
  const standardPayload: StandardAuditPayload = {
    schemaVersion: 1,
    eventType: 'manual_policy_action',
    correlationId,
    source: 'manual_policy_channel',
    ruleId: 'manual_policy_action',
    actionType: policyAction.type,
    decision: result.ok || result.code === 'scheduled' ? 'action_queued' : 'queue_rejected',
    score: 0,
    reason: policyAction.reason,
    queueTaskId: result.taskId || '',
    actions: [{
      type: policyAction.type,
      groupId: policyAction.groupId,
      userId: policyAction.userId,
      reason: policyAction.reason,
      durationSeconds: policyAction.durationSeconds || 0,
      rejectAddRequest: policyAction.rejectAddRequest === true,
      ignoreTargetProtection: policyAction.ignoreTargetProtection === true,
      automatic: false,
      queueTaskId: result.taskId || '',
      actionId: result.actionId || '',
      code: result.code,
      ok: result.ok === true
    }],
    context: {
      groupId: policyAction.groupId,
      userId: policyAction.userId,
      correlationId,
      durationSeconds: policyAction.durationSeconds || 0,
      rejectAddRequest: policyAction.rejectAddRequest === true,
      ignoreTargetProtection: policyAction.ignoreTargetProtection === true
    },
    legacy: {
      event: 'manual_policy_action',
      type: policyAction.type,
      groupId: policyAction.groupId,
      userId: policyAction.userId,
      correlationId,
      reason: policyAction.reason,
      durationSeconds: policyAction.durationSeconds || 0,
      rejectAddRequest: policyAction.rejectAddRequest === true,
      ignoreTargetProtection: policyAction.ignoreTargetProtection === true,
      queueTaskId: result.taskId || '',
      actionId: result.actionId || '',
      code: result.code,
      ok: result.ok === true
    }
  };
  const manualPayload: AuditEventRecord = {
    eventType: 'manual_policy_action',
    kind: policyAction.type,
    groupId: policyAction.groupId,
    userId: policyAction.userId,
    messageId: undefined,
    handled: true,
    reason: policyAction.reason,
    riskScore: 0,
    riskLevel: 'medium',
    payload: JSON.stringify(standardPayload),
    createdAt: Date.now()
  };
  void groupguardRepository.insertAuditEvent(manualPayload).catch((error) => {
    loggingStateService.warn(`手动审计落表失败: ${String(error)}`);
  });
  return result;
}

export async function processRiskSignal(signal: RiskSignal, ctx?: unknown): Promise<boolean> {
  riskAuditLog.recordSignal(signal);
  const assessment = (await import('./risk_engine')).riskEngine.assess(signal);
  riskAuditLog.recordAssessment(assessment);
  const decision = policyEngine.decide(assessment);
  return executePolicyDecision(decision, ctx);
}
