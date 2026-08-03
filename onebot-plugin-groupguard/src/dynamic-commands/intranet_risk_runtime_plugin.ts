import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  requestIntranetDelivery,
  requestIntranetReportDelivery,
  type IntranetDeliveryRequestFn,
  type IntranetReportRequestFn
} from '../services/intranet_query_service';
import {
  buildIntranetStructuredResult,
  resolveIntranetQueryTimeoutMs,
  resolveUnifiedQueryPreferredOutput
} from './intranet_query_runtime_plugin';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type {
  UnifiedCommandExecutionContext,
  UnifiedCommandExecutionResult,
  UnifiedCommandNormalizedInput
} from './types';

const PRIORITY = 90;
const FALLBACK_TEXT = '内网查询服务暂时不可用，请稍后再试。';
const REPORT_TOKEN_MISSING_TEXT = '未配置举报写入令牌，请联系机器人主人完成安全凭据配置。';
const REPORT_TOKEN_INVALID_TEXT = '举报服务凭据无效或不一致，请联系机器人主人同步写入令牌。';

type RiskCategory = 'scammer' | 'peer';
type IdentifierType = 'qq' | 'wechat';

export interface ParsedRiskIdentifier {
  type: IdentifierType;
  value: string;
}

function textResult(text: string): UnifiedCommandExecutionResult {
  return {
    ok: true,
    response: {
      type: 'text',
      text
    }
  };
}

function rawCommandTail(
  trigger: string,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const raw = String((context.event as any).raw_message || input.rawText || '').trim();
  const rawTail = raw.startsWith(trigger) ? raw.slice(trigger.length) : String(input.rawArgument || '');
  return rawTail
    .replace(/\[CQ:at,qq=(\d{5,13})(?:,[^\]]*)?\]/g, '$1')
    .replace(/\[CQ:[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRiskIdentifier(value: unknown): ParsedRiskIdentifier | null {
  let raw = String(value || '').trim();
  if (!raw || /\s/.test(raw)) return null;
  const qqPrefix = raw.match(/^qq[:：]?(\d+)$/i);
  if (qqPrefix) raw = qqPrefix[1];
  const chineseWechatPrefix = raw.match(/^微信[:：]?(.+)$/i);
  const englishWechatPrefix = raw.match(/^(?:wx|weixin)[:：](.+)$/i);
  const wechatPrefix = chineseWechatPrefix || englishWechatPrefix;
  if (wechatPrefix) raw = wechatPrefix[1].trim();
  if (/^\d+$/.test(raw)) {
    if (!/^\d{5,13}$/.test(raw)) return null;
    return { type: 'qq', value: raw };
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,63}$/.test(raw)) return null;
  return { type: 'wechat', value: raw };
}

export function parseRiskQueryArgument(value: unknown):
  | { ok: true; identifier: ParsedRiskIdentifier }
  | { ok: false; reason: string } {
  const identifier = parseRiskIdentifier(value);
  if (!identifier) {
    return { ok: false, reason: '格式：查骗子 QQ号/微信号，例如：查骗子 123456789 或 查骗子 wx_example' };
  }
  return { ok: true, identifier };
}

export function parseRiskReportArgument(value: unknown):
  | { ok: true; identifier: ParsedRiskIdentifier; evidence: string }
  | { ok: false; reason: string } {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) {
    return { ok: false, reason: '格式：举报骗子 QQ号/微信号 说明，例如：举报骗子 123456789 收款后失联' };
  }
  const identifier = parseRiskIdentifier(match[1]);
  const evidence = String(match[2] || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!identifier || !evidence) {
    return { ok: false, reason: '账号或举报说明格式不正确，请检查后重试。' };
  }
  return { ok: true, identifier, evidence };
}

function requestIdFromContext(
  feature: string,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext
): string {
  const messageId = String((context.event as any).message_id || '').trim();
  return [
    'gg',
    feature,
    String(input.groupId || ''),
    String(input.userId || ''),
    messageId || Date.now().toString(36)
  ]
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9_.:-]/g, '_')
    .slice(0, 128);
}

function requireGroup(input: UnifiedCommandNormalizedInput, command: string): string | null {
  const groupId = String(input.groupId || '').trim();
  if (!groupId || input.messageType !== 'group') return null;
  return groupId;
}

function requireBaseUrl(): string {
  const config = configStateService.getConfig() as any;
  return String(config?.lolApiBaseUrl || '').trim();
}

function requireReportWriteToken(): string {
  const config = configStateService.getConfig() as any;
  return String(
    config?.lolApiWriteToken
      || process.env.LOL_API_WRITE_TOKEN
      || process.env.GROUPGUARD_WRITE_TOKEN
      || ''
  ).trim();
}

function safeErrorTag(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 240);
}

function reportFailureText(error: unknown): string {
  const tag = safeErrorTag(error);
  if (tag === 'delivery_write_token_required') return REPORT_TOKEN_MISSING_TEXT;
  if (/^delivery_auth_failed_http_(?:401|403)$/.test(tag)) return REPORT_TOKEN_INVALID_TEXT;
  return '内网举报服务暂时不可用，请稍后再试。';
}

function categoryTitle(category: RiskCategory): string {
  return category === 'peer' ? '同行' : '骗子';
}

