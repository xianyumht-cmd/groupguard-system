import { configStateService } from '../core/state-services/config_state_service';
import { storageAdapter } from '../storage_adapter';
import type { SubGameplaySettings } from '../types';
import type { UnifiedCommandNormalizedInput } from '../dynamic-commands/types';
import { getLightEntertainmentImage, getModuleRepresentativeImage, toOneBotImageSource } from './sub_gameplay_resources';

type SubModule = 'master_servant' | 'racing' | 'light';
type MasterRank = 'gold' | 'value' | 'level';
type RacingRank = 'wins' | 'champions';
type LightImageKey =
  | 'dice_1' | 'dice_2' | 'dice_3' | 'dice_4' | 'dice_5' | 'dice_6'
  | 'rps_paper' | 'rps_rock' | 'rps_scissors' | 'rps_win' | 'rps_draw' | 'rps_lose';

export type SubGameplayCommandResult = string | {
  text: string;
  segments?: Array<Record<string, unknown>>;
};

interface SubCommandRoute {
  module: SubModule;
  action: string;
}

interface SubPlayer {
  groupId: string;
  userId: string;
  nickname: string;
  gold: number;
  value: number;
  exp: number;
  level: number;
  title: string;
  servantName: string;
  masterId: string;
  lastWelfareDay: string;
  lastActionAt: number;
  createdAt: number;
  updatedAt: number;
}

interface RacingPlayer {
  groupId: string;
  userId: string;
  racerName: string;
  carCoins: number;
  fuel: number;
  wins: number;
  losses: number;
  champions: number;
  careerRuns: number;
  activeCarId: string;
  ownedCars: string[];
  lastDuelAt: number;
  createdAt: number;
  updatedAt: number;
}

