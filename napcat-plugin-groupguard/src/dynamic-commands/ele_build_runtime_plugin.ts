import { communicationStateService } from '../core/state-services/communication_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import {
  buildEleShareLink,
  isValidEleCardKey,
  maskEleCardKey,
  normalizeEleCardKey
} from '../services/ele_build_service';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';
import type { UnifiedCommandExecutionContext, UnifiedCommandNormalizedInput } from './types';

type DeliveryTarget =
  | {
      channel: 'private';
      targetId: string;
    }
  | {
      channel: 'group';
      targetId: string;
    };

type BuildSubscriber = DeliveryTarget & {
  subscriberKey: string;
};

interface InFlightBuild {
  cardKey: string;
  subscribers: Map<string, BuildSubscriber>;
  promise: Promise<void>;
}

const inFlightBuilds = new Map<string, InFlightBuild>();
const ELE_COMMAND_TRIGGERS = ['ele下载', 'ELE下载', '/ele下载'];
const ELE_BUILD_WAIT_MS = 150_000;

function getDeliveryTarget(context: UnifiedCommandExecutionContext): DeliveryTarget {
  const event = context.event;
  if (event.message_type === 'private') {
    return {
      channel: 'private',
      targetId: String(event.user_id || '')
    };
  }
  return {
    channel: 'group',
    targetId: String(event.group_id || '')
  };
}

function getSubscriber(context: UnifiedCommandExecutionContext): BuildSubscriber {
  const target = getDeliveryTarget(context);
  return {
    ...target,
    subscriberKey: `${target.channel}:${target.targetId}`
  };
}

async function sendToSubscriber(subscriber: BuildSubscriber, message: string): Promise<void> {
  const options = {
    scene: 'external_query',
    force: true,
    applyTemplate: true
  };
  if (subscriber.channel === 'private') {
    await communicationStateService.sendPrivateMsg(subscriber.targetId, message, options);
    return;
  }
  await communicationStateService.sendGroupText(subscriber.targetId, message, options);
}

async function notifySubscribers(entry: InFlightBuild, message: string): Promise<void> {
  const subscribers = Array.from(entry.subscribers.values());
  for (const subscriber of subscribers) {
    try {
      await sendToSubscriber(subscriber, message);
    } catch (error) {
      loggingStateService.warn(`[EleBuild] notify failed target=${subscriber.subscriberKey} card=${maskEleCardKey(entry.cardKey)} error=${error}`);
    }
  }
}

function startInFlightBuild(cardKey: string): InFlightBuild {
  const entry: InFlightBuild = {
    cardKey,
    subscribers: new Map(),
    promise: Promise.resolve()
  };
  entry.promise = buildEleShareLink(cardKey, {
    maxWaitMs: ELE_BUILD_WAIT_MS
  }).then(async (result) => {
    const label = result.fromCache ? '缓存命中' : '生成完成';
    await notifySubscribers(entry, `${label}：\n${result.shareUrl}`);
  }).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    loggingStateService.warn(`[EleBuild] failed card=${maskEleCardKey(cardKey)} error=${message}`);
    await notifySubscribers(entry, `ELE 下载失败：${message}`);
  }).finally(() => {
    inFlightBuilds.delete(cardKey);
  });
  inFlightBuilds.set(cardKey, entry);
  return entry;
}

function subscribeBuild(cardKey: string, subscriber: BuildSubscriber): { created: boolean; entry: InFlightBuild; } {
  let entry = inFlightBuilds.get(cardKey);
  const created = !entry;
  if (!entry) {
    entry = startInFlightBuild(cardKey);
  }
  entry.subscribers.set(subscriber.subscriberKey, subscriber);
  return { created, entry };
}

function getUsageText(): string {
  return '用法：ele下载 你的32位卡密';
}

function createEleBuildPlugin(triggerValue: string): CommandPlugin {
  const commandId = `builtin.ele.build.${Buffer.from(triggerValue, 'utf8').toString('hex')}`;
  return {
    metadata: {
      id: commandId,
      name: 'ELE 下载',
      description: '提交 ELE 卡密并在构建完成后返回飞机盘分享链接',
      version: '1.0.0',
      author: 'system.builtin.ele',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: commandId,
      enabled: true,
      priority: 85,
      featureType: 'dynamic',
      featureKey: 'dynamic.ele_build',
      scope: 'both',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: false,
      permission: 'all',
      trigger: {
        type: 'prefix',
        value: triggerValue
      },
      parameters: {
        cardKey: '$raw'
      },
      parameterSchema: {
        required: [],
        optional: ['cardKey']
      },
      provider: {
        type: 'plugin',
        runtime: 'native'
      },
      response: {
        type: 'text'
      },
      fallbackText: 'ELE 下载服务暂时不可用，请稍后再试'
    },
    schema: {
      id: commandId,
      name: 'ELE 下载',
      enabled: true,
      trigger: triggerValue,
      triggerType: 'prefix',
      permission: 'all',
      scope: 'group/private',
      hot: true,
      desc: '提交 ELE 卡密并返回飞机盘分享链接',
      source: 'plugin',
      inputSchema: {
        required: [],
        optional: ['cardKey']
      },
      outputSchema: {
        supported: ['text'],
        defaultType: 'text'
      }
    },
    defaultConfig: {},
    validate: async () => null,
    execute: async (input: UnifiedCommandNormalizedInput, executionContext: UnifiedCommandExecutionContext) => {
      const cardKey = normalizeEleCardKey(input.mappedParameters.cardKey || input.rawArgument || '');
      if (!cardKey) {
        return {
          ok: true,
          response: {
            type: 'text',
            text: getUsageText()
          }
        };
      }
      if (!isValidEleCardKey(cardKey)) {
        return {
          ok: true,
          response: {
            type: 'text',
            text: '卡密格式无效（需 32 位十六进制字符）'
          }
        };
      }

      const subscriber = getSubscriber(executionContext);
      if (!subscriber.targetId) {
        return {
          ok: true,
          response: {
            type: 'text',
            text: '无法识别发送目标，请稍后再试'
          }
        };
      }

      const subscribed = subscribeBuild(cardKey, subscriber);
      loggingStateService.info(`[EleBuild] ${subscribed.created ? 'started' : 'subscribed'} card=${maskEleCardKey(cardKey)} target=${subscriber.subscriberKey}`);
      return {
        ok: true,
        response: {
          type: 'text',
          text: subscribed.created
            ? '已提交，正在生成，预计 2 分钟内完成。完成后我会把链接发到这里。'
            : '这张卡密正在生成中，完成后我会把链接发到这里。'
        }
      };
    },
    fallback: async (_input, failure) => ({
      ok: true,
      response: {
        type: 'text',
        text: failure.message || 'ELE 下载服务暂时不可用，请稍后再试'
      }
    })
  };
}

let registered = false;

export function registerEleBuildCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch(ELE_COMMAND_TRIGGERS.map(createEleBuildPlugin));
  registered = true;
}
