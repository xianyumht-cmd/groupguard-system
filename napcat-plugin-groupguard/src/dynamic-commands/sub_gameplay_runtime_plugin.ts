import { executeSubGameplayCommand } from '../services/sub_gameplay_service';
import { registerCommandPluginBatch } from './command_plugin_store';
import type { CommandPlugin } from './command_runtime_plugin';

type SubGameplayModule = 'master_servant' | 'racing' | 'light';

interface SubGameplayTrigger {
  trigger: string;
  type: 'exact' | 'prefix';
  module: SubGameplayModule;
  action: string;
  desc: string;
  hot?: boolean;
}

const SUB_GAMEPLAY_TRIGGERS: SubGameplayTrigger[] = [
  { trigger: 'SUB帮助', type: 'exact', module: 'master_servant', action: 'help', desc: 'SUB玩法命令说明', hot: true },
  { trigger: '新人福利', type: 'exact', module: 'master_servant', action: 'welfare', desc: '领取主仆契约新人福利', hot: true },
  { trigger: '我的契约', type: 'exact', module: 'master_servant', action: 'profile', desc: '查看自己的契约资料', hot: true },
  { trigger: '契约', type: 'exact', module: 'master_servant', action: 'profile', desc: '查看自己的契约资料' },
  { trigger: '雇佣', type: 'prefix', module: 'master_servant', action: 'hire', desc: '雇佣群成员成为仆人', hot: true },
  { trigger: '抢走', type: 'prefix', module: 'master_servant', action: 'snatch', desc: '从其他主人处抢走仆人', hot: true },
  { trigger: '赎身', type: 'exact', module: 'master_servant', action: 'ransom', desc: '支付黄金解除自己的契约' },
  { trigger: '逃跑', type: 'exact', module: 'master_servant', action: 'escape', desc: '概率解除自己的契约' },
  { trigger: '释放', type: 'prefix', module: 'master_servant', action: 'release', desc: '释放自己的仆人' },
  { trigger: '派遣', type: 'prefix', module: 'master_servant', action: 'dispatch', desc: '派遣仆人执行事件' },
  { trigger: '调教', type: 'prefix', module: 'master_servant', action: 'train', desc: '提升仆人成长和身价' },
  { trigger: '安慰', type: 'prefix', module: 'master_servant', action: 'comfort', desc: '安慰仆人并提升成长' },
  { trigger: '结算自己', type: 'exact', module: 'master_servant', action: 'settle_self', desc: '结算自己的契约收益' },
  { trigger: '结算仆人', type: 'exact', module: 'master_servant', action: 'settle_servants', desc: '结算仆人收益' },
  { trigger: '叫我', type: 'prefix', module: 'master_servant', action: 'rename', desc: '设置契约昵称' },
  { trigger: '赐名', type: 'prefix', module: 'master_servant', action: 'grant_name', desc: '给仆人赐名' },
  { trigger: '黄金排行', type: 'exact', module: 'master_servant', action: 'rank_gold', desc: '查看黄金排行榜' },
  { trigger: '货币排行', type: 'exact', module: 'master_servant', action: 'rank_gold', desc: '查看黄金排行榜' },
  { trigger: '身价排行', type: 'exact', module: 'master_servant', action: 'rank_value', desc: '查看身价排行榜' },
  { trigger: '等级排行', type: 'exact', module: 'master_servant', action: 'rank_level', desc: '查看等级排行榜' },

  { trigger: '命名', type: 'prefix', module: 'racing', action: 'name', desc: '设置赛车车手名', hot: true },
  { trigger: '生涯', type: 'exact', module: 'racing', action: 'career', desc: '查看赛车生涯', hot: true },
  { trigger: '车库', type: 'exact', module: 'racing', action: 'garage', desc: '查看已拥有车辆' },
  { trigger: '车店', type: 'exact', module: 'racing', action: 'shop', desc: '查看车店车辆' },
  { trigger: '升级', type: 'exact', module: 'racing', action: 'upgrade', desc: '购买下一辆赛车' },
  { trigger: '对决', type: 'prefix', module: 'racing', action: 'duel', desc: '与群成员赛车对决', hot: true },
  { trigger: '参赛', type: 'exact', module: 'racing', action: 'race', desc: '参加随机赛事', hot: true },
  { trigger: '换车币', type: 'prefix', module: 'racing', action: 'exchange_coin', desc: '用黄金兑换车币' },
  { trigger: '换汽油', type: 'prefix', module: 'racing', action: 'exchange_fuel', desc: '用黄金兑换汽油' },
  { trigger: '冠军榜', type: 'exact', module: 'racing', action: 'rank_champions', desc: '查看赛车冠军榜' },
  { trigger: '胜利榜', type: 'exact', module: 'racing', action: 'rank_wins', desc: '查看赛车胜利榜' },

  { trigger: '猜拳', type: 'prefix', module: 'light', action: 'rps', desc: '轻娱乐猜拳互动', hot: true },
  { trigger: '骰子', type: 'prefix', module: 'light', action: 'dice', desc: '轻娱乐骰子互动', hot: true },
  { trigger: '数字', type: 'prefix', module: 'light', action: 'number', desc: '轻娱乐数字互动', hot: true }
];

function commandIdFor(item: SubGameplayTrigger): string {
  return `builtin.sub_gameplay.${item.module}.${item.action}.${Buffer.from(`${item.type}:${item.trigger}`, 'utf8').toString('hex')}`;
}

function createPlugin(item: SubGameplayTrigger): CommandPlugin {
  const commandId = commandIdFor(item);
  return {
    metadata: {
      id: commandId,
      name: 'SUB玩法',
      description: item.desc,
      version: '1.0.0',
      author: 'system.builtin.sub_gameplay',
      specVersion: '3.0'
    },
    source: 'plugin',
    definition: {
      id: commandId,
      enabled: true,
      priority: 45,
      featureType: 'activity',
      featureKey: `activity.sub_gameplay.${item.module}`,
      scope: 'group',
      allowedGroups: [],
      blockedGroups: [],
      requiresLicense: false,
      permission: 'all',
      trigger: {
        type: item.type,
        value: item.trigger
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
      fallbackText: 'SUB玩法命令执行失败'
    },
    schema: {
      id: commandId,
      name: 'SUB玩法',
      enabled: true,
      trigger: item.trigger,
      triggerType: item.type,
      permission: 'all',
      scope: 'group',
      hot: item.hot === true,
      desc: item.desc,
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
    defaultConfig: {
      module: item.module,
      action: item.action
    },
    validate: async (input) => {
      if (input.messageType !== 'group') {
        return { ok: false, errorType: 'validation_error', message: 'sub_gameplay_group_only' };
      }
      return null;
    },
    execute: async (input) => ({
      ok: true,
      response: {
        type: 'text',
        text: await executeSubGameplayCommand({ module: item.module, action: item.action }, input)
      }
    }),
    fallback: async (_input, failure) => ({
      ok: true,
      response: {
        type: 'text',
        text: failure.message || 'SUB玩法命令执行失败'
      }
    })
  };
}

let registered = false;

export function registerSubGameplayCommandPlugins(): void {
  if (registered) return;
  registerCommandPluginBatch(SUB_GAMEPLAY_TRIGGERS.map(createPlugin));
  registered = true;
}
