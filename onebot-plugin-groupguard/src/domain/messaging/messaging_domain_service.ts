import type { DomainResponseNotice } from '../shared/response_notice';

export type MessagingRuleResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      message: string;
      vars?: Record<string, string | number | boolean>;
    };

export interface MessagingDomainService {
  validateBroadcastContent(content: string): MessagingRuleResult<{ content: string; }>;
  shouldBroadcastToGroup(input: { hasLicense: boolean; }): boolean;
  buildBroadcastStartNotice(): DomainResponseNotice;
  buildBroadcastPayload(content: string): string;
  buildBroadcastFetchFailureMessage(error: string): string;
  buildBroadcastCompletionMessage(input: { success: number; fail: number; }): string;
}

class DefaultMessagingDomainService implements MessagingDomainService {
  validateBroadcastContent(content: string): MessagingRuleResult<{ content: string; }> {
    const normalized = String(content || '').trim();
    if (!normalized) {
      return {
        ok: false,
        message: '请输入广播内容',
        vars: { example: '多群广播 今天20:00维护通知' }
      };
    }
    return {
      ok: true,
      data: { content: normalized }
    };
  }

  shouldBroadcastToGroup(input: { hasLicense: boolean; }): boolean {
    return input.hasLicense;
  }

  buildBroadcastStartNotice(): DomainResponseNotice {
    return {
      scene: 'raw_text',
      message: '开始广播，请稍候...'
    };
  }

  buildBroadcastPayload(content: string): string {
    return `【全员通知】\n${content}`;
  }

  buildBroadcastFetchFailureMessage(error: string): string {
    return `获取群列表失败: ${error}`;
  }

  buildBroadcastCompletionMessage(input: { success: number; fail: number; }): string {
    return `广播完成。\n成功: ${input.success}\n失败: ${input.fail}`;
  }
}

export const messagingDomainService: MessagingDomainService = new DefaultMessagingDomainService();
