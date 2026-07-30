type QueryOverview = Record<string, any>;

function replaceOnce(source: string, oldValue: string, nextValue: string, label: string): string {
  if (!source.includes(oldValue)) throw new Error(`query_webui_patch_marker_missing:${label}`);
  return source.replace(oldValue, nextValue);
}

export function normalizeQueryOverviewForWebUi(input: QueryOverview): QueryOverview {
  const overview = structuredClone(input || {});
  const base = overview.base && typeof overview.base === 'object' ? overview.base : {};
  const config = overview.config && typeof overview.config === 'object' ? overview.config : {};
  const profiles = overview.profiles && typeof overview.profiles === 'object' ? overview.profiles : {};
  delete profiles.lol_hidden;
  overview.profiles = profiles;

  const defaultFormat = String(base.defaultOutputFormat || 'forward');
  const localApiUrl = String(config.lolApiBaseUrl || '');
  const rows = Array.isArray(overview.rows) ? overview.rows.filter((row: any) => row?.type !== 'lol_hidden') : [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (['lol_ban', 'scammer', 'peer'].includes(String(row.type || ''))) {
      const profile = profiles[row.type] || {};
      row.dataSource = 'local-api';
      row.url = localApiUrl;
      row.defaultOutputFormat = defaultFormat;
      row.outputFormat = profile.outputFormat || defaultFormat;
      row.wrapperMode = profile.wrapperMode || 'global';
      row.profile = profile;
    }
  }

  if (!rows.some((row: any) => row?.type === 'dynamic')) {
    const profile = profiles.dynamic || {};
    rows.push({
      type: 'dynamic',
      name: '动态查询默认',
      enabled: base.masterEnabled !== false && base.queryEnabled !== false && base.dynamicCommandEnabled !== false && profile.enabled !== false,
      featureKey: 'dynamic',
      trigger: '动态命令',
      dataSource: 'local-api',
      url: localApiUrl,
      heroListUrl: '',
      outputFormat: profile.outputFormat || defaultFormat,
      defaultOutputFormat: defaultFormat,
      wrapperMode: profile.wrapperMode || 'global',
      profile
    });
  }

  overview.rows = rows;
  return overview;
}

