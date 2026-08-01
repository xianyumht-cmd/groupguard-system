import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PLUGIN_CONFIG, normalizePluginConfig } from '../src/config.ts';
import { handleCommand, initCommandValidation } from '../src/commands.ts';
import { contextStateService } from '../src/core/state-services/context_state_service.ts';
import { configStateService } from '../src/core/state-services/config_state_service.ts';
import { storageAdapter } from '../src/storage_adapter.ts';
import { registerRuntimeRoutes } from '../src/runtime/runtime_routes.ts';
import { getRuntimeSchemaCatalog } from '../src/runtime/command_schema_catalog.ts';

interface SentMessage {
  action: string;
  params: any;
}

type RouteHandler = (req: any, res: any) => void | Promise<void>;

class SmokeRouter {
  getRoutes = new Map<string, RouteHandler>();
  postRoutes = new Map<string, RouteHandler>();

  getNoAuth(pathname: string, handler: RouteHandler) {
    this.getRoutes.set(pathname, handler);
  }

  postNoAuth(pathname: string, handler: RouteHandler) {
    this.postRoutes.set(pathname, handler);
  }

  static() {}
  page() {}

  async get(pathname: string, query: Record<string, any> = {}) {
    const handler = this.getRoutes.get(pathname);
    if (!handler) throw new Error(`missing GET route: ${pathname}`);
    return invokeRoute(handler, { query });
  }
}

