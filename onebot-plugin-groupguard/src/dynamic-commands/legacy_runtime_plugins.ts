import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import {
  AUTH_EXACT,
  AUTH_PREFIXES,
  handleAuthCommand
} from '../commands/modules/auth';
import {
  INTERACTION_EXACT,
  INTERACTION_PREFIXES,
  handleInteractionCommand
} from '../commands/modules/interaction';
import {
  MODERATION_EXACT,
  MODERATION_PREFIXES,
  handleModerationCommand
} from '../commands/modules/moderation';
import {
  QA_EXACT,
  QA_PREFIXES,
  handleQaCommand
} from '../commands/modules/qa';
import {
  RISK_EXACT,
  RISK_PREFIXES,
  handleRiskCommand
} from '../commands/modules/risk';
import {
  SYSTEM_EXACT,
  SYSTEM_PREFIXES,
  handleSystemCommand
} from '../commands/modules/system';
import { shouldBlockByBotRole } from '../core/bot_role';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import { captureCommandResponseDeliveries } from './response_capture_runtime';

type LegacyHandler = (event: OB11Message, ctx: NapCatPluginContext) => Promise<boolean>;

interface LegacyModuleDescriptor {
  domain: 'auth' | 'moderation' | 'interaction' | 'risk' | 'qa' | 'system';
  name: string;
  priority: number;
  permission: string;
  scope: string;
  desc: string;
  exact: string[];
  prefixes: string[];
  handler: LegacyHandler;
}

function toFeatureType(domain: LegacyModuleDescriptor['domain']) {
  if (domain === 'interaction') return 'query';
  if (domain === 'qa') return 'qa';
  if (domain === 'moderation') return 'moderation';
  if (domain === 'risk') return 'risk';
  return 'system';
}

const LEGACY_MODULES: LegacyModuleDescriptor[] = [
  {
    domain: 'auth',
    name: '授权管理',
    priority: 60,
    permission: 'owner/admin',
    scope: 'group/private',
    desc: '旧授权模块迁移插件',
    exact: AUTH_EXACT,
    prefixes: AUTH_PREFIXES,
    handler: handleAuthCommand
  },
  {
    domain: 'moderation',
    name: '群管操作',
    priority: 50,
    permission: 'admin',
    scope: 'group',
    desc: '旧群管模块迁移插件',
    exact: MODERATION_EXACT,
    prefixes: MODERATION_PREFIXES,
    handler: handleModerationCommand
  },
  {
    domain: 'interaction',
    name: '互动查询',
    priority: 40,
    permission: 'all',
    scope: 'group',
    desc: '旧互动模块迁移插件',
    exact: INTERACTION_EXACT,
    prefixes: INTERACTION_PREFIXES,
    handler: handleInteractionCommand
  },
  {
    domain: 'risk',
    name: '风控设置',
    priority: 30,
    permission: 'admin',
    scope: 'group',
    desc: '旧风控模块迁移插件',
    exact: RISK_EXACT,
    prefixes: RISK_PREFIXES,
    handler: handleRiskCommand
  },
  {
    domain: 'qa',
    name: '问答配置',
    priority: 20,
    permission: 'admin',
    scope: 'group',
    desc: '旧问答模块迁移插件',
    exact: QA_EXACT,
    prefixes: QA_PREFIXES,
    handler: handleQaCommand
  },
  {
    domain: 'system',
    name: '系统工具',
    priority: 10,
    permission: 'all',
    scope: 'group/private',
    desc: '旧系统模块迁移插件',
    exact: SYSTEM_EXACT,
    prefixes: SYSTEM_PREFIXES,
    handler: handleSystemCommand
  }
];

function createLegacyPlugin(descriptor: LegacyModuleDescriptor, triggerType: 'exact' | 'prefix', triggerValue: string): CommandPlugin {
  const commandId = `legacy.${descriptor.domain}.${Buffer.from(`${triggerType}:${triggerValue}`, 'utf8').toString('hex')}`;
  return {
    metadata: {
      id: commandId,
      name: descriptor.name,
      description: descriptor.desc,
      version: '1.0.0',
      author: `system.legacy.${descriptor.domain}`,
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: commandId,
      enabled: true,
      priority: descriptor.priority,
      featureType: toFeatureType(descriptor.domain),
      featureKey: `builtin.${descriptor.domain}`,
      scope: descriptor.scope === 'group/private' ? 'both' : descriptor.scope === 'group' ? 'group' : 'private',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: descriptor.scope !== 'private',
      permission: descriptor.permission === 'admin' ? 'admin' : descriptor.permission === 'owner' ? 'owner' : 'all',
      trigger: {
        type: triggerType,
        value: triggerValue
      },
      parameterSchema: {
        required: [],
        optional: []
      },
      provider: {
        type: 'plugin',
        runtime: 'legacy_adapter'
      },
      response: {
        type: 'text'
      },
      fallbackText: '命令执行失败，请稍后再试'
    },
    schema: {
      id: commandId,
      name: descriptor.name,
      enabled: true,
      trigger: triggerValue,
      triggerType,
      permission: descriptor.permission,
      scope: descriptor.scope,
      hot: descriptor.priority >= 40,
      desc: descriptor.desc,
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: []
      },
      outputSchema: {
        supported: ['structured', 'text'],
        defaultType: 'structured'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: async (_input, executionContext) => {
      const roleBlock = shouldBlockByBotRole({
        source: `legacy.${descriptor.domain}`,
        rawMessage: executionContext.event.raw_message || '',
        featureType: toFeatureType(descriptor.domain),
        featureKey: `builtin.${descriptor.domain}`,
        commandId,
        legacyDomain: descriptor.domain
      });
      if (roleBlock.blocked) {
        loggingStateService.info(roleBlock.logLine || `bot_role_blocked role=${roleBlock.role} intent=${roleBlock.intent} rawMessage=${executionContext.event.raw_message || ''} source=legacy.${descriptor.domain}`);
        return {
          ok: false,
          errorType: 'bot_role_blocked',
          message: roleBlock.reason || 'bot_role_blocked'
        };
      }
      const { result, deliveries } = await captureCommandResponseDeliveries(() => descriptor.handler(executionContext.event, executionContext.pluginContext));
      if (!result) {
        return {
          ok: false,
          errorType: 'invalid_response',
          message: `legacy_handler_not_handled:${descriptor.domain}`
        };
      }
      if (!deliveries.length) {
        return {
          ok: false,
          errorType: 'invalid_response',
          message: `legacy_handler_no_delivery:${descriptor.domain}`
        };
      }
      return {
        ok: true,
        response: {
          type: 'structured',
          text: deliveries.map((delivery) => delivery.message).join('\n'),
          payload: {
            deliveries
          }
        }
      };
    },
    fallback: async (_input, failure) => ({
      ok: true,
      response: {
        type: 'text',
        text: failure.message || '命令执行失败，请稍后再试'
      }
    })
  };
}

let legacyPluginsRegistered = false;

export function registerLegacyRuntimePlugins(): void {
  if (legacyPluginsRegistered) return;
  const plugins: CommandPlugin[] = [];
  for (const descriptor of LEGACY_MODULES) {
    for (const trigger of descriptor.exact) {
      plugins.push(createLegacyPlugin(descriptor, 'exact', trigger));
    }
    for (const trigger of descriptor.prefixes) {
      plugins.push(createLegacyPlugin(descriptor, 'prefix', trigger));
    }
  }
  registerCommandPluginBatch(plugins);
  legacyPluginsRegistered = true;
}
