import type { RiskAssessment, RiskSeverity, RiskSignal } from './signals';

const severityScore: Record<RiskSeverity, number> = {
  low: 1,
  medium: 3,
  high: 6,
  critical: 9
};

const kindScore: Partial<Record<RiskSignal['kind'], number>> = {
  target_user_message: 2,
  blacklist_message: 8,
  blacklist_join: 8,
  keyword_filter: 5,
  media_filter: 3,
  spam_rate: 5,
  spam_repeat: 4,
  verify_non_number: 1,
  verify_wrong_answer: 2,
  verify_timeout: 6,
  verify_exhausted: 6
};

function toRiskLevel(score: number): RiskSeverity {
  if (score >= 9) return 'critical';
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export class RiskEngine {
  assess(signal: RiskSignal): RiskAssessment {
    const score = Math.max(
      severityScore[signal.severity] || 1,
      kindScore[signal.kind] || 1
    );
    const reasons = [
      signal.reason,
      `kind:${signal.kind}`,
      `severity:${signal.severity}`
    ];

    return {
      signal,
      riskScore: score,
      riskLevel: toRiskLevel(score),
      reasons
    };
  }
}

export const riskEngine = new RiskEngine();
