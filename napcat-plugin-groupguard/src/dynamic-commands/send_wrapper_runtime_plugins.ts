import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { saveConfig } from '../commands/common';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';

type SendWrapperCommandAction = 'enable_all' | 'disable_all' | 'enable_qa' | 'disable_qa' | 'enable_query' | 'disable_query' | 'status';

const TRIGGER_ENABLE_ALL = '\u5f00\u542f\u5168\u5c40\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_DISABLE_ALL = '\u5173\u95ed\u5168\u5c40\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_ENABLE_QA = '\u5f00\u542f\u5168\u5c40\u95ee\u7b54\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_DISABLE_QA = '\u5173\u95ed\u5168\u5c40\u95ee\u7b54\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_ENABLE_QUERY = '\u5f00\u542f\u5168\u5c40\u67e5\u8be2\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_DISABLE_QUERY = '\u5173\u95ed\u5168\u5c40\u67e5\u8be2\u5408\u5e76\u8f6c\u53d1';
const TRIGGER_STATUS = '\u67e5\u770b\u53d1\u9001\u5305\u88c5';
const DEFAULT_NICKNAME = 'GroupGuard';

function getStatusText(): string {
  const global = (configStateService.getConfig().global || {}) as any;
  const allEnabled = global.botSendWrapperEnabled === true && global.botSendWrapperMode === 'forward';
  const qaEnabled = global.botSendWrapperQaEnabled === true;
  const queryEnabled = global.botSendWrapperQueryEnabled === true;
  const nickname = String(global.botSendForwardNickname || DEFAULT_NICKNAME).trim() || DEFAULT_NICKNAME;
  return [
    `all: ${allEnabled ? 'on' : 'off'}`,
    `qa: ${qaEnabled ? 'on' : 'off'}`,
    `query: ${queryEnabled ? 'on' : 'off'}`,
    `nickname: ${nickname}`
  ].join('\n');
}

function createPlugin(triggerValue: string, action: SendWrapperCommandAction): CommandPlugin {
  const commandId = `builtin.send_wrapper.${action}`;
  return {
    metadata: {
      id: commandId,
      name: 'send-wrapper',
      description: 'owner command for group message wrapper mode',
      version: '1.0.0',
      author: 'system.builtin.send_wrapper',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: commandId,
      enabled: true,
      priority: 70,
      trigger: {
        type: 'exact',
        value: triggerValue
      },
      parameterSchema: {
        required: [],
        optional: []
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'text'
      },
      fallbackText: 'send wrapper command failed'
    },
    schema: {
      id: commandId,
      name: 'send-wrapper',
      enabled: true,
      trigger: triggerValue,
      triggerType: 'exact',
      permission: 'owner',
      scope: 'private',
      hot: true,
      desc: 'owner command for wrapper mode',
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: []
      },
      outputSchema: {
        supported: ['text'],
        defaultType: 'text'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: async (_input, executionContext) => {
      const event = executionContext.event;
      const userId = String(event.user_id || '');
      if (event.message_type !== 'private') {
        return { ok: true, response: { type: 'text', text: 'Please use this command in private chat.' } };
      }
      if (!authStateService.isOwner(userId)) {
        return { ok: true, response: { type: 'text', text: 'Owner permission required.' } };
      }
      const config = configStateService.getConfig() as any;
      config.global = config.global || {};
      if (action === 'enable_all') {
        config.global.botSendWrapperEnabled = true;
        config.global.botSendWrapperMode = 'forward';
      } else if (action === 'disable_all') {
        config.global.botSendWrapperEnabled = false;
        config.global.botSendWrapperMode = 'normal';
      } else if (action === 'enable_qa') {
        config.global.botSendWrapperQaEnabled = true;
      } else if (action === 'disable_qa') {
        config.global.botSendWrapperQaEnabled = false;
      } else if (action === 'enable_query') {
        config.global.botSendWrapperQueryEnabled = true;
      } else if (action === 'disable_query') {
        config.global.botSendWrapperQueryEnabled = false;
      }
      if (action !== 'status') {
        config.global.botSendForwardNickname = String(config.global.botSendForwardNickname || DEFAULT_NICKNAME).trim() || DEFAULT_NICKNAME;
        saveConfig(executionContext.pluginContext);
      }
      return { ok: true, response: { type: 'text', text: getStatusText() } };
    },
    fallback: async (_input, failure) => ({
      ok: true,
      response: {
        type: 'text',
        text: failure.message || 'send wrapper command failed'
      }
    })
  };
}

let registered = false;

export function registerSendWrapperCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch([
    createPlugin(TRIGGER_ENABLE_ALL, 'enable_all'),
    createPlugin(TRIGGER_DISABLE_ALL, 'disable_all'),
    createPlugin(TRIGGER_ENABLE_QA, 'enable_qa'),
    createPlugin(TRIGGER_DISABLE_QA, 'disable_qa'),
    createPlugin(TRIGGER_ENABLE_QUERY, 'enable_query'),
    createPlugin(TRIGGER_DISABLE_QUERY, 'disable_query'),
    createPlugin(TRIGGER_STATUS, 'status')
  ]);
  registered = true;
}