function invokeRoute(handler: RouteHandler, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        if (this.statusCode >= 400) {
          reject(new Error(`route_status_${this.statusCode}:${JSON.stringify(payload)}`));
          return;
        }
        resolve(payload);
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function createEleApiServer() {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && url.pathname.startsWith('/api/build/active/')) {
      res.end(JSON.stringify({ code: 0, data: null }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/build') {
      res.end(JSON.stringify({
        code: 0,
        data: {
          jobId: 'smoke-job-1',
          status: 'success',
          shareUrl: 'https://pan.example/smoke-ele-share',
          fromCache: false
        }
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: -1, message: 'not_found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ele smoke server failed');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function textFromParams(params: any): string {
  const message = params?.message;
  if (Array.isArray(message)) return message.map((segment: any) => segment?.data?.text || '').join('');
  return String(message || '');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-full-smoke-'));
  const eleApi = await createEleApiServer();
  const sent: SentMessage[] = [];

  try {
    const router = new SmokeRouter();
    contextStateService.setConfigDir(tempRoot);
    contextStateService.setDataDir(path.join(tempRoot, 'data'));
    contextStateService.setConfigPath(path.join(tempRoot, 'config.json'));
    contextStateService.setDynamicCommandsConfigPath(path.join(tempRoot, 'dynamic-commands.json'));
    contextStateService.setHostProfileId('smoke');
    contextStateService.setActions({
      async call(actionName: string, params: unknown) {
        sent.push({ action: actionName, params });
        if (actionName === 'get_group_member_info') return { role: 'owner' };
        if (actionName === 'get_group_list') return [{ group_id: 90001, group_name: 'Smoke Group' }];
        return { message_id: sent.length };
      }
    });

    const config = normalizePluginConfig({
      ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)),
      ownerQQs: '10001',
      eleBuildApiBaseUrl: eleApi.baseUrl,
      global: {
        ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG.global)),
        masterEnabled: true,
        activeReplyEnabled: true,
        dynamicCommandEnabled: true,
        disableReplyTemplate: true,
        randomDelayMin: 0,
        randomDelayMax: 0,
        globalMaxPerMinute: 10000,
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
    registerRuntimeRoutes({
      router,
      actions: contextStateService.getActions(),
      adapterName: 'smoke',
      pluginManager: { config: {} },
      configPath: path.join(tempRoot, 'config.json')
    } as any, () => ({ summary: { total: 0, high: 0, medium: 0, low: 0 }, issues: [] }));

    async function emit(raw: string, userId = '10001', messageType: 'group' | 'private' = 'group'): Promise<string> {
      const before = sent.length;
      const event = messageType === 'private'
        ? {
            message_type: 'private',
            user_id: Number(userId),
            raw_message: raw,
            message: [{ type: 'text', data: { text: raw } }]
          }
        : {
            message_type: 'group',
            group_id: 90001,
            user_id: Number(userId),
            raw_message: raw,
            message: [{ type: 'text', data: { text: raw } }]
          };
      const handled = await handleCommand(event as any, { configPath: path.join(tempRoot, 'config.json') } as any);
      if (!handled) throw new Error(`not handled: ${raw}`);
      const deadline = Date.now() + 5000;
      while (sent.length <= before && Date.now() < deadline) await sleep(20);
      if (sent.length <= before) throw new Error(`no response: ${raw}`);
      return textFromParams(sent[sent.length - 1].params);
    }

    const schema = await getRuntimeSchemaCatalog();
    const flatSchema = schema.flatMap((module: any) => module.items || []);
    const requiredTriggers = ['新人福利', '我的契约', '命名', '生涯', '猜拳', 'ele下载'];
    for (const trigger of requiredTriggers) {
      if (!flatSchema.some((item: any) => item.trigger === trigger)) {
        throw new Error(`runtime schema missing trigger: ${trigger}`);
      }
    }
    console.log(`[ok] runtime schema commands=${flatSchema.length}`);

    const configRoute = await router.get('/config');
    if (configRoute.code !== 0 || configRoute.data?.eleBuildApiBaseUrl !== eleApi.baseUrl) {
      throw new Error('config route did not expose eleBuildApiBaseUrl');
    }
    console.log('[ok] runtime /config exposes eleBuildApiBaseUrl');

    const subCommands: Array<[string, RegExp]> = [
      ['新人福利', /新人福利领取成功/],
      ['我的契约', /我的契约/],
      ['雇佣 [CQ:at,qq=10002]', /雇佣成功/],
      ['命名 疾风', /车手命名成功/],
      ['生涯', /赛车生涯/],
      ['猜拳 [CQ:at,qq=10002]', /猜拳/]
    ];
    for (const [raw, expected] of subCommands) {
      const response = await emit(raw);
      if (!expected.test(response)) throw new Error(`unexpected response for ${raw}: ${response}`);
      console.log(`[ok] command ${raw}`);
    }

    const invalidEle = await emit('ele下载 bad-key');
    if (!/卡密|格式/.test(invalidEle)) throw new Error(`unexpected invalid ELE response: ${invalidEle}`);
    console.log('[ok] ele invalid key validation');

    const validEle = await emit('ele下载 00112233445566778899aabbccddeeff');
    if (!/提交|生成|完成/.test(validEle)) throw new Error(`unexpected ELE submit response: ${validEle}`);
    const deadline = Date.now() + 5000;
    while (!sent.some(item => textFromParams(item.params).includes('https://pan.example/smoke-ele-share')) && Date.now() < deadline) {
      await sleep(50);
    }
    if (!sent.some(item => textFromParams(item.params).includes('https://pan.example/smoke-ele-share'))) {
      throw new Error('ELE final share URL was not sent');
    }
    if (!eleApi.requests.some(line => line.includes('/api/build/active/')) || !eleApi.requests.some(line => line === 'POST /api/build')) {
      throw new Error(`ELE API URL was not used: ${eleApi.requests.join(', ')}`);
    }
    console.log(`[ok] ele configured api used ${eleApi.baseUrl}`);

    const overview = await router.get('/sub-gameplay/overview', { group_id: '90001', limit: 5 });
    if (overview.code !== 0 || !Array.isArray(overview.data?.recentEvents) || overview.data.recentEvents.length < 1) {
      throw new Error('sub gameplay overview route failed');
    }
    console.log('[ok] runtime /sub-gameplay/overview');

    const activity = await router.get('/activity', { group_id: '90001' });
    if (activity.code !== 0) throw new Error('activity route failed');
    console.log('[ok] runtime /activity');

    const master = storageAdapter.getSubPlayer('90001', '10001');
    const racing = storageAdapter.getSubRacingPlayer('90001', '10001');
    if (!master || !racing) throw new Error('sqlite gameplay records missing');
    console.log('[ok] sqlite records persisted');

    console.log(`[ok] smoke temp=${tempRoot}`);
    console.log('[ok] SL static/dynamic smoke passed');
  } finally {
    await eleApi.close();
  }
}

await main();
