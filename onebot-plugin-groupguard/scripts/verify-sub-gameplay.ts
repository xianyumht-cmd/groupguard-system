import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG, normalizePluginConfig } from '../src/config.ts';
import { handleCommand, initCommandValidation } from '../src/commands.ts';
import { contextStateService } from '../src/core/state-services/context_state_service.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { storageAdapter } from '../src/storage_adapter.ts';

interface SentMessage {
  action: string;
  params: any;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-sub-gameplay-'));
const sent: SentMessage[] = [];

contextStateService.setConfigDir(tempRoot);
contextStateService.setDataDir(path.join(tempRoot, 'data'));
contextStateService.setConfigPath(path.join(tempRoot, 'config.json'));
contextStateService.setDynamicCommandsConfigPath(path.join(tempRoot, 'dynamic-commands.json'));
contextStateService.setHostProfileId('verify');
contextStateService.setActions({
  async call(actionName: string, params: unknown) {
    sent.push({ action: actionName, params });
    if (actionName === 'get_group_member_info') return { role: 'member' };
    return { message_id: sent.length };
  }
});

const config = normalizePluginConfig({
  ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)),
  global: {
    ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG.global)),
    masterEnabled: true,
    activeReplyEnabled: true,
    subGameplay: {
      enabled: true,
      commandPrefix: '',
      masterServantEnabled: true,
      racingEnabled: true,
      lightEntertainmentEnabled: true,
      dailyWelfareGold: 1000,
      initialGold: 500,
      initialRacingCoins: 0,
      initialFuel: 100,
      maxFuel: 100,
      duelCostFuel: 10,
      raceCostFuel: 15,
      carCoinExchangeRate: 10,
      fuelExchangeRate: 5,
      pkCooldownSeconds: 0,
      escapeSuccessRate: 100,
      snatchSuccessRate: 100,
      contractTaxRate: 10,
      rankLimit: 10,
      textTemplates: {},
      commandAliases: {}
    }
  },
  licenses: {}
} as any);

configStateService.setConfig(config);
storageAdapter.init(tempRoot);
initCommandValidation();

function textOfLastSend(): string {
  const last = sent[sent.length - 1];
  const message = last?.params?.message;
  if (Array.isArray(message)) {
    return message.map((segment: any) => segment?.data?.text || '').join('');
  }
  return String(message || '');
}

async function emit(raw: string, userId = '10001'): Promise<string> {
  const before = sent.length;
  const handled = await handleCommand({
    message_type: 'group',
    group_id: 90001,
    user_id: Number(userId),
    raw_message: raw,
    message: [{ type: 'text', data: { text: raw } }]
  } as any, { configPath: path.join(tempRoot, 'config.json') } as any);
  if (!handled) throw new Error(`not handled: ${raw}`);
  if (sent.length <= before) throw new Error(`no response: ${raw}`);
  return textOfLastSend();
}

const checks: Array<[string, string | RegExp]> = [
  ['新人福利', /新人福利领取成功/],
  ['我的契约', /我的契约/],
  ['雇佣 [CQ:at,qq=10002]', /雇佣成功/],
  ['赐名 执事', /赐名成功/],
  ['结算仆人', /结算仆人完成/],
  ['黄金排行', /黄金排行/],
  ['命名 疾风', /车手命名成功/],
  ['生涯', /赛车生涯/],
  ['换车币 10', /兑换成功/],
  ['参赛', /参赛/],
  ['冠军榜', /冠军榜/],
  ['猜拳 [CQ:at,qq=10002]', /猜拳/],
  ['骰子 [CQ:at,qq=10002]', /骰子/],
  ['数字 5', /数字/]
];

for (const [command, expected] of checks) {
  const response = await emit(command);
  if (expected instanceof RegExp ? !expected.test(response) : !response.includes(expected)) {
    throw new Error(`unexpected response for ${command}: ${response}`);
  }
  console.log(`[ok] ${command} -> ${response.split('\n')[0]}`);
}

const master = storageAdapter.getSubPlayer('90001', '10001');
const racing = storageAdapter.getSubRacingPlayer('90001', '10001');
if (!master || master.gold <= 0) throw new Error('missing sub player persistence');
if (!racing || racing.racerName !== '疾风') throw new Error('missing racing persistence');

console.log(`[ok] sqlite=${path.join(tempRoot, 'data', 'groupguard.db')}`);
console.log('[ok] SUB gameplay simulated host events passed');
