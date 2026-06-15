import type { PolicyDecision, RiskAssessment, RiskSignal } from './signals';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { groupguardRepository } from '../repositories/groupguard_repository';
import type { AuditEventRecord, StandardAuditPayload } from '../types';

export interface PolicyActionAuditResult {
  actionType: string;
  ok: boolean;
  code: string;
  queueTaskId?: string;
  actionId?: string;
}

function persistAuditEvent(entry: AuditEventRecord): void {
  void groupguardRepository.insertAuditEvent(entry).catch((error) => {
    loggingStateService.warn(`审计落表失败: ${String(error)}`);
  });
}

export class RiskAuditLog {
  recordSignal(signal: RiskSignal): void {
    const payload: StandardAuditPayload = {
      schemaVersion: 1,
      eventType: 'risk_signal',
      correlationId: signal.correlationId,
      source: 'signal_layer',
      ruleId: signal.kind,
      actionType: 'none',
      decision: 'observed',
      score: 0,
      reason: signal.reason,
      context: {
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId || '',
        correlationId: signal.correlationId,
        severity: signal.severity,
        evidence: signal.evidence || {}
      },
      legacy: {
        event: 'risk_signal',
        kind: signal.kind,
        groupId: signal.groupId,
        userId: signal.userId,
        messageId: signal.messageId || '',
        correlationId: signal.correlationId,
        reason: signal.reason,
        severity: signal.severity
      }
    };
    loggingStateService.info(JSON.stringify(payload));
    persistAuditEvent({
      eventType: 'risk_signal',
      kind: signal.kind,
      groupId: signal.groupId,
      userId: signal.userId,
      messageId: signal.messageId,
      handled: false,
      reason: signal.reason,
      riskScore: 0,
      riskLevel: signal.severity,
      payload: JSON.stringify(payload),
      createdAt: signal.createdAt
    });
  }

  recordAssessment(assessment: RiskAssessment): void {
    const payload: StandardAuditPayload = {
      schemaVersion: 1,
      eventType: 'risk_assessment',
      correlationId: assessment.signal.correlationId,
      source: 'risk_engine',
      ruleId: assessment.signal.kind,
      actionType: 'none',
      decision: assessment.riskLevel,
      score: assessment.riskScore,
      reason: assessment.signal.reason,
      reasons: assessment.reasons,
      context: {
        groupId: assessment.signal.groupId,
        userId: assessment.signal.userId,
        messageId: assessment.signal.messageId || '',
        correlationId: assessment.signal.correlationId,
        severity: assessment.signal.severity
      },
      legacy: {
        event: 'risk_assessment',
        kind: assessment.signal.kind,
        groupId: assessment.signal.groupId,
        userId: assessment.signal.userId,
        correlationId: assessment.signal.correlationId,
        riskScore: assessment.riskScore,
        riskLevel: assessment.riskLevel,
        reasons: assessment.reasons
      }
    };
    loggingStateService.info(JSON.stringify(payload));
    persistAuditEvent({
      eventType: 'risk_assessment',
      kind: assessment.signal.kind,
      groupId: assessment.signal.groupId,
      userId: assessment.signal.userId,
      messageId: assessment.signal.messageId,
      handled: false,
      reason: assessment.signal.reason,
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel,
      payload: JSON.stringify(payload),
      createdAt: assessment.signal.createdAt
    });
  }

  recordDecision(decision: PolicyDecision, actionResults: PolicyActionAuditResult[] = []): void {
    const actions = decision.actions.map((action, index) => ({
      type: action.type,
      reason: action.reason,
      durationSeconds: action.durationSeconds || 0,
      delayMs: action.delayMs || 0,
      messageId: action.messageId || '',
      automatic: action.automatic === true,
      queueTaskId: actionResults[index]?.queueTaskId || '',
      actionId: actionResults[index]?.actionId || '',
      code: actionResults[index]?.code || '',
      ok: actionResults[index]?.ok === true
    }));
    const queueTaskIds = actionResults.map(result => result.queueTaskId).filter(Boolean) as string[];
    const payload: StandardAuditPayload = {
      schemaVersion: 1,
      eventType: 'policy_decision',
      correlationId: decision.signal.correlationId,
      source: 'policy_engine',
      ruleId: decision.signal.kind,
      actionType: decision.actions.map(action => action.type).join(',') || 'none',
      decision: decision.handled ? 'action_queued' : 'no_action',
      score: decision.assessment.riskScore,
      reason: decision.reason,
      queueTaskId: queueTaskIds.join(','),
      actions,
      reasons: decision.assessment.reasons,
      context: {
        groupId: decision.signal.groupId,
        userId: decision.signal.userId,
        messageId: decision.signal.messageId || '',
        correlationId: decision.signal.correlationId,
        riskLevel: decision.assessment.riskLevel
      },
      legacy: {
        event: 'policy_decision',
        kind: decision.signal.kind,
        groupId: decision.signal.groupId,
        userId: decision.signal.userId,
        correlationId: decision.signal.correlationId,
        handled: decision.handled,
        reason: decision.reason,
        actions: actions.map(action => ({
          type: action.type,
          reason: action.reason,
          durationSeconds: action.durationSeconds || 0,
          delayMs: action.delayMs || 0
        }))
      }
    };
    loggingStateService.info(JSON.stringify(payload));
    persistAuditEvent({
      eventType: 'policy_decision',
      kind: decision.signal.kind,
      groupId: decision.signal.groupId,
      userId: decision.signal.userId,
      messageId: decision.signal.messageId,
      handled: decision.handled,
      reason: decision.reason,
      riskScore: decision.assessment.riskScore,
      riskLevel: decision.assessment.riskLevel,
      payload: JSON.stringify(payload),
      createdAt: decision.signal.createdAt
    });
  }
}

export const riskAuditLog = new RiskAuditLog();
