export type RiskSignalKind =
  | 'target_user_message'
  | 'blacklist_message'
  | 'blacklist_join'
  | 'keyword_filter'
  | 'media_filter'
  | 'spam_rate'
  | 'spam_repeat'
  | 'verify_non_number'
  | 'verify_wrong_answer'
  | 'verify_timeout'
  | 'verify_exhausted';

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RiskSignal {
  kind: RiskSignalKind;
  groupId: string;
  userId: string;
  messageId?: string;
  correlationId: string;
  reason: string;
  severity: RiskSeverity;
  evidence?: Record<string, unknown>;
  createdAt: number;
}

export interface RiskAssessment {
  signal: RiskSignal;
  riskScore: number;
  riskLevel: RiskSeverity;
  reasons: string[];
}

export type PolicyActionType = 'recall' | 'ban' | 'kick' | 'add_global_blacklist';

export interface PolicyAction {
  type: PolicyActionType;
  reason: string;
  groupId: string;
  userId: string;
  messageId?: string;
  durationSeconds?: number;
  rejectAddRequest?: boolean;
  delayMs?: number;
  ignoreTargetProtection?: boolean;
  maxRetries?: number;
  automatic: boolean;
}

export interface PolicyNotification {
  channel: 'group' | 'private';
  targetId: string;
  message: string;
}

export interface PolicyDecision {
  signal: RiskSignal;
  assessment: RiskAssessment;
  actions: PolicyAction[];
  notifications: PolicyNotification[];
  handled: boolean;
  reason: string;
}

function createCorrelationId(input: Pick<RiskSignal, 'kind' | 'groupId' | 'userId'>): string {
  const seq = Math.random().toString(36).slice(2, 8);
  return `risk-${Date.now().toString(36)}-${String(input.kind || 'signal')}-${String(input.groupId || '0')}-${String(input.userId || '0')}-${seq}`;
}

export function createRiskSignal(input: Omit<RiskSignal, 'createdAt' | 'correlationId'> & { correlationId?: string; }): RiskSignal {
  const base = {
    ...input,
    groupId: String(input.groupId),
    userId: String(input.userId)
  };
  return {
    ...base,
    correlationId: String(input.correlationId || createCorrelationId(base)),
    messageId: input.messageId !== undefined ? String(input.messageId) : undefined,
    createdAt: Date.now()
  };
}
