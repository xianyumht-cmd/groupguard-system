import assert from 'node:assert/strict';
import { normalizePluginConfig } from '../src/config.ts';
import { findContentRiskMatchForTest } from '../src/services/content_risk_service.ts';
import type { ContentRiskSettings, PluginConfig } from '../src/types.ts';

type PartialPluginConfig = Omit<Partial<PluginConfig>, 'global'> & {
  global?: Partial<PluginConfig['global']>;
};

function normalize(input: PartialPluginConfig): PluginConfig {
  return normalizePluginConfig(input as PluginConfig);
}

function risk(input: Partial<ContentRiskSettings>): ContentRiskSettings {
  const cfg = normalize({
    global: {
      contentRisk: {
        enabled: false,
        notifyGroup: false,
        logOnly: false,
        rules: {},
        ...input
      } as ContentRiskSettings
    }
  });
  return cfg.global.contentRisk as ContentRiskSettings;
}

async function main() {
  const fresh = normalize({});
  assert.equal(fresh.contentRisk?.enabled, false, 'fresh install: top-level content risk stays disabled');
  assert.equal(fresh.global.contentRisk?.enabled, false, 'fresh install: global content risk stays disabled');
  assert.equal(fresh.global.contentRisk?.rules?.url?.enabled, false, 'fresh install: url recall disabled');
  assert.equal(fresh.global.contentRisk?.rules?.qr?.enabled, false, 'fresh install: qr recall disabled');
  assert.equal(fresh.global.contentRisk?.rules?.groupInvite?.enabled, false, 'fresh install: group invite recall disabled');

  const migrated = normalize({
    msgFilter: {
      blockVideo: false,
      blockImage: false,
      blockRecord: false,
      blockForward: false,
      blockLightApp: false,
      blockContact: false,
      blockUrl: true,
      blockQr: true
    }
  } as PartialPluginConfig);
  assert.equal(migrated.contentRisk?.enabled, true, 'legacy msgFilter enables content risk for old active installs');
  assert.equal(migrated.contentRisk?.rules?.url?.enabled, true, 'legacy blockUrl maps to url rule');
  assert.equal(migrated.contentRisk?.rules?.qr?.enabled, true, 'legacy blockQr maps to qr rule');

  const totalOff = risk({
    enabled: false,
    rules: {
      url: { enabled: true, action: 'recall', banMinutes: 10 }
    }
  });
  assert.equal(await findContentRiskMatchForTest('visit https://bad.example/a', [], totalOff), null, 'total switch off blocks no messages');

  const urlOn = risk({
    enabled: true,
    rules: {
      url: { enabled: true, action: 'recall', banMinutes: 10 }
    }
  });
  assert.equal((await findContentRiskMatchForTest('visit example.com/path', [], urlOn))?.type, 'url', 'url rule detects bare domains');

  const urlOff = risk({
    enabled: true,
    rules: {
      url: { enabled: false, action: 'recall', banMinutes: 10 }
    }
  });
  assert.equal(await findContentRiskMatchForTest('visit https://bad.example/a', [], urlOff), null, 'disabled url rule does not recall links');

  const qrOff = risk({
    enabled: true,
    rules: {
      qr: { enabled: false, action: 'recall', banMinutes: 10 }
    }
  });
  assert.equal(await findContentRiskMatchForTest('', [{ type: 'image', data: { url: 'https://example.com/qr.png' } }], qrOff), null, 'qr rule off does not scan images');

  const groupInviteOn = risk({
    enabled: true,
    rules: {
      groupInvite: { enabled: true, action: 'recall', banMinutes: 10 }
    }
  });
  assert.equal((await findContentRiskMatchForTest('加群 123456', [{ type: 'json', data: { data: JSON.stringify({ meta: { news: { tag: '群聊', jumpUrl: 'mqqapi://card/show_pslcard?src_type=internal&source=sharecard&version=1&uin=123456' } } }) } }], groupInviteOn))?.type, 'groupInvite', 'group invite card is detected');
}

await main();
console.log('content risk verification passed');