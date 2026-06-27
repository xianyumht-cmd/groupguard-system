import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { FeaturePermission, FeatureScope, FeatureType } from '../types';

export type DynamicCommandTriggerType = 'exact' | 'prefix';

export type DynamicCommandHttpMethod = 'GET' | 'POST';

export type DynamicCommandErrorType =
  | 'validation_error'
  | 'timeout_soft'
  | 'timeout_hard'
  | 'invalid_response'
  | 'http_error'
  | 'empty_response'
  | 'circuit_open'
  | 'plugin_disabled'
  | 'permission_denied'
  | 'quota_exceeded';

export interface DynamicCommandTriggerDefinition {
  type: DynamicCommandTriggerType;
  value: string;
}

export type DynamicCommandProviderDefinition =
  | {
      type: 'http';
      method: DynamicCommandHttpMethod;
      url: string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      body?: Record<string, string>;
      timeoutMs?: number;
    }
  | {
      type: 'plugin';
      runtime: 'native' | 'legacy_adapter';
    };

export interface DynamicCommandResponseDefinition {
  type: 'text';
  textPath?: string;
  /**
   * Template syntax: "QQ：{name|未知}\n状态：{data.return|未知}\n详情：{data.banmsg|data.rammsg|msg|无详细信息}"
   * Each placeholder tries dot-path alternatives from left to right and then literal fallbacks.
   */
  template?: string;
}

export interface DynamicCommandParameterSchema {
  required: string[];
  optional: string[];
}

export interface DynamicCommandDefinition {
  id: string;
  enabled: boolean;
  priority?: number;
  featureType?: FeatureType;
  featureKey?: string;
  scope?: FeatureScope;
  allowedGroups?: string[];
  blockedGroups?: string[];
  requiresLicense?: boolean;
  permission?: FeaturePermission;
  trigger: DynamicCommandTriggerDefinition;
  parameters?: Record<string, string>;
  parameterSchema: DynamicCommandParameterSchema;
  provider: DynamicCommandProviderDefinition;
  response: DynamicCommandResponseDefinition;
  fallbackText?: string;
}

export interface CommandPluginMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  specVersion: string;
}

export interface CommandPluginRuntimeState {
  enabled: boolean;
  runtimeConfig: Record<string, unknown>;
}

export interface UnifiedCommandInputSchema {
  required: string[];
  optional: string[];
}

export interface UnifiedCommandNormalizedInput {
  commandId: string;
  registryVersion: number;
  rawText: string;
  cleanedText: string;
  rawArgument: string;
  mappedParameters: Record<string, string>;
  messageType: 'group' | 'private';
  userId: string;
  groupId?: string;
  source: 'dynamic';
}

export interface UnifiedCommandExecutionContext {
  event: OB11Message;
  pluginContext: NapCatPluginContext;
  plugin: {
    metadata: CommandPluginMetadata;
    enabled: boolean;
    runtimeConfig: Record<string, unknown>;
    effectiveConfig: Record<string, unknown>;
  };
  commandContext: {
    rawText: string;
    cleanedText: string;
    source: 'dynamic';
    commandId: string;
    matchedAt: string;
  };
}

export type UnifiedCommandResponse =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'link';
      text: string;
      url: string;
      title?: string;
    }
  | {
      type: 'media';
      text?: string;
      url: string;
      mediaType: 'audio' | 'video' | 'image';
      title?: string;
    }
  | {
      type: 'structured';
      text: string;
      payload: unknown;
    };

export interface UnifiedCommandOutputSchema {
  supported: UnifiedCommandResponse['type'][];
  defaultType: UnifiedCommandResponse['type'];
}

export interface CommandRuntimeSchemaItem {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  triggerType: DynamicCommandTriggerType;
  permission: string;
  scope: string;
  hot: boolean;
  desc: string;
  source: 'json' | 'plugin';
  inputSchema: UnifiedCommandInputSchema;
  outputSchema: UnifiedCommandOutputSchema;
}

export interface CommandRuntimeSchemaModule {
  id: string;
  name: string;
  items: CommandRuntimeSchemaItem[];
}

export interface DynamicCommandsConfigFile {
  version: string;
  commands: DynamicCommandDefinition[];
}

export interface DynamicCommandMatchResult {
  command: DynamicCommandDefinition;
  registryVersion: number;
  priority: number;
  matchedTrigger: string;
  rawArgument: string;
  mappedParameters: Record<string, string>;
}

export interface DynamicCommandMetricSnapshot {
  commandId: string;
  successCount: number;
  failureCount: number;
  averageLatencyMs: number;
  lastFailureReason: DynamicCommandErrorType | null;
  messageTypeStats: {
    group: number;
    private: number;
  };
}

export interface DynamicCommandCircuitBreakerSnapshot {
  commandId: string;
  state: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  openedAt: number;
  lastFailureAt: number;
}

export interface DynamicCommandHealthReportItem {
  commandId: string;
  status: 'healthy' | 'degraded' | 'failing';
  score: number;
  successRate: number;
  averageLatencyMs: number;
  circuitState: 'closed' | 'open' | 'half_open';
  lastFailureReason: DynamicCommandErrorType | null;
}

export interface DynamicCommandDebugTrace {
  commandId: string;
  resolvedAt: string | null;
  resolutionLatencyMs: number | null;
  validation: {
    ok: boolean;
    errorType: DynamicCommandErrorType | null;
    detail: string | null;
    durationMs: number | null;
  };
  execution: {
    ok: boolean;
    errorType: DynamicCommandErrorType | null;
    detail: string | null;
    durationMs: number | null;
    fallbackTriggered: boolean;
    fallbackReason: string | null;
  };
  circuitBreakerState: 'closed' | 'open' | 'half_open' | 'unknown';
}

export type DynamicCommandExecutionResult =
  | {
      ok: true;
      text: string;
    }
  | {
      ok: false;
      errorType: DynamicCommandErrorType;
      message: string;
    };

export type UnifiedCommandExecutionResult =
  | {
      ok: true;
      response: UnifiedCommandResponse;
    }
  | {
      ok: false;
      errorType: DynamicCommandErrorType;
      message: string;
    };