export async function executeRiskIntranetQuery(
  category: RiskCategory,
  trigger: string,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetDeliveryRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const groupId = requireGroup(input, trigger);
  if (!groupId) return textResult(`${trigger}仅支持群聊使用。`);
  const parsed = parseRiskQueryArgument(rawCommandTail(trigger, input, context));
  if (!parsed.ok) return textResult(parsed.reason.replace('查骗子', trigger));
  const baseUrl = requireBaseUrl();
  if (!baseUrl) return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');
  try {
    const { plan } = await requestIntranetDelivery({
      baseUrl,
      feature: category,
      parameters: {
        identifier_type: parsed.identifier.type,
        identifier: parsed.identifier.value
      },
      preferred: resolveUnifiedQueryPreferredOutput(groupId, [category]),
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext(category, input, context),
      ...(requestFn ? { requestFn } : {})
    });
    return buildIntranetStructuredResult(
      plan,
      groupId,
      String((context.event as any).self_id || '0'),
      `🔎 ${categoryTitle(category)}查询`,
      `${trigger}结果已生成。`
    );
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] ${category} request failed: ${safeErrorTag(error)}`);
    return textResult(FALLBACK_TEXT);
  }
}

export async function executeRiskIntranetReport(
  category: RiskCategory,
  trigger: string,
  input: UnifiedCommandNormalizedInput,
  context: UnifiedCommandExecutionContext,
  requestFn?: IntranetReportRequestFn
): Promise<UnifiedCommandExecutionResult> {
  const groupId = requireGroup(input, trigger);
  if (!groupId) return textResult(`${trigger}仅支持群聊使用。`);
  const parsed = parseRiskReportArgument(rawCommandTail(trigger, input, context));
  if (!parsed.ok) return textResult(parsed.reason.replace('举报骗子', trigger));
  const baseUrl = requireBaseUrl();
  if (!baseUrl) return textResult('未配置 LOL API Base，请联系机器人主人完成内网服务地址配置。');
  const writeToken = requireReportWriteToken();
  if (!writeToken) return textResult(REPORT_TOKEN_MISSING_TEXT);
  const feature = category === 'peer' ? 'peer_report' : 'scammer_report';
  try {
    const { plan } = await requestIntranetReportDelivery({
      baseUrl,
      feature,
      parameters: {
        identifier_type: parsed.identifier.type,
        identifier: parsed.identifier.value,
        content: parsed.evidence,
        group_id: groupId,
        actor_id: String(input.userId || '')
      },
      preferred: 'text',
      timeoutMs: resolveIntranetQueryTimeoutMs(),
      requestId: requestIdFromContext(feature, input, context),
      client: 'snowluma',
      writeToken,
      ...(requestFn ? { requestFn } : {})
    });
    return buildIntranetStructuredResult(
      plan,
      groupId,
      String((context.event as any).self_id || '0'),
      `✅ ${categoryTitle(category)}举报`,
      `${trigger}结果已生成。`
    );
  } catch (error) {
    loggingStateService.warn(`[IntranetQuery] ${feature} request failed: ${safeErrorTag(error)}`);
    return textResult(reportFailureText(error));
  }
}

function createRiskPlugin(options: {
  id: string;
  name: string;
  trigger: string;
  featureKey: string;
  description: string;
  execute: CommandPlugin['execute'];
}): CommandPlugin {
  return {
    metadata: {
      id: options.id,
      name: options.name,
      description: options.description,
      version: '1.0.0',
      author: 'system.builtin.intranet-query',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: options.id,
      enabled: true,
      priority: PRIORITY,
      featureType: 'query',
      featureKey: options.featureKey,
      scope: 'group',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: true,
      permission: 'all',
      trigger: {
        type: 'prefix',
        value: options.trigger
      },
      parameterSchema: {
        required: ['identifier'],
        optional: ['evidence']
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'structured'
      },
      fallbackText: FALLBACK_TEXT
    },
    schema: {
      id: options.id,
      name: options.name,
      enabled: true,
      trigger: options.trigger,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group',
      hot: true,
      desc: options.description,
      source: 'plugin',
      inputSchema: {
        required: ['identifier'],
        optional: ['evidence']
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: options.execute,
    fallback: async () => textResult(FALLBACK_TEXT)
  };
}

export function createRiskIntranetCommandPlugins(): CommandPlugin[] {
  return [
    createRiskPlugin({
      id: 'builtin.query.scammer.intranet',
      name: 'intranet-scammer-query',
      trigger: '查骗子',
      featureKey: 'query.scammer',
      description: 'Route scammer queries through the channel-neutral intranet delivery contract',
      execute: (input, context) => executeRiskIntranetQuery('scammer', '查骗子', input, context)
    }),
    createRiskPlugin({
      id: 'builtin.query.peer.intranet',
      name: 'intranet-peer-query',
      trigger: '查同行',
      featureKey: 'query.peer',
      description: 'Route peer queries through the channel-neutral intranet delivery contract',
      execute: (input, context) => executeRiskIntranetQuery('peer', '查同行', input, context)
    }),
    createRiskPlugin({
      id: 'builtin.report.scammer.intranet',
      name: 'intranet-scammer-report',
      trigger: '举报骗子',
      featureKey: 'query.scammer',
      description: 'Submit scammer reports to the channel-neutral intranet service',
      execute: (input, context) => executeRiskIntranetReport('scammer', '举报骗子', input, context)
    }),
    createRiskPlugin({
      id: 'builtin.report.peer.intranet',
      name: 'intranet-peer-report',
      trigger: '举报同行',
      featureKey: 'query.peer',
      description: 'Submit peer reports to the channel-neutral intranet service',
      execute: (input, context) => executeRiskIntranetReport('peer', '举报同行', input, context)
    })
  ];
}

let registered = false;

export function registerIntranetRiskCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch(createRiskIntranetCommandPlugins());
  registered = true;
}
