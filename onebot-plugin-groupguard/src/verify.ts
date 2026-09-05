// 验证逻辑
import { configStateService } from './core/state-services/config_state_service';
import { loggingStateService } from './core/state-services/logging_state_service';
import { sessionStateService } from './core/state-services/session_state_service';
import { send } from './dynamic-commands/response_capture_runtime';
import { createRiskSignal } from './risk/signals';
import { processRiskSignal } from './risk/policy_engine';

function randInt (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateMathQuestion (min: number, max: number): { expression: string; answer: number; } {
  const a = randInt(min, max);
  const b = randInt(min, max);
  const ops = ['+', '-', '*'] as const;
  const op = ops[randInt(0, 2)];
  let expression: string, answer: number;
  switch (op) {
    case '+': expression = `${a} + ${b}`; answer = a + b; break;
    case '-': { const big = Math.max(a, b), small = Math.min(a, b); expression = `${big} - ${small}`; answer = big - small; break; }
    case '*': { const x = randInt(1, 20), y = randInt(1, 20); expression = `${x} × ${y}`; answer = x * y; break; }
  }
  return { expression, answer };
}

function sessionKey (groupId: string, userId: string): string { return `${groupId}:${userId}`; }

export async function createVerifySession (groupId: string, userId: string, comment?: string, welcomeText?: string): Promise<void> {
  const key = sessionKey(groupId, userId);
  const existing = sessionStateService.getSession(key);
  if (existing) clearTimeout(existing.timer);

  const settings = configStateService.resolveGroupSettings(groupId);
  const { expression, answer } = generateMathQuestion(settings.mathMin, settings.mathMax);
  const timeout = settings.verifyTimeout;
  const maxAttempts = settings.maxAttempts;

  const cleanComment = comment ? comment.replace(/^问题：/, '').replace(/\s*答案：/, ' 答案:') : '';
  const commentLine = cleanComment ? ` 入群信息:${cleanComment}` : '';
  const welcomeLine = welcomeText ? `${welcomeText}` : '';
  await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
    { type: 'at', data: { qq: userId } },
    { type: 'text', data: { text: ` ${welcomeLine}请在「${timeout}」秒内发送「${expression}」答案,否则移出群聊。${commentLine}` } }
  ], force: true, applyTemplate: true });

  const timer = setTimeout(async () => {
    const session = sessionStateService.getSession(key);
    if (!session) return;
    sessionStateService.deleteSession(key);
    loggingStateService.info(`用户 ${userId} 在群 ${groupId} 验证超时，踢出`);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ' 验证超时，你已被移出群聊。' } }
    ], force: true, applyTemplate: true });
    void processRiskSignal(createRiskSignal({
      kind: 'verify_timeout',
      groupId,
      userId,
      reason: 'verify_timeout',
      severity: 'high',
      evidence: { expression, timeoutSeconds: timeout }
    }));
  }, timeout * 1000);

  sessionStateService.setSession(key, { userId, groupId, answer, expression, attempts: 0, maxAttempts, timer, startTime: Date.now() });
  loggingStateService.debug(`创建验证会话: ${key}, 题目: ${expression} = ${answer}`);
}

export async function handleVerifyAnswer (groupId: string, userId: string, rawMessage: string, messageId: string): Promise<boolean> {
  const key = sessionKey(groupId, userId);
  const session = sessionStateService.getSession(key);
  if (!session) return false;
  const trimmed = rawMessage.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    await processRiskSignal(createRiskSignal({
      kind: 'verify_non_number',
      groupId,
      userId,
      messageId,
      reason: 'verify_non_number',
      severity: 'low',
      evidence: { expression: session.expression }
    }));
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 请发送数字答案，计算「${session.expression}」的结果。` } }
    ], force: true, applyTemplate: true });
    return true;
  }
  const userAnswer = parseInt(trimmed, 10);

  if (userAnswer === session.answer) {
    clearTimeout(session.timer);
    sessionStateService.deleteSession(key);
    loggingStateService.info(`用户 ${userId} 在群 ${groupId} 验证通过`);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ' 验证通过，欢迎加入！' } }
    ], force: true, applyTemplate: true });
    return true;
  }

  session.attempts++;
  await processRiskSignal(createRiskSignal({
    kind: 'verify_wrong_answer',
    groupId,
    userId,
    messageId,
    reason: 'verify_wrong_answer',
    severity: 'medium',
    evidence: {
      expression: session.expression,
      attempts: session.attempts,
      maxAttempts: session.maxAttempts
    }
  }));
  if (session.attempts >= session.maxAttempts) {
    clearTimeout(session.timer);
    sessionStateService.deleteSession(key);
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 验证失败，你已用完 ${session.maxAttempts} 次机会，已被移出群聊。` } }
    ], force: true, applyTemplate: true });
    void processRiskSignal(createRiskSignal({
      kind: 'verify_exhausted',
      groupId,
      userId,
      reason: 'verify_exhausted',
      severity: 'high',
      evidence: {
        expression: session.expression,
        attempts: session.attempts,
        maxAttempts: session.maxAttempts
      }
    }));
  } else {
    const remaining = session.maxAttempts - session.attempts;
    await send({ channel: 'group', targetId: groupId, scene: 'raw_text', segments: [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 回答错误，还剩 ${remaining} 次机会。请重新计算「${session.expression}」的结果。` } }
    ], force: true, applyTemplate: true });
  }
  return true;
}

export function clearAllSessions (): void {
  for (const session of sessionStateService.values()) clearTimeout(session.timer);
  sessionStateService.clearSessions();
}