const CAR_CATALOG = [
  { id: 'starter', name: '新手车', price: 0, power: 10 },
  { id: 'comet', name: '彗星', price: 300, power: 22 },
  { id: 'thunder', name: '雷霆', price: 800, power: 38 },
  { id: 'nova', name: '星环', price: 1800, power: 58 },
  { id: 'epoch', name: '创时代', price: 3600, power: 86 }
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function chance(percent: number): boolean {
  return randomInt(1, 100) <= clampInt(percent, 0, 0, 100);
}

function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function displayUser(userId: string): string {
  return userId ? `@${userId}` : '未知成员';
}

function extractTarget(rawText: string, argument: string): string {
  const at = String(rawText || '').match(/\[CQ:at,qq=(\d+)\]/);
  if (at) return at[1];
  const qq = String(argument || rawText || '').match(/\b(\d{5,13})\b/);
  return qq ? qq[1] : '';
}

function stripTarget(argument: string, targetId: string): string {
  let text = normalizeText(argument);
  text = text.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
  if (targetId) text = text.replace(new RegExp(`\\b${targetId}\\b`), '').trim();
  return normalizeText(text);
}

function getSettings(groupId: string): SubGameplaySettings {
  const settings = configStateService.resolveGroupSettings(groupId);
  return settings.subGameplay as SubGameplaySettings;
}

function isModuleEnabled(settings: SubGameplaySettings, module: SubModule): boolean {
  if (!settings?.enabled) return false;
  if (module === 'master_servant') return settings.masterServantEnabled !== false;
  if (module === 'racing') return settings.racingEnabled !== false;
  if (module === 'light') return settings.lightEntertainmentEnabled !== false;
  return false;
}

function shouldUseResources(settings: SubGameplaySettings, module: SubModule): boolean {
  if (settings.resourceMode === 'all') return true;
  return settings.resourceMode === 'light' && module === 'light';
}

function withLightImages(settings: SubGameplaySettings, text: string, keys: LightImageKey[]): SubGameplayCommandResult {
  if (!shouldUseResources(settings, 'light')) return text;
  const imageSegments = keys
    .map(key => getLightEntertainmentImage(key))
    .filter((filePath): filePath is string => !!filePath)
    .map(filePath => toOneBotImageSource(filePath))
    .filter((source): source is string => !!source)
    .map(source => ({ type: 'image', data: { file: source } }));
  if (!imageSegments.length) return text;
  return {
    text,
    segments: [
      { type: 'text', data: { text: `${text}\n` } },
      ...imageSegments
    ]
  };
}

function withModuleRepresentativeImage(settings: SubGameplaySettings, module: SubModule, text: string): SubGameplayCommandResult {
  if (settings.resourceMode !== 'all') return text;
  const filePath = getModuleRepresentativeImage(module);
  if (!filePath) return text;
  const source = toOneBotImageSource(filePath);
  if (!source) return text;
  return {
    text,
    segments: [
      { type: 'text', data: { text: `${text}\n` } },
      { type: 'image', data: { file: source } }
    ]
  };
}

function applyLevel(player: SubPlayer): SubPlayer {
  const nextLevel = Math.max(1, Math.floor(player.exp / 100) + 1);
  return {
    ...player,
    level: nextLevel,
    title: nextLevel >= 20 ? '传说契约者' : nextLevel >= 10 ? '资深契约者' : nextLevel >= 5 ? '契约者' : '新人'
  };
}

function getOrCreateSubPlayer(groupId: string, userId: string, settings: SubGameplaySettings): SubPlayer {
  const row = storageAdapter.getSubPlayer(groupId, userId) as SubPlayer | undefined;
  if (row) return row;
  const now = Date.now();
  const player: SubPlayer = {
    groupId,
    userId,
    nickname: userId,
    gold: settings.initialGold,
    value: Math.max(100, settings.initialGold),
    exp: 0,
    level: 1,
    title: '新人',
    servantName: '',
    masterId: '',
    lastWelfareDay: '',
    lastActionAt: 0,
    createdAt: now,
    updatedAt: now
  };
  storageAdapter.upsertSubPlayer(player);
  return player;
}

function saveSubPlayer(player: SubPlayer): SubPlayer {
  const next = applyLevel({ ...player, updatedAt: Date.now() });
  storageAdapter.upsertSubPlayer(next);
  return next;
}

function getOrCreateRacingPlayer(groupId: string, userId: string, settings: SubGameplaySettings): RacingPlayer {
  const row = storageAdapter.getSubRacingPlayer(groupId, userId) as RacingPlayer | undefined;
  if (row) return row;
  const now = Date.now();
  const player: RacingPlayer = {
    groupId,
    userId,
    racerName: userId,
    carCoins: settings.initialRacingCoins,
    fuel: settings.initialFuel,
    wins: 0,
    losses: 0,
    champions: 0,
    careerRuns: 0,
    activeCarId: 'starter',
    ownedCars: ['starter'],
    lastDuelAt: 0,
    createdAt: now,
    updatedAt: now
  };
  storageAdapter.upsertSubRacingPlayer(player);
  return player;
}

function saveRacingPlayer(player: RacingPlayer): RacingPlayer {
  const next = { ...player, updatedAt: Date.now() };
  storageAdapter.upsertSubRacingPlayer(next);
  return next;
}

function carOf(id: string) {
  return CAR_CATALOG.find(car => car.id === id) || CAR_CATALOG[0];
}

function nextCar(player: RacingPlayer) {
  return CAR_CATALOG.find(car => !player.ownedCars.includes(car.id)) || null;
}

function logEvent(groupId: string, module: SubModule, action: string, actorId: string, detail: string, targetId = '', amount = 0, status = 'ok', payload: Record<string, unknown> = {}): void {
  storageAdapter.insertSubGameplayEvent({
    groupId,
    module,
    action,
    actorId,
    targetId,
    amount,
    status,
    detail,
    payload,
    createdAt: Date.now()
  });
}

function renderRank(rows: any[], title: string, valueKey: string, unit: string): string {
  if (!rows.length) return `${title}\n暂无数据`;
  const lines = rows.map((row, index) => {
    const name = row.nickname || row.racerName || row.userId;
    return `${index + 1}. ${name}(${row.userId}) ${Number(row[valueKey] || 0)}${unit}`;
  });
  return `${title}\n${lines.join('\n')}`;
}

function helpText(): string {
  return [
    'SUB玩法命令',
    '主仆契约：新人福利、我的契约、雇佣@、抢走@、赎身、逃跑、释放@、派遣@内容、调教@内容、安慰@内容、结算自己、结算仆人、叫我 名字、赐名 名字、黄金排行、身价排行、等级排行',
    '竞速赛车：命名 名字、生涯、车库、车店、升级、对决@、参赛、换车币 数量、换汽油 数量、冠军榜、胜利榜',
    '轻娱乐：猜拳@、骰子@、数字@'
  ].join('\n');
}

async function executeMasterServant(route: SubCommandRoute, input: UnifiedCommandNormalizedInput, settings: SubGameplaySettings): Promise<string> {
  const groupId = input.groupId || '';
  const userId = input.userId;
  const actor = getOrCreateSubPlayer(groupId, userId, settings);
  const targetId = extractTarget(input.rawText, input.rawArgument);
  const targetArg = stripTarget(input.rawArgument, targetId);

  if (route.action === 'help') return helpText();

  if (route.action === 'welfare') {
    if (actor.lastWelfareDay === todayKey()) return '今日新人福利已经领取过了';
    actor.gold += settings.dailyWelfareGold;
    actor.exp += 20;
    actor.lastWelfareDay = todayKey();
    saveSubPlayer(actor);
    logEvent(groupId, route.module, route.action, userId, `daily_welfare:${settings.dailyWelfareGold}`, '', settings.dailyWelfareGold);
    return `新人福利领取成功：+${settings.dailyWelfareGold}黄金\n当前黄金：${actor.gold}`;
  }

  if (route.action === 'profile') {
    const contract = storageAdapter.getSubContractByServant(groupId, userId);
    const servants = storageAdapter.listSubContractsByMaster(groupId, userId);
    const masterLine = contract?.masterId ? `主人：${displayUser(contract.masterId)}  身价：${contract.price}` : '主人：无';
    const servantLine = servants.length ? servants.map((s: any) => `${displayUser(s.servantId)}(${s.servantName || '未赐名'}:${s.price})`).join('、') : '无';
    return [
      `我的契约：${actor.nickname}`,
      `等级：Lv.${actor.level} ${actor.title}`,
      `黄金：${actor.gold}`,
      `身价：${actor.value}`,
      masterLine,
      `仆人：${servantLine}`
    ].join('\n');
  }

  if (route.action === 'rename') {
    if (!targetArg) return '用法：叫我 名字';
    actor.nickname = targetArg.slice(0, 16);
    actor.exp += 5;
    saveSubPlayer(actor);
    return `契约昵称已更新为：${actor.nickname}`;
  }

  if (route.action === 'grant_name') {
    const servants = storageAdapter.listSubContractsByMaster(groupId, userId);
    if (!servants.length) return '你还没有可赐名的仆人';
    const name = targetArg || input.rawArgument;
    if (!normalizeText(name)) return '用法：赐名 名字';
    const selected = targetId
      ? servants.find((item: any) => item.servantId === targetId)
      : servants[0];
    if (!selected) return '目标不是你的仆人';
    selected.servantName = normalizeText(name).slice(0, 16);
    storageAdapter.upsertSubContract(selected);
    const servant = getOrCreateSubPlayer(groupId, selected.servantId, settings);
    servant.servantName = selected.servantName;
    saveSubPlayer(servant);
    return `赐名成功：${displayUser(selected.servantId)} 现在叫 ${selected.servantName}`;
  }

  if (route.action === 'hire' || route.action === 'snatch') {
    if (!targetId) return route.action === 'hire' ? '用法：雇佣 @成员' : '用法：抢走 @成员';
    if (targetId === userId) return '不能对自己使用契约操作';
    const target = getOrCreateSubPlayer(groupId, targetId, settings);
    const oldContract = storageAdapter.getSubContractByServant(groupId, targetId);
    const price = Math.max(100, Math.floor((oldContract?.price || target.value || 100) * (oldContract ? 1.2 : 1)));
    if (route.action === 'snatch' && !chance(settings.snatchSuccessRate)) {
      const penalty = Math.max(10, Math.floor(price * 0.08));
      actor.gold = Math.max(0, actor.gold - penalty);
      saveSubPlayer(actor);
      logEvent(groupId, route.module, route.action, userId, `snatch_failed:${penalty}`, targetId, penalty, 'failed');
      return `抢走失败，损失${penalty}黄金`;
    }
    if (actor.gold < price) return `黄金不足，需要${price}黄金`;
    actor.gold -= price;
    actor.exp += 30;
    target.masterId = userId;
    target.value = price;
    if (oldContract?.masterId && oldContract.masterId !== userId) {
      const oldMaster = getOrCreateSubPlayer(groupId, oldContract.masterId, settings);
      const income = Math.floor(price * (100 - settings.contractTaxRate) / 100);
      oldMaster.gold += income;
      saveSubPlayer(oldMaster);
    }
    saveSubPlayer(actor);
    saveSubPlayer(target);
    storageAdapter.upsertSubContract({
      groupId,
      masterId: userId,
      servantId: targetId,
      price,
      state: 'active',
      servantName: oldContract?.servantName || target.servantName || '',
      createdAt: oldContract?.createdAt || Date.now()
    });
    logEvent(groupId, route.module, route.action, userId, `contract_price:${price}`, targetId, price);
    return `${route.action === 'hire' ? '雇佣' : '抢走'}成功：${displayUser(targetId)}\n成交身价：${price}黄金\n你的余额：${actor.gold}`;
  }

  if (route.action === 'ransom' || route.action === 'escape') {
    const contract = storageAdapter.getSubContractByServant(groupId, userId);
    if (!contract?.masterId) return '你当前没有契约关系';
    if (route.action === 'escape') {
      if (!chance(settings.escapeSuccessRate)) {
        const penalty = Math.max(20, Math.floor(contract.price * 0.1));
        actor.gold = Math.max(0, actor.gold - penalty);
        saveSubPlayer(actor);
        logEvent(groupId, route.module, route.action, userId, `escape_failed:${penalty}`, contract.masterId, penalty, 'failed');
        return `逃跑失败，损失${penalty}黄金`;
      }
    } else {
      const cost = Math.floor(contract.price * (100 + settings.contractTaxRate) / 100);
      if (actor.gold < cost) return `赎身需要${cost}黄金`;
      actor.gold -= cost;
      const master = getOrCreateSubPlayer(groupId, contract.masterId, settings);
      master.gold += contract.price;
      saveSubPlayer(master);
    }
    actor.masterId = '';
    actor.value = Math.max(100, Math.floor(actor.value * 0.8));
    saveSubPlayer(actor);
    storageAdapter.deleteSubContract(groupId, userId);
    logEvent(groupId, route.module, route.action, userId, route.action, contract.masterId, contract.price);
    return route.action === 'escape' ? '逃跑成功，契约已解除' : '赎身成功，契约已解除';
  }

  if (route.action === 'release') {
    if (!targetId) return '用法：释放 @仆人';
    const contract = storageAdapter.getSubContractByServant(groupId, targetId);
    if (!contract || contract.masterId !== userId) return '目标不是你的仆人';
    const servant = getOrCreateSubPlayer(groupId, targetId, settings);
    servant.masterId = '';
    saveSubPlayer(servant);
    storageAdapter.deleteSubContract(groupId, targetId);
    logEvent(groupId, route.module, route.action, userId, 'release', targetId);
    return `已释放 ${displayUser(targetId)}`;
  }

  if (route.action === 'dispatch' || route.action === 'train' || route.action === 'comfort') {
    if (!targetId) return '用法：派遣/调教/安慰 @仆人 内容';
    const contract = storageAdapter.getSubContractByServant(groupId, targetId);
    if (!contract || contract.masterId !== userId) return '目标不是你的仆人';
    const servant = getOrCreateSubPlayer(groupId, targetId, settings);
    const reward = route.action === 'dispatch' ? randomInt(30, 90) : route.action === 'train' ? randomInt(10, 45) : randomInt(15, 60);
    actor.gold += route.action === 'dispatch' ? reward : 0;
    actor.exp += 10;
    servant.exp += route.action === 'train' ? reward : 8;
    servant.value += route.action === 'train' ? Math.floor(reward / 2) : 5;
    saveSubPlayer(actor);
    saveSubPlayer(servant);
    logEvent(groupId, route.module, route.action, userId, targetArg || route.action, targetId, reward);
    const verb = route.action === 'dispatch' ? '派遣' : route.action === 'train' ? '调教' : '安慰';
    return `${verb}完成：${displayUser(targetId)}\n收益：${reward}${route.action === 'dispatch' ? '黄金' : '成长值'}`;
  }

  if (route.action === 'settle_self') {
    const income = actor.level * 50 + randomInt(10, 40);
    actor.gold += income;
    actor.exp += 15;
    saveSubPlayer(actor);
    logEvent(groupId, route.module, route.action, userId, `income:${income}`, '', income);
    return `结算自己完成：+${income}黄金\n当前黄金：${actor.gold}`;
  }

  if (route.action === 'settle_servants') {
    const servants = storageAdapter.listSubContractsByMaster(groupId, userId);
    if (!servants.length) return '你还没有可结算的仆人';
    const income = servants.reduce((sum: number, item: any) => sum + Math.max(5, Math.floor(Number(item.price || 0) / 20)), 0);
    actor.gold += income;
    actor.exp += servants.length * 10;
    saveSubPlayer(actor);
    logEvent(groupId, route.module, route.action, userId, `servants:${servants.length}`, '', income);
    return `结算仆人完成：${servants.length}人，+${income}黄金`;
  }

  if (route.action === 'rank_gold' || route.action === 'rank_value' || route.action === 'rank_level') {
    const rankBy: MasterRank = route.action === 'rank_value' ? 'value' : route.action === 'rank_level' ? 'level' : 'gold';
    const title = rankBy === 'gold' ? '黄金排行' : rankBy === 'value' ? '身价排行' : '等级排行';
    const unit = rankBy === 'level' ? '级' : '黄金';
    return renderRank(storageAdapter.listSubPlayersByRank(groupId, rankBy, settings.rankLimit), title, rankBy, unit);
  }

  return helpText();
}

async function executeRacing(route: SubCommandRoute, input: UnifiedCommandNormalizedInput, settings: SubGameplaySettings): Promise<string> {
  const groupId = input.groupId || '';
  const userId = input.userId;
  const player = getOrCreateRacingPlayer(groupId, userId, settings);
  const subPlayer = getOrCreateSubPlayer(groupId, userId, settings);
  const targetId = extractTarget(input.rawText, input.rawArgument);
  const amount = clampInt(input.rawArgument.match(/\d+/)?.[0], 0, 0, 1000000);

  if (route.action === 'name') {
    const name = normalizeText(input.rawArgument).slice(0, 16);
    if (!name) return '用法：命名 车手名';
    player.racerName = name;
    saveRacingPlayer(player);
    return `车手命名成功：${name}`;
  }

  if (route.action === 'career') {
    const car = carOf(player.activeCarId);
    return [
      `赛车生涯：${player.racerName}`,
      `座驾：${car.name} 战力${car.power}`,
      `车币：${player.carCoins}  汽油：${player.fuel}/${settings.maxFuel}`,
      `胜场：${player.wins}  失败：${player.losses}  冠军：${player.champions}`,
      `参赛次数：${player.careerRuns}`
    ].join('\n');
  }

  if (route.action === 'garage') {
    const owned = player.ownedCars.map(id => {
      const car = carOf(id);
      return `${car.name}${id === player.activeCarId ? '(当前)' : ''}`;
    }).join('、');
    return `车库\n${owned || '暂无车辆'}`;
  }

  if (route.action === 'shop') {
    return `车店\n${CAR_CATALOG.map(car => `${car.name}：${car.price}车币，战力${car.power}`).join('\n')}`;
  }

  if (route.action === 'upgrade') {
    const car = nextCar(player);
    if (!car) return '你已经拥有全部车辆';
    if (player.carCoins < car.price) return `车币不足，升级到${car.name}需要${car.price}车币`;
    player.carCoins -= car.price;
    player.ownedCars.push(car.id);
    player.activeCarId = car.id;
    saveRacingPlayer(player);
    logEvent(groupId, route.module, route.action, userId, `car:${car.id}`, '', car.price);
    return `升级成功：获得${car.name}\n剩余车币：${player.carCoins}`;
  }

  if (route.action === 'duel') {
    if (!targetId) return '用法：对决 @成员';
    if (targetId === userId) return '不能和自己对决';
    if (Date.now() - player.lastDuelAt < settings.pkCooldownSeconds * 1000) return `对决冷却中：${settings.pkCooldownSeconds}秒`;
    if (player.fuel < settings.duelCostFuel) return `汽油不足，对决需要${settings.duelCostFuel}`;
    const target = getOrCreateRacingPlayer(groupId, targetId, settings);
    const myScore = carOf(player.activeCarId).power + randomInt(1, 50) + Math.floor(player.wins / 3);
    const targetScore = carOf(target.activeCarId).power + randomInt(1, 50) + Math.floor(target.wins / 3);
    player.fuel -= settings.duelCostFuel;
    player.lastDuelAt = Date.now();
    if (myScore >= targetScore) {
      player.wins += 1;
      player.carCoins += 25;
      target.losses += 1;
    } else {
      player.losses += 1;
      target.wins += 1;
      target.carCoins += 15;
    }
    saveRacingPlayer(player);
    saveRacingPlayer(target);
    logEvent(groupId, route.module, route.action, userId, `${myScore}:${targetScore}`, targetId, myScore >= targetScore ? 1 : 0, myScore >= targetScore ? 'win' : 'lose');
    return myScore >= targetScore
      ? `对决胜利：${myScore} : ${targetScore}\n获得25车币`
      : `对决失败：${myScore} : ${targetScore}`;
  }

  if (route.action === 'race') {
    if (player.fuel < settings.raceCostFuel) return `汽油不足，参赛需要${settings.raceCostFuel}`;
    player.fuel -= settings.raceCostFuel;
    player.careerRuns += 1;
    const score = carOf(player.activeCarId).power + randomInt(1, 100);
    if (score >= 120) {
      player.champions += 1;
      player.wins += 1;
      player.carCoins += 120;
      saveRacingPlayer(player);
      logEvent(groupId, route.module, route.action, userId, `champion:${score}`, '', 120, 'champion');
      return `参赛夺冠！评分${score}\n获得120车币`;
    }
    if (score >= 70) {
      player.wins += 1;
      player.carCoins += 45;
      saveRacingPlayer(player);
      return `参赛完成：评分${score}\n获得45车币`;
    }
    player.losses += 1;
    saveRacingPlayer(player);
    return `参赛失利：评分${score}\n车辆和油量需要继续提升`;
  }

  if (route.action === 'exchange_coin' || route.action === 'exchange_fuel') {
    if (amount <= 0) return route.action === 'exchange_coin' ? '用法：换车币 数量' : '用法：换汽油 数量';
    const rate = route.action === 'exchange_coin' ? settings.carCoinExchangeRate : settings.fuelExchangeRate;
    const cost = amount * rate;
    if (subPlayer.gold < cost) return `黄金不足，需要${cost}黄金`;
    subPlayer.gold -= cost;
    if (route.action === 'exchange_coin') {
      player.carCoins += amount;
    } else {
      player.fuel = Math.min(settings.maxFuel, player.fuel + amount);
    }
    saveSubPlayer(subPlayer);
    saveRacingPlayer(player);
    logEvent(groupId, route.module, route.action, userId, `amount:${amount}`, '', cost);
    return route.action === 'exchange_coin'
      ? `兑换成功：+${amount}车币，花费${cost}黄金`
      : `兑换成功：+${amount}汽油，花费${cost}黄金，当前${player.fuel}/${settings.maxFuel}`;
  }

  if (route.action === 'rank_wins' || route.action === 'rank_champions') {
    const rankBy: RacingRank = route.action === 'rank_champions' ? 'champions' : 'wins';
    return renderRank(storageAdapter.listSubRacingPlayersByRank(groupId, rankBy, settings.rankLimit), rankBy === 'champions' ? '冠军榜' : '胜利榜', rankBy, rankBy === 'champions' ? '冠' : '胜');
  }

  return helpText();
}

async function executeLight(route: SubCommandRoute, input: UnifiedCommandNormalizedInput): Promise<string> {
  const groupId = input.groupId || '';
  const userId = input.userId;
  const targetId = extractTarget(input.rawText, input.rawArgument);

  if (route.action === 'rps') {
    const options = ['石头', '剪刀', '布'];
    const a = options[randomInt(0, 2)];
    const b = options[randomInt(0, 2)];
    const result = a === b ? '平局' : (a === '石头' && b === '剪刀') || (a === '剪刀' && b === '布') || (a === '布' && b === '石头') ? '胜利' : '失败';
    logEvent(groupId, route.module, route.action, userId, `${a}:${b}:${result}`, targetId);
    return `猜拳${targetId ? ` vs ${displayUser(targetId)}` : ''}\n你：${a}\n对方：${b}\n结果：${result}`;
  }

  if (route.action === 'dice') {
    const a = randomInt(1, 6);
    const b = randomInt(1, 6);
    const result = a === b ? '平局' : a > b ? '胜利' : '失败';
    logEvent(groupId, route.module, route.action, userId, `${a}:${b}:${result}`, targetId);
    return `骰子${targetId ? ` vs ${displayUser(targetId)}` : ''}\n你：${a}\n对方：${b}\n结果：${result}`;
  }

  if (route.action === 'number') {
    const secret = randomInt(1, 10);
    const guess = clampInt(input.rawArgument.match(/\d+/)?.[0], 0, 0, 10);
    const text = guess ? `你的数字：${guess}\n目标数字：${secret}\n结果：${guess === secret ? '命中' : '未命中'}` : `数字游戏\n本轮数字：${secret}`;
    logEvent(groupId, route.module, route.action, userId, text, targetId, guess === secret ? 1 : 0, guess === secret ? 'hit' : 'miss');
    return text;
  }

  return helpText();
}

async function executeLightWithResources(route: SubCommandRoute, input: UnifiedCommandNormalizedInput, settings: SubGameplaySettings): Promise<SubGameplayCommandResult> {
  const groupId = input.groupId || '';
  const userId = input.userId;
  const targetId = extractTarget(input.rawText, input.rawArgument);

  if (route.action === 'rps') {
    const options: Array<{ id: 'rock' | 'scissors' | 'paper'; label: string; image: LightImageKey; }> = [
      { id: 'rock', label: '石头', image: 'rps_rock' },
      { id: 'scissors', label: '剪刀', image: 'rps_scissors' },
      { id: 'paper', label: '布', image: 'rps_paper' }
    ];
    const a = options[randomInt(0, 2)];
    const b = options[randomInt(0, 2)];
    const outcome = a.id === b.id
      ? 'draw'
      : (a.id === 'rock' && b.id === 'scissors') || (a.id === 'scissors' && b.id === 'paper') || (a.id === 'paper' && b.id === 'rock')
        ? 'win'
        : 'lose';
    const result = outcome === 'draw' ? '平局' : outcome === 'win' ? '胜利' : '失败';
    const resultImage: LightImageKey = outcome === 'draw' ? 'rps_draw' : outcome === 'win' ? 'rps_win' : 'rps_lose';
    logEvent(groupId, route.module, route.action, userId, `${a.label}:${b.label}:${result}`, targetId);
    return withLightImages(
      settings,
      `猜拳${targetId ? ` vs ${displayUser(targetId)}` : ''}\n你：${a.label}\n对方：${b.label}\n结果：${result}`,
      [a.image, b.image, resultImage]
    );
  }

  if (route.action === 'dice') {
    const a = randomInt(1, 6);
    const b = randomInt(1, 6);
    const result = a === b ? '平局' : a > b ? '胜利' : '失败';
    logEvent(groupId, route.module, route.action, userId, `${a}:${b}:${result}`, targetId);
    return withLightImages(
      settings,
      `骰子${targetId ? ` vs ${displayUser(targetId)}` : ''}\n你：${a}\n对方：${b}\n结果：${result}`,
      [`dice_${a}` as LightImageKey, `dice_${b}` as LightImageKey]
    );
  }

  if (route.action === 'number') {
    const secret = randomInt(1, 10);
    const guess = clampInt(input.rawArgument.match(/\d+/)?.[0], 0, 0, 10);
    const text = guess ? `你的数字：${guess}\n目标数字：${secret}\n结果：${guess === secret ? '命中' : '未命中'}` : `数字游戏\n本轮数字：${secret}`;
    logEvent(groupId, route.module, route.action, userId, text, targetId, guess === secret ? 1 : 0, guess === secret ? 'hit' : 'miss');
    return text;
  }

  return helpText();
}

export async function executeSubGameplayCommand(route: SubCommandRoute, input: UnifiedCommandNormalizedInput): Promise<SubGameplayCommandResult> {
  if (!input.groupId) return 'SUB玩法仅支持群聊使用';
  const settings = getSettings(input.groupId);
  if (!isModuleEnabled(settings, route.module)) return 'SUB玩法当前未开启';
  if (route.module === 'master_servant') return withModuleRepresentativeImage(settings, route.module, await executeMasterServant(route, input, settings));
  if (route.module === 'racing') return withModuleRepresentativeImage(settings, route.module, await executeRacing(route, input, settings));
  return executeLightWithResources(route, input, settings);
}