export function patchQueryPageHtml(source: string): string {
  let page = String(source || '');
  page = page.replace(
    '骗子查询走外部接口；同行查询走本地数据库；这里用于配置、校验和测试。',
    '查询统一请求内网接口；这里用于配置全局、分群和单命令输出偏好，并进行安全测试。'
  );
  page = page.replace(
    '优先级：单命令配置 > 分群配置 > 全局配置。当前先保存 WebUI 配置，下一步再接入真实查询发送链路。',
    '优先级：单命令配置 > 分群配置 > 全局配置。插件只提交输出偏好，接口端生成最终文字、合并转发或图片。'
  );
  page = page.replace('<option value="lol_hidden">查隐藏</option>', '');
  page = replaceOnce(
    page,
    "var types=['lol_ban','lol_battle','lol_hidden','lol_shard','lol_aram_augments','scammer','peer','ele_build'];",
    "var types=['lol_ban','lol_battle','lol_shard','lol_aram_augments','scammer','peer','dynamic','ele_build'];",
    'types'
  );
  page = replaceOnce(
    page,
    "var names={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'骗子查询',peer:'同行查询',ele_build:'ELE下载'};",
    "var names={lol_ban:'查封号',lol_battle:'查战绩',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'骗子查询',peer:'同行查询',dynamic:'动态查询默认',ele_build:'ELE下载'};",
    'names'
  );
  page = replaceOnce(
    page,
    "var triggers={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'查骗子',peer:'查同行',ele_build:'ELE下载'};",
    "var triggers={lol_ban:'查封号',lol_battle:'查战绩',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'查骗子',peer:'查同行',dynamic:'动态命令',ele_build:'ELE下载'};",
    'triggers'
  );
  page = replaceOnce(
    page,
    "var sources={lol_ban:'local-api',lol_battle:'local-api',lol_hidden:'local-api',lol_shard:'remote-json',lol_aram_augments:'local-api',scammer:'external',peer:'local-db',ele_build:'external'};",
    "var sources={lol_ban:'内网接口',lol_battle:'内网接口',lol_shard:'内网接口',lol_aram_augments:'内网接口',scammer:'内网接口',peer:'内网接口',dynamic:'内网接口',ele_build:'构建接口'};",
    'sources'
  );

  const oldCommandOut = "function commandOut(type,s){var g=currentGroupData&&currentGroupData.group||{};var profiles=currentOverview&&currentOverview.profiles||{};var p=profiles[type]||{};if(type==='lol_shard'){if(g.shardQueryOutputFormat!==undefined)return g.shardQueryOutputFormat;if(p.outputFormat)return p.outputFormat;return s.shardQueryOutputFormat||get(currentOverview,'config.shardQueryOutputFormat','image')}if(type==='lol_aram_augments')return 'image';if(type==='lol_ban'||type==='scammer'||type==='peer'||type==='ele_build')return 'text';if(g.lolQueryOutputFormat!==undefined)return g.lolQueryOutputFormat;if(p.outputFormat)return p.outputFormat;return s.lolQueryOutputFormat||get(currentOverview,'base.defaultOutputFormat','forward')}";
  const nextCommandOut = "function commandOut(type,s){var g=currentGroupData&&currentGroupData.group||{};var profiles=currentOverview&&currentOverview.profiles||{};var p=profiles[type]||{};if(p.outputFormat)return p.outputFormat;if(type==='lol_shard'){if(g.shardQueryOutputFormat!==undefined)return g.shardQueryOutputFormat;return s.shardQueryOutputFormat||get(currentOverview,'config.shardQueryOutputFormat','image')}if(type==='lol_aram_augments')return 'image';if(g.lolQueryOutputFormat!==undefined)return g.lolQueryOutputFormat;return s.lolQueryOutputFormat||get(currentOverview,'base.defaultOutputFormat','forward')}";
  page = replaceOnce(page, oldCommandOut, nextCommandOut, 'commandOut');

  const oldCommandEnabled = "function commandEnabled(type,s){var fs=s.featureSwitches||{};var cs=s.lolQueryCommandSwitch||{};var profiles=currentOverview&&currentOverview.profiles||{};if((profiles[type]||{}).enabled===false)return false;var base=s.masterEnabled!==false&&s.queryEnabled!==false&&s.disableLolQuery!==true;if(type==='lol_ban')return base&&enabledSwitch(fs,'query.lol_ban')&&cs.banQuery!==false;if(type==='lol_battle')return base&&enabledSwitch(fs,'query.lol_battle')&&cs.battleQuery!==false;if(type==='lol_hidden')return base&&enabledSwitch(fs,'query.lol_hidden')&&cs.hiddenQuery!==false;if(type==='lol_shard')return base&&enabledSwitch(fs,'query.lol_shard');if(type==='lol_aram_augments')return base&&enabledSwitch(fs,'query.lol_aram_augments');if(type==='scammer')return s.masterEnabled!==false&&s.queryEnabled!==false&&enabledSwitch(fs,'query.scammer');if(type==='peer')return s.masterEnabled!==false&&s.queryEnabled!==false&&enabledSwitch(fs,'query.peer');if(type==='ele_build')return s.masterEnabled!==false&&s.queryEnabled!==false&&s.dynamicCommandEnabled!==false;return false}";
  const nextCommandEnabled = "function commandEnabled(type,s){var fs=s.featureSwitches||{};var cs=s.lolQueryCommandSwitch||{};var profiles=currentOverview&&currentOverview.profiles||{};if((profiles[type]||{}).enabled===false)return false;var base=s.masterEnabled!==false&&s.queryEnabled!==false&&s.disableLolQuery!==true;if(type==='lol_ban')return base&&enabledSwitch(fs,'query.lol_ban')&&cs.banQuery!==false;if(type==='lol_battle')return base&&enabledSwitch(fs,'query.lol_battle')&&cs.battleQuery!==false;if(type==='lol_shard')return base&&enabledSwitch(fs,'query.lol_shard');if(type==='lol_aram_augments')return base&&enabledSwitch(fs,'query.lol_aram_augments');if(type==='scammer')return base&&enabledSwitch(fs,'query.scammer');if(type==='peer')return base&&enabledSwitch(fs,'query.peer');if(type==='dynamic'||type==='ele_build')return s.masterEnabled!==false&&s.queryEnabled!==false&&s.dynamicCommandEnabled!==false;return false}";
  page = replaceOnce(page, oldCommandEnabled, nextCommandEnabled, 'commandEnabled');

  page = page.replaceAll("['text','image','forward','card']", "['text','forward','image']");
  page = page.replace("+sw('查隐藏','global.featureSwitches.query.lol_hidden',fs['query.lol_hidden']!==false)", '');
  page = page.replace("+sw('hiddenQuery','global.lolQueryCommandSwitch.hiddenQuery',cs.hiddenQuery!==false)", '');
  page = page.replace("+gsw('查隐藏','featureSwitches.query.lol_hidden',gs['query.lol_hidden']!==undefined?gs['query.lol_hidden']:es['query.lol_hidden']!==false)", '');
  page = page.replace("+gsw('hiddenQuery','lolQueryCommandSwitch.hiddenQuery',gcs.hiddenQuery!==undefined?gcs.hiddenQuery:ecs.hiddenQuery!==false)", '');
  page = page.replace(
    "+sw('查询总开关','global.queryEnabled',b.queryEnabled)",
    "+sw('查询总开关','global.queryEnabled',b.queryEnabled)+sw('动态查询/命令','global.dynamicCommandEnabled',b.dynamicCommandEnabled!==false)"
  );
  page = page.replace(
    "sel('默认战绩输出','global.lolQueryOutputFormat',b.defaultOutputFormat,['forward','text','image','card'])",
    "sel('统一查询结果格式','global.lolQueryOutputFormat',b.defaultOutputFormat,['text','forward','image'])"
  );
  page = page.replace(
    "gsel('本群战绩输出','lolQueryOutputFormat',g.lolQueryOutputFormat||e.lolQueryOutputFormat||get(currentOverview,'base.defaultOutputFormat','image'),['forward','text','image','card'])",
    "gsel('本群统一查询结果格式','lolQueryOutputFormat',g.lolQueryOutputFormat||e.lolQueryOutputFormat||get(currentOverview,'base.defaultOutputFormat','forward'),['text','forward','image'])"
  );
  page = page.replace("+inp('隐藏战绩兼容 URL','lolQueryUrl',c.lolQueryUrl||'')", '');
  page = page.replace(
    '同行查询不在这里配置 URL，它走本地数据库。',
    '骗子和同行查询均通过 LOL API Base 的统一内网交付接口。下方旧 URL 仅用于兼容迁移。'
  );
  page = page.replace("(t==='peer'?'本地数据库':t==='scammer'?'外部骗子接口':'')", "(sources[t]||'')");

  if (page.includes('lol_hidden') || page.includes('查隐藏')) {
    throw new Error('query_webui_retired_hidden_query_remains');
  }
  if (!page.includes("dynamic:'动态查询默认'")) {
    throw new Error('query_webui_dynamic_profile_missing');
  }
  return page;
}
