import type {
  CommandPluginMetadata,
  CommandRuntimeSchemaItem,
  DynamicCommandDefinition,
  DynamicCommandErrorType,
  UnifiedCommandExecutionResult,
  UnifiedCommandExecutionContext,
  UnifiedCommandNormalizedInput
} from './types';

export const COMMAND_PLUGIN_SPEC_VERSION = '3.0';

export interface CommandPlugin {
  metadata: CommandPluginMetadata;
  definition: DynamicCommandDefinition;
  source: 'json' | 'plugin';
  schema: CommandRuntimeSchemaItem;
  defaultConfig?: Record<string, unknown>;
  validate?: (
    input: UnifiedCommandNormalizedInput,
    context: UnifiedCommandExecutionContext
  ) => Promise<UnifiedCommandExecutionResult | null> | UnifiedCommandExecutionResult | null;
  execute: (
    input: UnifiedCommandNormalizedInput,
    context: UnifiedCommandExecutionContext
  ) => Promise<UnifiedCommandExecutionResult>;
  fallback?: (
    input: UnifiedCommandNormalizedInput,
    failure: Extract<UnifiedCommandExecutionResult, { ok: false; }>,
    context: UnifiedCommandExecutionContext
  ) => Promise<UnifiedCommandExecutionResult | null> | UnifiedCommandExecutionResult | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const ALLOWED_ERROR_TYPES = new Set<DynamicCommandErrorType>([
  'validation_error',
  'timeout_soft',
  'timeout_hard',
  'circuit_open',
  'http_error',
  'empty_response',
  'invalid_response',
  'plugin_disabled',
  'permission_denied',
  'quota_exceeded'
]);

function isValidSchemaItem(schema: CommandRuntimeSchemaItem, definition: DynamicCommandDefinition, source: CommandPlugin['source']): boolean {
  return schema.id === definition.id
    && schema.trigger === definition.trigger.value
    && schema.triggerType === definition.trigger.type
    && schema.source === source;
}

export function assertCommandPluginContract(plugin: CommandPlugin): void {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('command_plugin_invalid:plugin_missing');
  }
  if (!plugin.definition?.id || typeof plugin.definition.id !== 'string') {
    throw new Error('command_plugin_invalid:definition_id');
  }
  if (plugin.metadata?.specVersion !== COMMAND_PLUGIN_SPEC_VERSION) {
    throw new Error(`command_plugin_invalid:spec_version:${plugin.definition.id}`);
  }
  if (plugin.metadata?.id !== plugin.definition.id) {
    throw new Error(`command_plugin_invalid:metadata_id:${plugin.definition.id}`);
  }
  if (!plugin.metadata?.name || !plugin.metadata?.description || !plugin.metadata?.version || !plugin.metadata?.author) {
    throw new Error(`command_plugin_invalid:metadata_fields:${plugin.definition.id}`);
  }
  if (plugin.source !== 'json' && plugin.source !== 'plugin') {
    throw new Error(`command_plugin_invalid:source:${plugin.definition.id}`);
  }
  if (typeof plugin.execute !== 'function') {
    throw new Error(`command_plugin_invalid:execute:${plugin.definition.id}`);
  }
  if (typeof plugin.validate !== 'function') {
    throw new Error(`command_plugin_invalid:validate:${plugin.definition.id}`);
  }
  if (typeof plugin.fallback !== 'function') {
    throw new Error(`command_plugin_invalid:fallback:${plugin.definition.id}`);
  }
  if (!isValidSchemaItem(plugin.schema, plugin.definition, plugin.source)) {
    throw new Error(`command_plugin_invalid:schema:${plugin.definition.id}`);
  }
  if (plugin.defaultConfig !== undefined && !isPlainRecord(plugin.defaultConfig)) {
    throw new Error(`command_plugin_invalid:default_config:${plugin.definition.id}`);
  }
  if (plugin.definition.provider.type === 'plugin' && plugin.source !== 'plugin') {
    throw new Error(`command_plugin_invalid:provider_source:${plugin.definition.id}`);
  }
}

export function assertCommandPluginResultContract(result: UnifiedCommandExecutionResult): void {
  if (result.ok) return;
  if (!ALLOWED_ERROR_TYPES.has(result.errorType)) {
    throw new Error(`command_plugin_invalid:error_type:${result.errorType}`);
  }
}
