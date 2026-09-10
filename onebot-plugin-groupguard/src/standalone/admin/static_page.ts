export function renderHomePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GroupGuard SnowLuma 控制台</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101827;color:#e5e7eb}
.wrap{max-width:1180px;margin:0 auto;padding:22px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:17px;margin:0 0 12px}
h3{font-size:15px;margin:18px 0 10px;color:#bfdbfe}
.card{background:#172033;border:1px solid #2f3d56;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 12px 28px rgba(0,0,0,.18)}
button,.tablink{background:#2563eb;color:#fff;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block}
button.secondary{background:#334155}
button.danger{background:#b91c1c}
input,select,textarea{width:100%;border:1px solid #40506b;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:9px;font-family:inherit}
textarea{min-height:120px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.45}
#configEditor,#commandsEditor{min-height:360px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.row>*{flex:1;min-width:220px}
.row button{flex:0 0 auto}
label{display:block;margin-bottom:10px}
label span{display:block;font-size:13px;color:#9ca3af;margin-bottom:5px}
.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:10px}
.switch-row input{width:auto}
.switch-row .switch-copy{flex:1}
.switch-row .switch-title{display:block;color:#dbeafe;font-size:13px;margin-bottom:3px}
.switch-row .switch-path{display:block;color:#64748b;font-size:11px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
.field-title{display:block;color:#dbeafe;font-size:13px;margin-bottom:3px}
.field-path{display:block;color:#64748b;font-size:11px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
.field-desc{display:block;color:#94a3b8;font-size:12px;margin-top:3px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.tab,.tablink{background:#1f2937}
.tab.active{background:#2563eb}
.hidden{display:none}
.status-grid{display:grid;grid-template-columns:190px 1fr;gap:8px 12px;font-size:13px}
.k{color:#9ca3af}.v{word-break:break-all}
.hint{color:#93c5fd;font-size:13px}.muted{color:#94a3b8;font-size:12px}
.error{color:#fca5a5}.ok{color:#86efac}
.footer{font-size:12px;color:#94a3b8;margin-top:18px}
pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:12px;max-height:420px;overflow:auto}
table{width:100%;border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden}
th,td{text-align:left;border-bottom:1px solid #263349;padding:8px;font-size:13px}
th{color:#93c5fd;background:#111827}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#334155;font-size:12px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.resource-preview{max-width:92px;max-height:58px;border:1px solid #334155;border-radius:6px;background:#0f172a}
.resource-audio{max-width:180px}
.full{grid-column:1/-1}
.section-title{grid-column:1/-1;border-bottom:1px solid #263349;padding:12px 0 4px;margin-top:4px;color:#bfdbfe;font-weight:700}
#advancedForm .field-path{display:none}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>GroupGuard SnowLuma 控制台</h1>
      <div class="hint">用于修改 SnowLuma 独立版群管配置。保存前会自动备份，并刷新运行时配置。</div>
    </div>
    <button id="refreshBtn">刷新</button>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="status">状态</button>
    <button class="tab" data-tab="switches">全局开关</button>
    <button class="tab" data-tab="groups">分群配置</button>
    <a class="tablink" id="qaLink" href="/qa.html">问答管理</a>
    <button class="tab" data-tab="licenses">授权管理</button>
    <button class="tab" data-tab="backups">备份</button>
    <a class="tablink" id="queryLink" href="/query.html">查询配置</a>
    <button class="tab" data-tab="send">发送与风控</button>
    <button class="tab" data-tab="presets">推荐档位</button>
    <button class="tab" data-tab="risklog">日志分析</button>
    <button class="tab" data-tab="health">健康监控</button>
    <button class="tab" data-tab="self-update">系统更新</button>
    <button class="tab" data-tab="gameplay">SUB玩法</button>
    <button class="tab" data-tab="content-risk">内容风险</button>
    <button class="tab" data-tab="ele">ELE构建</button>
    <button class="tab" data-tab="advanced">全量配置</button>
    <button class="tab" data-tab="raw">config.json</button>
    <button class="tab" data-tab="commands">动态命令</button>
  </div>
  <div id="notice" class="card hidden"></div>

  <section id="tab-status" class="card">
    <h2>运行状态</h2>
    <div id="statusBox" class="status-grid"></div>
  </section>

  <section id="tab-switches" class="card hidden">
    <h2>全局开关</h2>
    <p class="hint">这里是日常使用入口。页面显示为正向中文开关；保存时仍写入现有配置字段，例如“签到功能开启”会保存为 disableSignin=false。</p>
    <div id="switchForm" class="grid"></div>
    <button data-save-form="switchForm">保存全局开关</button>
  </section>

  <section id="tab-groups" class="card hidden">
    <h2>分群配置</h2>
    <div class="row">
      <label><span>选择已有群</span><select id="groupSelect"></select></label>
      <label><span>或输入群号</span><input id="groupIdInput" placeholder="例如 960957757"></label>
      <button id="loadGroupBtn">读取本群</button>
    </div>
    <p class="hint">保存这里的字段会写入本群专属配置；删除本群专属配置后，本群恢复走全局配置。</p>
    <div id="groupMeta" class="hint"></div>
    <h2>本群专属配置</h2>
    <div id="groupForm" class="grid"></div>
    <div class="toolbar">
      <button id="saveGroupBtn">保存本群配置</button>
      <button class="danger" id="deleteGroupBtn">删除本群专属配置</button>
    </div>
    <h2>最终生效配置预览</h2>
    <pre id="groupEffectiveBox"></pre>
  </section>

  <section id="tab-licenses" class="card hidden">
    <h2>授权管理</h2>
    <div class="row">
      <label><span>群号</span><input id="licenseGroupId" placeholder="例如 960957757"></label>
      <label><span>授权等级</span><select id="licenseLevel"><option value="free">free</option><option value="pro" selected>pro</option><option value="enterprise">enterprise</option></select></label>
      <label><span>授权天数，0 表示永久</span><input id="licenseDays" type="number" value="30"></label>
      <button id="saveLicenseBtn">授权/续费</button>
      <button class="danger" id="deleteLicenseBtn">取消授权</button>
    </div>
    <div id="licenseBox"></div>
  </section>

  <section id="tab-backups" class="card hidden">
    <h2>备份</h2>
    <div class="toolbar">
      <button id="snapshotBtn">立即创建配置快照</button>
      <button class="secondary" id="loadBackupsBtn">刷新备份列表</button>
    </div>
    <p class="hint">这里只创建和查看备份，不做一键回滚，避免误恢复旧配置。</p>
    <div id="backupBox"></div>
  </section>

  <section id="tab-send" class="card hidden">
    <h2>发送与风控</h2>
    <div id="sendForm" class="grid"></div>
    <button data-save-form="sendForm">保存发送与风控配置</button>
  </section>

  <section id="tab-presets" class="card hidden">
    <h2>风险推荐档位</h2>
    <div class="toolbar">
      <button data-risk-preset="conservative">保守</button>
      <button class="secondary" data-risk-preset="balanced">平衡</button>
      <button class="secondary" data-risk-preset="aggressive">激进</button>
    </div>
    <p class="hint">保守：URL编号化、查封号短文本、低频发送、合并转发包装；平衡：保留可用性同时降风险；激进：更接近原始发送，风险更高。</p>
    <pre id="presetBox">等待操作...</pre>
  </section>

  <section id="tab-risklog" class="card hidden">
    <h2>日志风险分析</h2>
    <div class="row">
      <label><span>统计小时数</span><input id="riskHours" type="number" value="24"></label>
      <button id="loadRiskBtn">刷新风险分析</button>
    </div>
    <div id="riskBox"></div>
  </section>

  <section id="tab-health" class="card hidden">
    <h2>远端健康监控</h2>
    <div class="toolbar"><button id="loadHealthBtn">刷新健康状态</button></div>
    <div id="healthBox"></div>
  </section>

  <section id="tab-self-update" class="card hidden">
    <h2>系统更新</h2>
    <p class="hint">从固定仓库 main 最近成功的不可变构建更新 GroupGuard。候选包会校验提交和文件哈希，切换前保留上一版；新版本启动失败会自动回滚。</p>
    <div id="selfUpdateBox" class="status-grid"></div>
    <div class="row" style="margin-top:12px">
      <label><span>GitHub 只读 Token（私有仓库首次配置一次）</span><input id="selfUpdateToken" type="password" autocomplete="new-password" placeholder="不会回显或写入 config.json"></label>
      <button id="saveSelfUpdateTokenBtn" class="secondary">保存 Token</button>
      <button id="clearSelfUpdateTokenBtn" class="secondary">清除 Token</button>
    </div>
    <div class="toolbar">
      <button id="checkSelfUpdateBtn" class="secondary">检查更新</button>
      <button id="applySelfUpdateBtn">一键更新</button>
    </div>
    <p class="muted">更新时页面可能短暂断开，supervisor 会自动重启服务；页面会继续轮询直到新版本恢复。</p>
  </section>

  <section id="tab-gameplay" class="card hidden">
    <h2>SUB玩法</h2>
    <p class="hint">使用方式：先开启“SUB总开关”，按需开启主仆契约、竞速赛车、轻娱乐。群内可用 SUB帮助、新人福利、我的契约、命名、生涯、参赛 等命令；命令前缀为空表示直接响应这些命令。</p>
    <div id="gameplayForm" class="grid"></div>
    <button data-save-form="gameplayForm">保存SUB玩法配置</button>
  </section>

  <section id="tab-content-risk" class="card hidden">
    <h2>内容风险</h2>
    <p class="hint">动作含义：仅撤回、撤回并提示、撤回并禁言、撤回并踢出、撤回并拉黑。二维码检测会下载图片，超时和并发建议保守设置。</p>
    <div id="contentRiskForm" class="grid"></div>
    <button data-save-form="contentRiskForm">保存内容风险配置</button>
  </section>

  <section id="tab-ele" class="card hidden">
    <h2>ELE构建</h2>
    <div id="eleForm" class="grid"></div>
    <button data-save-form="eleForm">保存ELE构建配置</button>
    <p class="hint">API Base 留空时使用默认接口。群内命令示例：ELE下载 32位卡密。</p>
  </section>

  <section id="tab-advanced" class="card hidden">
    <h2>全量配置面板</h2>
    <p class="hint">这里保留全部配置能力，但前端只显示中文名称和中文说明。底层配置字段与保存结构保持不变。</p>
    <div class="row"><label><span>筛选字段</span><input id="advancedFilter" placeholder="例如：战绩、签到、自动撤回、内容风险"></label></div>
    <div id="advancedForm" class="grid"></div>
    <button data-save-form="advancedForm">保存全量配置面板</button>
  </section>

  <section id="tab-raw" class="card hidden">
    <h2>原始 config.json</h2>
    <textarea id="configEditor"></textarea>
    <div class="toolbar"><button id="saveRawBtn">保存 config.json</button><button class="secondary" id="reloadConfigBtn">重新加载</button></div>
  </section>

  <section id="tab-commands" class="card hidden">
    <h2>动态命令 commands.json</h2>
    <textarea id="commandsEditor"></textarea>
    <div class="toolbar"><button id="saveCommandsBtn">保存动态命令</button><button class="secondary" id="reloadCommandsBtn">重新加载</button></div>
  </section>

  <div class="footer">默认仅建议在本机或内网使用。若暴露公网，请设置强 token 并限制访问来源。</div>
</div>
<script>
(function(){
var token = '';
localStorage.removeItem('GROUPGUARD_WEBUI_TOKEN');
var config = {};
var currentGroup = null;
var statusLabels = {
  workDir:'工作目录', processCwd:'进程目录', configPath:'配置文件', dataDir:'数据目录', sqlitePath:'数据库',
  backupDir:'备份目录', dynamicCommandsPath:'动态命令配置', wsUrl:'WebSocket地址', botId:'机器人QQ',
  hostProfileId:'宿主能力配置', dynamicCommandsCount:'动态命令数量', feature:'功能开关快照', exists:'文件存在状态'
};
var actionOptions = [
  ['recall','仅撤回'],
  ['recall_warn','撤回并提示'],
  ['recall_ban','撤回并禁言'],
  ['recall_kick','撤回并踢出'],
  ['recall_blacklist','撤回并拉黑']
];
var selectOptionsByKey = {
  'global.silentMode': [['off','关闭'],['noPassiveReply','不被动回复'],['noBotSend','不由机器人发送']],
  'silentMode': [['off','关闭'],['noPassiveReply','不被动回复'],['noBotSend','不由机器人发送']],
  'global.lolQueryOutputFormat': [['forward','合并转发'],['text','文本'],['image','图片'],['card','卡片']],
  'lolQueryOutputFormat': [['forward','合并转发'],['text','文本'],['image','图片'],['card','卡片']],
  'shardQueryOutputFormat': [['image','图片'],['text','文本'],['forward','合并转发']],
  'global.banQueryResultMode': [['short','短文本'],['image','图片优先'],['text','完整文本']],
  'banQueryResultMode': [['short','短文本'],['image','图片优先'],['text','完整文本']],
  'global.queueMode': [['group','分群队列'],['global','全局队列']],
  'global.botAntiRiskSuffixMode': [['mixed','混合'],['punctuation','标点'],['none','关闭'],['global','跟随全局']],
  'global.botAntiRiskLimitFallbackMode': [['drop','丢弃'],['forward','合并转发']],
  'global.outgoingRisk.urlMode': [['off','关闭'],['number','编号化'],['mask','隐藏'],['drop','整条拦截']],
  'global.riskPresetLevel': [['conservative','保守'],['balanced','平衡'],['aggressive','激进']],
  'global.selfRecall.mode': [['fixed','固定延迟'],['random','随机延迟']],
  'selfRecall.mode': [['fixed','固定延迟'],['random','随机延迟']],
  'global.subGameplay.resourceMode': [['off','关闭'],['light','仅轻娱乐图片'],['all','全部资源可用']],
  'subGameplay.resourceMode': [['off','关闭'],['light','仅轻娱乐图片'],['all','全部资源可用']]
};
var configFieldPhraseZh = {
  enabled:'启用', disabled:'禁用', masterEnabled:'总开关', activeReplyEnabled:'主动回复开关', dynamicCommandEnabled:'动态命令开关', queryEnabled:'查询总开关', qaEnabled:'问答总开关',
  cooldownSeconds:'冷却秒数', cooldownMinutes:'冷却分钟数', cooldownMs:'冷却毫秒数', timeoutMs:'超时毫秒数', delayMinMs:'最小延迟毫秒数', delayMaxMs:'最大延迟毫秒数',
  minDelay:'最小延迟', maxDelay:'最大延迟', fixedDelay:'固定延迟', retryCount:'重试次数', retryDelayMs:'重试间隔毫秒数', messageLookupAttempts:'消息查找次数', messageLookupDelayMs:'消息查找间隔毫秒数',
  maxFileSizeMb:'最大文件大小（MB）', maxBytes:'最大字节数', maxPerMinute:'每分钟上限', maxQueueSize:'队列容量上限', maxQueueSizeGlobal:'全局队列容量上限', maxQueueSizePerGroup:'单群队列容量上限',
  sourceGroupId:'来源群号', targetGroupId:'接收群号', sourceUploaderIds:'上传者 QQ 列表', targetFolderId:'接收群文件夹', fileNamePattern:'文件名匹配规则',
  keepLatestOnly:'仅保留最新内容', deletePreviousTargetFile:'删除上一份接收群文件', recallPreviousTargetMessage:'撤回上一份接收群消息', syncSourceRecall:'同步来源群撤回',
  baseUrl:'接口根地址', apiBaseUrl:'接口根地址', primaryUrl:'主接口地址', queryUrl:'查询接口地址', queryUrls:'查询接口地址列表', dataUrl:'数据地址', imageUrl:'图片地址', imageUrlTemplate:'图片地址模板', heroListUrl:'英雄列表地址',
  authKey:'接口授权密钥', licenseKey:'授权密钥', accessToken:'访问令牌', commandPrefix:'命令前缀', commandAliases:'命令别名', textTemplates:'文本模板', noticeText:'提示文本', reason:'处理原因',
  outputFormat:'输出格式', resultMode:'结果模式', queueMode:'队列模式', resourceMode:'资源发送模式', suffixMode:'随机后缀模式', wrapperMode:'发送包装模式', urlMode:'网址处理模式', riskPresetLevel:'风险推荐档位',
  probability:'触发概率', replyProbability:'回复概率', successRate:'成功率', exchangeRate:'兑换比例', taxRate:'税率', concurrency:'并发数', threshold:'触发阈值', interval:'执行间隔',
  protectAdminActions:'保护管理员操作', protectOwnerActions:'保护群主操作', allowRecallAdminMessage:'允许处理管理员消息', allowRecallOwnerMessage:'允许处理群主消息', blacklistCheckBeforeCommand:'命令前黑名单检测',
  wrapInCodeBlock:'使用代码块包装', applyToPrivate:'应用于私聊', applyToForward:'应用于合并转发', logOnly:'仅记录不处理', notifyGroup:'在群内通知',
  urlAllowlist:'网址白名单', urlBlocklist:'网址黑名单', qrDetectTimeoutMs:'二维码检测超时毫秒数', qrDetectMaxBytes:'二维码检测最大字节数', qrDetectConcurrency:'二维码检测并发数', qrCacheSeconds:'二维码缓存秒数',
  groupInviteDetectUrl:'检测群邀请网址', groupInviteDetectCard:'检测群邀请卡片', groupInviteDetectForward:'检测群邀请合并转发',
  dailyWelfareGold:'每日福利黄金', initialGold:'初始黄金', initialRacingCoins:'初始赛车币', initialFuel:'初始汽油', maxFuel:'汽油上限', duelCostFuel:'对决消耗汽油', raceCostFuel:'比赛消耗汽油',
  carCoinExchangeRate:'赛车币兑换比例', fuelExchangeRate:'汽油兑换比例', pkCooldownSeconds:'对战冷却秒数', escapeSuccessRate:'逃跑成功率', snatchSuccessRate:'抢夺成功率', contractTaxRate:'契约税率', rankLimit:'排行显示数量'
};
var configFieldTokenZh = {
  global:'全局', group:'群', groups:'群', user:'用户', users:'用户', owner:'主人', owners:'主人', admin:'管理员', bot:'机器人', self:'自身', master:'总',
  enabled:'启用', disabled:'禁用', enable:'启用', disable:'禁用', active:'主动', silent:'静默', debug:'调试', use:'使用', default:'默认', custom:'自定义',
  qa:'问答', query:'查询', command:'命令', commands:'命令', dynamic:'动态', reply:'回复', message:'消息', messages:'消息', text:'文本', notice:'提示', welcome:'欢迎', verify:'验证', approve:'同意',
  feature:'功能', features:'功能', switch:'开关', switches:'开关', mode:'模式', format:'格式', output:'输出', result:'结果', level:'等级', preset:'推荐档位',
  lol:'英雄联盟', battle:'战绩', ban:'封号', hidden:'隐藏', shard:'合集', hero:'英雄', scammer:'骗子', peer:'同行', video:'视频', image:'图片', card:'卡片',
  url:'网址', urls:'网址列表', api:'接口', base:'根', primary:'主', auth:'授权', key:'密钥', token:'令牌', host:'主机', port:'端口', endpoint:'接口', callback:'回调',
  data:'数据', file:'文件', files:'文件', name:'名称', pattern:'匹配规则', folder:'文件夹', path:'路径', resource:'资源', resources:'资源', build:'构建',
  source:'来源', target:'接收', uploader:'上传者', latest:'最新', previous:'上一份', keep:'保留', delete:'删除', recall:'撤回', sync:'同步', lookup:'查找', history:'历史',
  max:'最大', min:'最小', size:'大小', bytes:'字节', mb:'兆字节', count:'数量', limit:'上限', threshold:'阈值', probability:'概率', rate:'比例', concurrency:'并发数',
  timeout:'超时', delay:'延迟', retry:'重试', attempts:'次数', interval:'间隔', seconds:'秒数', second:'秒', minutes:'分钟', minute:'分钟', hours:'小时', days:'天数', ms:'毫秒',
  queue:'队列', globalMax:'全局上限', fuse:'熔断', cooldown:'冷却', random:'随机', fixed:'固定', jitter:'额外抖动', auto:'自动', before:'前置', after:'后置',
  risk:'风险', content:'内容', outgoing:'发送内容', action:'处理动作', actions:'处理动作', protect:'保护', allow:'允许', apply:'应用', private:'私聊', forward:'合并转发', wrapper:'包装', suffix:'后缀', scene:'场景', policies:'策略',
  blacklist:'黑名单', whitelist:'白名单', allowlist:'白名单', blocklist:'黑名单', spam:'刷屏', repeat:'复读', invite:'邀请', contact:'名片', record:'语音', qr:'二维码', detect:'检测', cache:'缓存',
  signin:'签到', lottery:'抽奖', activity:'活跃', emoji:'表情', anti:'防护', report:'举报', join:'入群',
  sub:'娱乐玩法', gameplay:'玩法', light:'轻量', entertainment:'娱乐', racing:'赛车', servant:'仆从', contract:'契约', gold:'黄金', fuel:'汽油', coin:'币', exchange:'兑换', tax:'税率', rank:'排行', template:'模板', aliases:'别名', initial:'初始', daily:'每日', welfare:'福利', cost:'消耗', duel:'对决', race:'比赛', escape:'逃跑', snatch:'抢夺', success:'成功',
  normal:'普通', off:'关闭', on:'开启', none:'无', mixed:'混合', punctuation:'标点', low:'低', medium:'中', high:'高', strict:'严格', autoApprove:'自动同意'
};
function splitConfigFieldWords(name){
  return String(name||'')
    .replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
    .replace(/[_.\-]+/g,' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}
function translateConfigFieldName(name){
  var raw=String(name||'').trim();
  if(!raw) return '其他设置';
  if(configFieldPhraseZh[raw]) return configFieldPhraseZh[raw];
  var words=splitConfigFieldWords(raw);
  var translated=words.map(function(word){
    var lower=word.toLowerCase();
    return configFieldTokenZh[lower] || configFieldPhraseZh[word] || '参数';
  }).join('');
  translated=translated.replace(/参数参数+/g,'其他参数');
  return translated || '其他设置';
}

var fieldMeta = {
  licenseKey:['授权密钥','专业版/企业版授权密钥。','基础'],
  ownerQQs:['主人QQ号','拥有最高权限的 QQ，多个用逗号分隔。','基础'],
  debug:['调试模式','开启后输出更详细日志。','基础'],
  'global.masterEnabled':['插件总开关','关闭后本插件主要功能停止响应。','基础总控'],
  'global.silentMode':['静默模式','控制被动回复或机器人发送是否静默。','基础总控'],
  'global.activeReplyEnabled':['主动发送','关闭后需要机器人发送的回复会被拦截。','基础总控'],
  'global.queryEnabled':['查询总开关','控制查战绩、查封号、查骗子等查询类功能。','查询功能'],
  'global.qaEnabled':['问答总开关','控制问答自动回复功能。','问答功能'],
  'global.dynamicCommandEnabled':['动态命令','控制 commands.json 动态命令。','基础总控'],
  'global.disableQA':['问答功能','开启表示允许问答；保存时写入 disableQA=false。','问答功能'],
  'global.disableLolQuery':['LOL查询功能','开启表示允许旧 LOL 查询链路；保存时写入 disableLolQuery=false。','查询功能'],
  'global.disableSignin':['签到功能','开启表示允许群员签到；保存时写入 disableSignin=false。','娱乐统计'],
  'global.disableLottery':['抽奖功能','开启表示允许积分抽奖；保存时写入 disableLottery=false。','娱乐统计'],
  'global.disableInvite':['邀请统计','开启表示记录和查询邀请统计；保存时写入 disableInvite=false。','娱乐统计'],
  'global.disableActivity':['活跃统计','开启表示记录群员活跃度；保存时写入 disableActivity=false。','娱乐统计'],
  'global.enableVerify':['入群验证','控制入群验证答案处理。','群管安全'],
  'global.autoApprove':['自动同意入群','控制入群申请是否自动同意。','群管安全'],
  'global.disableWelcome':['入群欢迎','开启表示发送入群欢迎；保存时写入 disableWelcome=false。','群管安全'],
  'global.joinPrivateEnabled':['入群后私聊欢迎','新成员入群后私聊发送欢迎/提示。','群管安全'],
  'global.spamDetect':['刷屏检测','控制同一用户短时间高频发言检测。','群管安全'],
  'global.repeatThreshold':['复读检测阈值','连续重复消息达到该次数后触发处理，0 表示关闭。','群管安全'],
  'global.blacklistCheckBeforeCommand':['黑名单前置检测','开启后先处理黑名单，再处理命令。','群管安全'],
  'global.protectAdminActions':['保护管理员','开启后自动处罚尽量不作用于管理员。','群管安全'],
  'global.protectOwnerActions':['保护群主','开启后自动处罚尽量不作用于群主。','群管安全'],
  'global.allowRecallAdminMessage':['允许处理管理员消息','高风险项。开启后允许自动撤回/处理管理员消息。','高风险项'],
  'global.allowRecallOwnerMessage':['允许处理群主消息','高风险项。开启后允许自动撤回/处理群主消息。','高风险项'],
  globalAntiRecall:['防撤回通知','开启所有群的防撤回聚合通知。','娱乐统计'],
  globalEmojiReact:['自动回应表情','开启所有群的自动表情回应。','娱乐统计'],
  'global.featureSwitches.query.lol_ban':['查封号','控制查封号查询入口。','查询功能'],
  'global.featureSwitches.query.lol_battle':['查战绩','控制查战绩查询入口。','查询功能'],
  'global.featureSwitches.query.lol_shard':['查合集','控制查合集查询入口。','查询功能'],
  'global.featureSwitches.query.scammer':['查骗子','控制骗子查询入口。','查询功能'],
  'global.featureSwitches.query.peer':['查同行','控制同行查询入口。','查询功能'],
  'global.lolQueryCommandSwitch.battleQuery':['查战绩旧指令开关','旧 LOL 查询指令级开关。','查询功能'],
  'global.lolQueryCommandSwitch.banQuery':['查封号旧指令开关','旧 LOL 查询指令级开关。','查询功能'],
  'global.replyProbability':['回复概率','机器人回复触发概率，0-100。','发送与风控'],
  'global.randomDelayMin':['最小随机延迟','机器人发送前的最小随机延迟毫秒。','发送与风控'],
  'global.randomDelayMax':['最大随机延迟','机器人发送前的最大随机延迟毫秒。','发送与风控'],
  'global.lolQueryOutputFormat':['战绩输出格式','查战绩默认输出格式。','查询功能'],
  shardQueryOutputFormat:['查合集输出格式','查合集默认输出格式。','查询功能'],
  lolApiBaseUrl:['英雄联盟接口根地址','本地英雄联盟查询服务的根地址。','接口地址'],
  lolQueryUrl:['自定义战绩查询地址','旧版自定义战绩查询接口地址。','接口地址'],
  lolAuthKey:['战绩接口授权密钥','旧版自定义战绩接口的授权密钥。','接口地址'],
  lolBanPrimaryUrl:['查封号主接口地址','查封号功能优先使用的查询接口。','接口地址'],
  eleBuildApiBaseUrl:['构建工具接口根地址','构建和下载功能使用的接口根地址。','接口地址'],
  shardDataUrl:['合集数据地址','英雄合集数据文件地址。','接口地址'],
  shardHeroListUrl:['英雄列表地址','英雄联盟英雄列表数据地址。','接口地址'],
  shardImageUrlTemplate:['合集图片地址模板','查合集图片输出接口的地址模板。','接口地址'],
  scammerReportUrl:['骗子举报接口','骗子举报提交接口。','接口地址'],
  scammerQueryUrls:['骗子查询接口列表','骗子查询使用的接口地址列表。','接口地址']
};
var invertBooleanKeys = {
  'global.disableQA': true,
  'global.disableLolQuery': true,
  'global.disableSignin': true,
  'global.disableLottery': true,
  'global.disableInvite': true,
  'global.disableActivity': true,
  'global.disableWelcome': true,
  disableQA: true,
  disableLolQuery: true,
  disableSignin: true,
  disableLottery: true,
  disableInvite: true,
  disableActivity: true,
  disableWelcome: true
};
function el(id){ return document.getElementById(id); }
function show(msg, ok){ var n=el('notice'); n.className='card ' + (ok === false ? 'error' : 'ok'); n.textContent=String(msg || ''); }
window.addEventListener('error', function(e){ show('页面脚本错误：' + e.message + ' @' + e.lineno + ':' + e.colno, false); });
window.addEventListener('unhandledrejection', function(e){ var r=e.reason; show('页面请求错误：' + (r && r.message ? r.message : r), false); });
function api(path, options){
  options = options || {};
  return fetch(path, {
    method: options.method || 'GET',
    body: options.body,
    headers: Object.assign({ 'content-type': 'application/json', 'x-groupguard-token': token }, options.headers || {})
  }).then(function(r){
    return r.text().then(function(text){
      var data;
      try{ data=JSON.parse(text); }catch(e){ data={ ok:false, error:text }; }
      if(!r.ok) throw new Error(data.error || text || r.statusText);
      return data;
    });
  });
}
function get(obj, p, fallback){
  if(!obj) return fallback;
  if(p.indexOf('featureSwitches.query.')===0){
    var k='query.'+p.slice('featureSwitches.query.'.length);
    return obj.featureSwitches && obj.featureSwitches[k] !== undefined ? obj.featureSwitches[k] : fallback;
  }
  if(p.indexOf('global.featureSwitches.query.')===0){
    var k2='query.'+p.slice('global.featureSwitches.query.'.length);
    return obj.global && obj.global.featureSwitches && obj.global.featureSwitches[k2] !== undefined ? obj.global.featureSwitches[k2] : fallback;
  }
  var cur=obj; var parts=p.split('.');
  for(var i=0;i<parts.length;i++){ if(!cur || cur[parts[i]]===undefined) return fallback; cur=cur[parts[i]]; }
  return cur;
}
function esc(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function metaForKey(key){
  if(fieldMeta[key]) return fieldMeta[key];
  var parts=String(key).split('.');
  var last=parts[parts.length-1] || key;
  var group='其他';
  if(key.indexOf('contentRisk')>=0) group='内容风险';
  else if(key.indexOf('subGameplay')>=0) group='娱乐玩法';
  else if(key.indexOf('qa')>=0 || key.indexOf('QA')>=0) group='问答功能';
  else if(key.indexOf('lol')>=0 || key.indexOf('Query')>=0 || key.indexOf('query')>=0 || key.indexOf('scammer')>=0 || key.indexOf('shard')>=0) group='查询功能';
  else if(key.indexOf('selfRecall')>=0 || key.indexOf('Recall')>=0 || key.indexOf('risk')>=0 || key.indexOf('Risk')>=0 || key.indexOf('queue')>=0 || key.indexOf('Queue')>=0) group='发送与风控';
  else if(key.indexOf('license')>=0 || key.indexOf('owner')>=0) group='基础';
  return [translateConfigFieldName(last), '', group];
}
function labelHtml(title,key,desc){
  return '<span class="field-title">'+esc(title)+'</span><span class="field-path">'+esc(key)+'</span>'+(desc?'<span class="field-desc">'+esc(desc)+'</span>':'');
}
function inputHtml(label,key,value,type,extra){
  var title=label, desc='';
  if(extra && extra.meta){ title=extra.meta[0]; desc=extra.meta[1]||''; }
  return '<label '+(extra&&extra.full?'class="full"':'')+'><span>'+labelHtml(title,key,desc)+'</span><input data-config-key="'+esc(key)+'" type="'+(type||'text')+'" value="'+esc(value)+'"></label>';
}
function textareaHtml(label,key,value,extra){
  var title=label, desc='';
  if(extra && extra.meta){ title=extra.meta[0]; desc=extra.meta[1]||''; }
  return '<label class="full"><span>'+labelHtml(title,key,desc)+'</span><textarea data-config-key="'+esc(key)+'">'+esc(JSON.stringify(value == null ? null : value,null,2))+'</textarea></label>';
}
function selectHtml(label,key,value,opts,extra){
  var title=label, desc='';
  if(extra && extra.meta){ title=extra.meta[0]; desc=extra.meta[1]||''; }
  var s='<label><span>'+labelHtml(title,key,desc)+'</span><select data-config-key="'+esc(key)+'">';
  opts.forEach(function(o){ var valueText=Array.isArray(o)?o[0]:o; var labelText=Array.isArray(o)?o[1]:o; s+='<option value="'+esc(valueText)+'" '+(String(value)===String(valueText)?'selected':'')+'>'+esc(labelText)+'</option>'; });
  return s+'</select></label>';
}
function switchHtml(label,key,value,extra){
  var title=label, desc='', invert=false;
  if(extra && extra.meta){ title=extra.meta[0]; desc=extra.meta[1]||''; }
  if(extra && extra.invert) invert=true;
  var checked=invert ? !value : !!value;
  return '<label class="switch-row"><span class="switch-copy"><span class="switch-title">'+esc(title)+'</span><span class="switch-path">'+esc(key)+(invert?'（界面已转成正向开关）':'')+'</span>'+(desc?'<span class="field-desc">'+esc(desc)+'</span>':'')+'</span><input data-config-key="'+esc(key)+'" '+(invert?'data-invert="true" ':'')+'type="checkbox" '+(checked?'checked':'')+'></label>';
}
function positiveSwitchHtml(label,key,disabledValue,desc){ return switchHtml(label,key,!!disabledValue,{invert:true,meta:[label,desc||'']}); }
function riskActionHtml(label,key,value){ return selectHtml(label,key,value||'recall',actionOptions); }
function numberHtml(label,key,value,extra){ return inputHtml(label,key,value,'number',extra); }
function jsonInputHtml(label,key,value){ return textareaHtml(label,key,value || []); }
function sectionTitle(text){ return '<div class="section-title">'+text+'</div>'; }
function selfRecallForm(prefix, src){
  return sectionTitle('自撤回')
    + switchHtml('启用自撤回',prefix+'selfRecall.enabled',get(src,'selfRecall.enabled',get(src,'autoRecallSelf',false)),{meta:['启用自撤回','机器人自己发出的消息按策略自动撤回。']})
    + numberHtml('自撤回几率',prefix+'selfRecall.probability',get(src,'selfRecall.probability',get(src,'autoRecallSelfProbability',100)),{meta:['自撤回几率','0-100。']})
    + selectHtml('延迟模式',prefix+'selfRecall.mode',get(src,'selfRecall.mode','fixed'),[['fixed','固定延迟'],['random','随机延迟']],{meta:['延迟模式','固定或随机延迟。']})
    + numberHtml('固定延迟秒',prefix+'selfRecall.fixedDelay',get(src,'selfRecall.fixedDelay',get(src,'autoRecallSelfDelay',60)))
    + numberHtml('随机最小延迟秒',prefix+'selfRecall.minDelay',get(src,'selfRecall.minDelay',45))
    + numberHtml('随机最大延迟秒',prefix+'selfRecall.maxDelay',get(src,'selfRecall.maxDelay',90))
    + numberHtml('额外抖动秒',prefix+'selfRecall.jitter',get(src,'selfRecall.jitter',0));
}
function subGameplayForm(prefix, src){
  var resourceModeHtml = selectHtml('资源发送模式',prefix+'subGameplay.resourceMode',get(src,'subGameplay.resourceMode','off'),[['off','关闭'],['light','仅轻娱乐图片'],['all','全部资源可用']]);
  return switchHtml('SUB总开关',prefix+'subGameplay.enabled',get(src,'subGameplay.enabled',false))
    + switchHtml('主仆契约',prefix+'subGameplay.masterServantEnabled',get(src,'subGameplay.masterServantEnabled',true))
    + switchHtml('竞速赛车',prefix+'subGameplay.racingEnabled',get(src,'subGameplay.racingEnabled',true))
    + switchHtml('轻娱乐',prefix+'subGameplay.lightEntertainmentEnabled',get(src,'subGameplay.lightEntertainmentEnabled',true))
    + resourceModeHtml
    + inputHtml('命令前缀',prefix+'subGameplay.commandPrefix',get(src,'subGameplay.commandPrefix',''))
    + numberHtml('每日福利黄金',prefix+'subGameplay.dailyWelfareGold',get(src,'subGameplay.dailyWelfareGold',1000))
    + numberHtml('初始黄金',prefix+'subGameplay.initialGold',get(src,'subGameplay.initialGold',500))
    + numberHtml('初始车币',prefix+'subGameplay.initialRacingCoins',get(src,'subGameplay.initialRacingCoins',0))
    + numberHtml('初始汽油',prefix+'subGameplay.initialFuel',get(src,'subGameplay.initialFuel',100))
    + numberHtml('汽油上限',prefix+'subGameplay.maxFuel',get(src,'subGameplay.maxFuel',100))
    + numberHtml('对决耗油',prefix+'subGameplay.duelCostFuel',get(src,'subGameplay.duelCostFuel',10))
    + numberHtml('参赛耗油',prefix+'subGameplay.raceCostFuel',get(src,'subGameplay.raceCostFuel',15))
    + numberHtml('车币兑换率',prefix+'subGameplay.carCoinExchangeRate',get(src,'subGameplay.carCoinExchangeRate',10))
    + numberHtml('汽油兑换率',prefix+'subGameplay.fuelExchangeRate',get(src,'subGameplay.fuelExchangeRate',5))
    + numberHtml('PK冷却秒',prefix+'subGameplay.pkCooldownSeconds',get(src,'subGameplay.pkCooldownSeconds',30))
    + numberHtml('逃跑成功率',prefix+'subGameplay.escapeSuccessRate',get(src,'subGameplay.escapeSuccessRate',18))
    + numberHtml('抢走成功率',prefix+'subGameplay.snatchSuccessRate',get(src,'subGameplay.snatchSuccessRate',45))
    + numberHtml('契约税率',prefix+'subGameplay.contractTaxRate',get(src,'subGameplay.contractTaxRate',10))
    + numberHtml('排行条数',prefix+'subGameplay.rankLimit',get(src,'subGameplay.rankLimit',10))
    + jsonInputHtml('文本模板',prefix+'subGameplay.textTemplates',get(src,'subGameplay.textTemplates',{}))
    + jsonInputHtml('命令别名',prefix+'subGameplay.commandAliases',get(src,'subGameplay.commandAliases',{}));
}
function contentRiskForm(prefix, src){
  var p=prefix+'contentRisk.';
  var html=switchHtml('内容风险总开关',p+'enabled',get(src,'contentRisk.enabled',false))
    + switchHtml('仅记录不处理',p+'logOnly',get(src,'contentRisk.logOnly',false))
    + switchHtml('群内通知',p+'notifyGroup',get(src,'contentRisk.notifyGroup',false));
  [
    ['url','链接'],['qr','二维码'],['lightApp','小程序卡片'],['forward','合并转发'],['contact','名片分享'],
    ['groupInvite','群邀请'],['image','图片'],['video','视频'],['record','语音']
  ].forEach(function(item){
    var t=item[0], name=item[1];
    html += sectionTitle(name)
      + switchHtml('拦截 '+name,p+'rules.'+t+'.enabled',get(src,'contentRisk.rules.'+t+'.enabled',false))
      + riskActionHtml(name+'处理动作',p+'rules.'+t+'.action',get(src,'contentRisk.rules.'+t+'.action','recall'))
      + numberHtml(name+'禁言分钟',p+'rules.'+t+'.banMinutes',get(src,'contentRisk.rules.'+t+'.banMinutes',10))
      + inputHtml(name+'原因',p+'rules.'+t+'.reason',get(src,'contentRisk.rules.'+t+'.reason',''));
  });
  html += sectionTitle('名单和二维码检测')
    + jsonInputHtml('URL白名单',p+'urlAllowlist',get(src,'contentRisk.urlAllowlist',[]))
    + jsonInputHtml('URL黑名单',p+'urlBlocklist',get(src,'contentRisk.urlBlocklist',[]))
    + numberHtml('二维码检测超时毫秒',p+'qrDetectTimeoutMs',get(src,'contentRisk.qrDetectTimeoutMs',3000))
    + numberHtml('二维码最大字节',p+'qrDetectMaxBytes',get(src,'contentRisk.qrDetectMaxBytes',5242880))
    + numberHtml('二维码检测并发',p+'qrDetectConcurrency',get(src,'contentRisk.qrDetectConcurrency',2))
    + numberHtml('二维码缓存秒',p+'qrCacheSeconds',get(src,'contentRisk.qrCacheSeconds',300))
    + switchHtml('群邀请URL检测',p+'groupInviteDetectUrl',get(src,'contentRisk.groupInviteDetectUrl',true))
    + switchHtml('群邀请卡片检测',p+'groupInviteDetectCard',get(src,'contentRisk.groupInviteDetectCard',true))
    + switchHtml('群邀请合并转发检测',p+'groupInviteDetectForward',get(src,'contentRisk.groupInviteDetectForward',true));
  return html;
}
function mergedGroupSettings(e,g){
  var out=Object.assign({}, e||{}, g||{});
  out.featureSwitches=Object.assign({}, get(e,'featureSwitches',{}), get(g,'featureSwitches',{}));
  out.selfRecall=Object.assign({}, get(e,'selfRecall',{}), get(g,'selfRecall',{}));
  out.qaLinkDelivery=Object.assign({}, get(e,'qaLinkDelivery',{}), get(g,'qaLinkDelivery',{}));
  out.subGameplay=Object.assign({}, get(e,'subGameplay',{}), get(g,'subGameplay',{}));
  out.contentRisk=Object.assign({}, get(e,'contentRisk',{}), get(g,'contentRisk',{}));
  out.contentRisk.rules=Object.assign({}, get(e,'contentRisk.rules',{}), get(g,'contentRisk.rules',{}));
  return out;
}
function fieldValue(input){
  if(input.type==='checkbox') return input.dataset.invert === 'true' ? !input.checked : input.checked;
  var v=input.value.trim();
  if(v==='true') return true;
  if(v==='false') return false;
  if(v==='null') return null;
  if(/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if((v.startsWith('[')&&v.endsWith(']'))||(v.startsWith('{')&&v.endsWith('}'))) return JSON.parse(v);
  return input.value;
}
function collectPatch(formId){
  var patch={};
  document.querySelectorAll('#'+formId+' [data-config-key]').forEach(function(i){ patch[i.dataset.configKey]=fieldValue(i); });
  return patch;
}
function renderStatus(status){
  var box=el('statusBox'); box.innerHTML='';
  Object.keys(status).forEach(function(k){
    var a=document.createElement('div'); a.className='k'; a.textContent=statusLabels[k] || k;
    var b=document.createElement('div'); b.className='v'; b.textContent=typeof status[k]==='object'?JSON.stringify(status[k]):String(status[k]);
    box.appendChild(a); box.appendChild(b);
  });
}
function renderForms(){
  el('switchForm').innerHTML =
    sectionTitle('基础总控')
    + switchHtml('插件总开关','global.masterEnabled',get(config,'global.masterEnabled',true),{meta:fieldMeta['global.masterEnabled']})
    + selectHtml('静默模式','global.silentMode',get(config,'global.silentMode','off'),selectOptionsByKey['global.silentMode'],{meta:fieldMeta['global.silentMode']})
    + switchHtml('主动发送','global.activeReplyEnabled',get(config,'global.activeReplyEnabled',true),{meta:fieldMeta['global.activeReplyEnabled']})
    + switchHtml('查询总开关','global.queryEnabled',get(config,'global.queryEnabled',true),{meta:fieldMeta['global.queryEnabled']})
    + switchHtml('问答总开关','global.qaEnabled',get(config,'global.qaEnabled',true),{meta:fieldMeta['global.qaEnabled']})
    + switchHtml('动态命令','global.dynamicCommandEnabled',get(config,'global.dynamicCommandEnabled',true),{meta:fieldMeta['global.dynamicCommandEnabled']})
    + sectionTitle('群管安全')
    + switchHtml('入群验证','global.enableVerify',get(config,'global.enableVerify',true),{meta:fieldMeta['global.enableVerify']})
    + switchHtml('自动同意入群','global.autoApprove',get(config,'global.autoApprove',true),{meta:fieldMeta['global.autoApprove']})
    + positiveSwitchHtml('入群欢迎','global.disableWelcome',get(config,'global.disableWelcome',false),'开启表示允许发送入群欢迎；保存时写入 disableWelcome=false。')
    + switchHtml('入群后私聊欢迎','global.joinPrivateEnabled',get(config,'global.joinPrivateEnabled',false),{meta:fieldMeta['global.joinPrivateEnabled']})
    + switchHtml('刷屏检测','global.spamDetect',get(config,'global.spamDetect',false),{meta:fieldMeta['global.spamDetect']})
    + numberHtml('复读检测阈值','global.repeatThreshold',get(config,'global.repeatThreshold',0),{meta:fieldMeta['global.repeatThreshold']})
    + switchHtml('黑名单前置检测','global.blacklistCheckBeforeCommand',get(config,'global.blacklistCheckBeforeCommand',true),{meta:fieldMeta['global.blacklistCheckBeforeCommand']})
    + switchHtml('保护管理员','global.protectAdminActions',get(config,'global.protectAdminActions',true),{meta:fieldMeta['global.protectAdminActions']})
    + switchHtml('保护群主','global.protectOwnerActions',get(config,'global.protectOwnerActions',true),{meta:fieldMeta['global.protectOwnerActions']})
    + sectionTitle('查询功能')
    + positiveSwitchHtml('LOL查询功能','global.disableLolQuery',get(config,'global.disableLolQuery',false),'开启表示允许旧 LOL 查询链路；保存时写入 disableLolQuery=false。')
    + switchHtml('查封号','global.featureSwitches.query.lol_ban',get(config,'global.featureSwitches.query.lol_ban',true),{meta:fieldMeta['global.featureSwitches.query.lol_ban']})
    + switchHtml('查战绩','global.featureSwitches.query.lol_battle',get(config,'global.featureSwitches.query.lol_battle',true),{meta:fieldMeta['global.featureSwitches.query.lol_battle']})
    + switchHtml('查合集','global.featureSwitches.query.lol_shard',get(config,'global.featureSwitches.query.lol_shard',true),{meta:fieldMeta['global.featureSwitches.query.lol_shard']})
    + switchHtml('查骗子','global.featureSwitches.query.scammer',get(config,'global.featureSwitches.query.scammer',true),{meta:fieldMeta['global.featureSwitches.query.scammer']})
    + switchHtml('查同行','global.featureSwitches.query.peer',get(config,'global.featureSwitches.query.peer',true),{meta:fieldMeta['global.featureSwitches.query.peer']})
    + switchHtml('查战绩旧指令','global.lolQueryCommandSwitch.battleQuery',get(config,'global.lolQueryCommandSwitch.battleQuery',true),{meta:fieldMeta['global.lolQueryCommandSwitch.battleQuery']})
    + switchHtml('查封号旧指令','global.lolQueryCommandSwitch.banQuery',get(config,'global.lolQueryCommandSwitch.banQuery',true),{meta:fieldMeta['global.lolQueryCommandSwitch.banQuery']})
    + sectionTitle('问答功能')
    + positiveSwitchHtml('问答功能','global.disableQA',get(config,'global.disableQA',false),'开启表示允许问答；保存时写入 disableQA=false。')
    + sectionTitle('娱乐统计')
    + positiveSwitchHtml('签到功能','global.disableSignin',get(config,'global.disableSignin',false),'开启表示允许签到；保存时写入 disableSignin=false。')
    + positiveSwitchHtml('抽奖功能','global.disableLottery',get(config,'global.disableLottery',false),'开启表示允许抽奖；保存时写入 disableLottery=false。')
    + positiveSwitchHtml('邀请统计','global.disableInvite',get(config,'global.disableInvite',false),'开启表示允许邀请统计；保存时写入 disableInvite=false。')
    + positiveSwitchHtml('活跃统计','global.disableActivity',get(config,'global.disableActivity',false),'开启表示允许活跃统计；保存时写入 disableActivity=false。')
    + switchHtml('防撤回通知','globalAntiRecall',get(config,'globalAntiRecall',false),{meta:fieldMeta.globalAntiRecall})
    + switchHtml('自动回应表情','globalEmojiReact',get(config,'globalEmojiReact',false),{meta:fieldMeta.globalEmojiReact})
    + sectionTitle('高风险项')
    + switchHtml('允许处理管理员消息','global.allowRecallAdminMessage',get(config,'global.allowRecallAdminMessage',false),{meta:fieldMeta['global.allowRecallAdminMessage']})
    + switchHtml('允许处理群主消息','global.allowRecallOwnerMessage',get(config,'global.allowRecallOwnerMessage',false),{meta:fieldMeta['global.allowRecallOwnerMessage']});
  el('sendForm').innerHTML =
    sectionTitle('回复控制')
    + numberHtml('回复消息几率','global.replyProbability',get(config,'global.replyProbability',100),{meta:fieldMeta['global.replyProbability']})
    + sectionTitle('问答冷却')
    + numberHtml('问答关键词冷却秒','global.qaCooldownSeconds',get(config,'global.qaCooldownSeconds',30))
    + numberHtml('同用户问答冷却秒','global.qaUserCooldownSeconds',get(config,'global.qaUserCooldownSeconds',12))
    + numberHtml('低风险问答冷却秒','global.qaTierCooldownLow',get(config,'global.qaTierCooldownLow',15))
    + numberHtml('中风险问答冷却秒','global.qaTierCooldownMedium',get(config,'global.qaTierCooldownMedium',30))
    + numberHtml('高风险问答冷却秒','global.qaTierCooldownHigh',get(config,'global.qaTierCooldownHigh',60))
    + numberHtml('最小随机延迟 ms','global.randomDelayMin',get(config,'global.randomDelayMin',500),{meta:fieldMeta['global.randomDelayMin']})
    + numberHtml('最大随机延迟 ms','global.randomDelayMax',get(config,'global.randomDelayMax',1500),{meta:fieldMeta['global.randomDelayMax']})
    + selectHtml('随机后缀模式','global.botAntiRiskSuffixMode',get(config,'global.botAntiRiskSuffixMode','mixed'),selectOptionsByKey['global.botAntiRiskSuffixMode'])
    + jsonInputHtml('场景策略','global.botAntiRiskScenePolicies',get(config,'global.botAntiRiskScenePolicies',{}))
    + sectionTitle('问答链接二段发送')
    + switchHtml('启用问答链接先提示','global.qaLinkDelivery.enabled',get(config,'global.qaLinkDelivery.enabled',false))
    + inputHtml('提示文本','global.qaLinkDelivery.noticeText',get(config,'global.qaLinkDelivery.noticeText','已找到资源，稍后发送链接。请不要连续重复触发。'), 'text', {full:true})
    + numberHtml('链接最小延迟 ms','global.qaLinkDelivery.delayMinMs',get(config,'global.qaLinkDelivery.delayMinMs',1000))
    + numberHtml('链接最大延迟 ms','global.qaLinkDelivery.delayMaxMs',get(config,'global.qaLinkDelivery.delayMaxMs',3000))
    + switchHtml('第二条用代码块包裹','global.qaLinkDelivery.wrapInCodeBlock',get(config,'global.qaLinkDelivery.wrapInCodeBlock',false))
    + sectionTitle('发送包装')
    + switchHtml('发送包装总开关','global.botSendWrapperEnabled',get(config,'global.botSendWrapperEnabled',false))
    + selectHtml('包装模式','global.botSendWrapperMode',get(config,'global.botSendWrapperMode','normal'),[['normal','普通发送'],['forward','合并转发']])
    + switchHtml('问答包装','global.botSendWrapperQaEnabled',get(config,'global.botSendWrapperQaEnabled',false))
    + switchHtml('查询包装','global.botSendWrapperQueryEnabled',get(config,'global.botSendWrapperQueryEnabled',false))
    + switchHtml('全局包装','global.botSendWrapperAllEnabled',get(config,'global.botSendWrapperAllEnabled',false))
    + sectionTitle('自身 URL 包装')
    + switchHtml('启用自身 URL 包装','global.outgoingRisk.enabled',get(config,'global.outgoingRisk.enabled',false))
    + selectHtml('URL处理模式','global.outgoingRisk.urlMode',get(config,'global.outgoingRisk.urlMode','number'),selectOptionsByKey['global.outgoingRisk.urlMode'])
    + inputHtml('URL包装提示','global.outgoingRisk.urlNotice',get(config,'global.outgoingRisk.urlNotice','链接已做编号化处理，原始地址不由机器人直接发送。'), 'text', {full:true})
    + numberHtml('单条最多编号数','global.outgoingRisk.urlMaxPerMessage',get(config,'global.outgoingRisk.urlMaxPerMessage',20))
    + switchHtml('私聊也包装','global.outgoingRisk.applyToPrivate',get(config,'global.outgoingRisk.applyToPrivate',true))
    + switchHtml('合并转发也包装','global.outgoingRisk.applyToForward',get(config,'global.outgoingRisk.applyToForward',true))
    + jsonInputHtml('高风险场景','global.outgoingRisk.highRiskScenes',get(config,'global.outgoingRisk.highRiskScenes',['qa','qa_reply','query','external_query','video_query','raw_text']))
    + switchHtml('仅记录不处理','global.outgoingRisk.logOnly',get(config,'global.outgoingRisk.logOnly',false))
    + sectionTitle('查封号结果策略')
    + selectHtml('查封号结果模式','global.banQueryResultMode',get(config,'global.banQueryResultMode','short'),selectOptionsByKey['global.banQueryResultMode'])
    + selfRecallForm('global.', config.global || {})
    + sectionTitle('队列和限流')
    + selectHtml('发送队列模式','global.queueMode',get(config,'global.queueMode','group'),selectOptionsByKey['global.queueMode'])
    + numberHtml('发送并发','global.queueConcurrency',get(config,'global.queueConcurrency',1))
    + numberHtml('全局每分钟上限','global.globalMaxPerMinute',get(config,'global.globalMaxPerMinute',60))
    + switchHtml('超限后排队','global.rateLimitEnqueue',get(config,'global.rateLimitEnqueue',true))
    + numberHtml('全局队列上限','global.maxQueueSizeGlobal',get(config,'global.maxQueueSizeGlobal',3000))
    + numberHtml('单群队列上限','global.maxQueueSizePerGroup',get(config,'global.maxQueueSizePerGroup',120))
    + numberHtml('群熔断窗口秒','global.groupFuseWindowSeconds',get(config,'global.groupFuseWindowSeconds',60))
    + numberHtml('群熔断阈值','global.groupFuseThreshold',get(config,'global.groupFuseThreshold',45))
    + numberHtml('群熔断冷却秒','global.groupFuseCooldownSeconds',get(config,'global.groupFuseCooldownSeconds',90))
    + sectionTitle('动作队列')
    + numberHtml('每分钟撤回上限','global.maxRecallPerMinute',get(config,'global.maxRecallPerMinute',60))
    + numberHtml('每分钟禁言上限','global.maxBanPerMinute',get(config,'global.maxBanPerMinute',5))
    + numberHtml('每分钟踢出上限','global.maxKickPerMinute',get(config,'global.maxKickPerMinute',3))
    + numberHtml('撤回去重秒','global.recallDedupSeconds',get(config,'global.recallDedupSeconds',20));
  el('gameplayForm').innerHTML = subGameplayForm('global.', config.global || {});
  el('contentRiskForm').innerHTML = contentRiskForm('global.', config.global || {});
  el('eleForm').innerHTML = inputHtml('ELE API Base URL','eleBuildApiBaseUrl',get(config,'eleBuildApiBaseUrl',''), 'text', {meta:fieldMeta.eleBuildApiBaseUrl});
  renderAdvancedForm();
}
function flattenConfig(obj, prefix, out){
  out = out || [];
  if(obj === null || typeof obj !== 'object' || Array.isArray(obj)){
    out.push({ key: prefix, value: obj });
    return out;
  }
  var keys = Object.keys(obj);
  if(!keys.length){ out.push({ key: prefix, value: obj }); return out; }
  keys.sort().forEach(function(k){ flattenConfig(obj[k], prefix ? prefix+'.'+k : k, out); });
  return out;
}
function advancedFieldHtml(row){
  var key=row.key, v=row.value, meta=metaForKey(key), title=meta[0], desc=meta[1];
  var opts=selectOptionsByKey[key];
  if(typeof v === 'boolean') return switchHtml(title,key,v,{meta:meta,invert:!!invertBooleanKeys[key]});
  if(opts) return selectHtml(title,key,v,opts,{meta:meta});
  if(typeof v === 'number') return numberHtml(title,key,v,{meta:meta});
  if(v === null || Array.isArray(v) || typeof v === 'object') return textareaHtml(title,key,v,{meta:meta});
  return inputHtml(title,key,v,'text',{meta:meta});
}
function renderAdvancedForm(){
  var box=el('advancedForm');
  if(!box) return;
  var filter=(el('advancedFilter') && el('advancedFilter').value || '').trim().toLowerCase();
  var rows=flattenConfig(config,'').map(function(row){
    var meta=metaForKey(row.key);
    row.title=meta[0]; row.desc=meta[1]; row.group=meta[2] || '其他';
    row.search=[row.key,row.title,row.desc,row.group].join(' ').toLowerCase();
    return row;
  }).filter(function(row){ return !filter || row.search.indexOf(filter)>=0; });
  var groups={}, order=['基础','基础总控','群管安全','查询功能','问答功能','娱乐统计','高风险项','发送与风控','内容风险','娱乐玩法','接口地址','其他'];
  rows.forEach(function(row){ if(!row.key) return; (groups[row.group]=groups[row.group]||[]).push(row); });
  var html='';
  order.forEach(function(group){
    if(!groups[group] || !groups[group].length) return;
    html += sectionTitle(group);
    groups[group].forEach(function(row){ html += advancedFieldHtml(row); });
  });
  box.innerHTML = html || '<p class="hint">没有匹配的字段。</p>';
}
function renderGroupList(groups){
  var sel=el('groupSelect'); sel.innerHTML='<option value="">选择群号</option>';
  (groups||[]).forEach(function(g){
    var tag=(g.licensed?'已授权':'未授权')+(g.configured?' / 已配置':' / 走全局');
    sel.innerHTML+='<option value="'+esc(g.groupId)+'">'+esc(g.groupId+' - '+tag)+'</option>';
  });
}
function notificationRouteHtml(groupId){
  var enabled=(config.lolPatchNotifyGroupIds||[]).map(String).indexOf(String(groupId))>=0;
  return '<div class="section-title">通知路由</div><label class="switch-row full"><span class="switch-copy"><span class="switch-title">LOL版本更新通知（@全体）</span><span class="field-desc">仅对当前群设置通知路由，不受“使用全局配置”影响；群授权有效时才会实际发送。</span></span><input id="lolPatchNotifyGroupSwitch" type="checkbox" '+(enabled?'checked':'')+'></label>';
}
function renderGroupForm(data){
  currentGroup=data;
  el('groupIdInput').value=data.groupId;
  el('groupMeta').textContent='群 '+data.groupId+'：'+(data.licensed?'已授权':'未授权')+'，'+(data.configured?'存在专属配置':'当前走全局/默认配置');
  var g=data.group||{}; var e=data.effective||{}; var groupSrc=mergedGroupSettings(e,g);
  el('groupForm').innerHTML =
    notificationRouteHtml(data.groupId)
    + switchHtml('使用全局配置','useGlobal',get(g,'useGlobal',false))
    + switchHtml('总开关','masterEnabled',get(groupSrc,'masterEnabled',true))
    + selectHtml('静默模式','silentMode',get(groupSrc,'silentMode','off'),selectOptionsByKey.silentMode)
    + switchHtml('主动发送','activeReplyEnabled',get(groupSrc,'activeReplyEnabled',true))
    + switchHtml('查询总开关','queryEnabled',get(groupSrc,'queryEnabled',true))
    + switchHtml('问答总开关','qaEnabled',get(groupSrc,'qaEnabled',true))
    + switchHtml('动态命令','dynamicCommandEnabled',get(groupSrc,'dynamicCommandEnabled',true))
    + numberHtml('回复消息几率','replyProbability',get(groupSrc,'replyProbability',100))
    + sectionTitle('本群问答冷却')
    + numberHtml('问答关键词冷却秒','qaCooldownSeconds',get(groupSrc,'qaCooldownSeconds',30))
    + numberHtml('同用户问答冷却秒','qaUserCooldownSeconds',get(groupSrc,'qaUserCooldownSeconds',12))
    + numberHtml('低风险问答冷却秒','qaTierCooldownLow',get(groupSrc,'qaTierCooldownLow',15))
    + numberHtml('中风险问答冷却秒','qaTierCooldownMedium',get(groupSrc,'qaTierCooldownMedium',30))
    + numberHtml('高风险问答冷却秒','qaTierCooldownHigh',get(groupSrc,'qaTierCooldownHigh',60))
    + sectionTitle('本群问答链接二段发送')
    + switchHtml('启用问答链接先提示','qaLinkDelivery.enabled',get(groupSrc,'qaLinkDelivery.enabled',false))
    + inputHtml('提示文本','qaLinkDelivery.noticeText',get(groupSrc,'qaLinkDelivery.noticeText','已找到资源，稍后发送链接。请不要连续重复触发。'), 'text', {full:true})
    + numberHtml('链接最小延迟 ms','qaLinkDelivery.delayMinMs',get(groupSrc,'qaLinkDelivery.delayMinMs',1000))
    + numberHtml('链接最大延迟 ms','qaLinkDelivery.delayMaxMs',get(groupSrc,'qaLinkDelivery.delayMaxMs',3000))
    + switchHtml('第二条用代码块包裹','qaLinkDelivery.wrapInCodeBlock',get(groupSrc,'qaLinkDelivery.wrapInCodeBlock',false))
    + sectionTitle('本群查询开关')
    + switchHtml('查封号','featureSwitches.query.lol_ban',get(groupSrc,'featureSwitches.query.lol_ban',true))
    + switchHtml('查战绩','featureSwitches.query.lol_battle',get(groupSrc,'featureSwitches.query.lol_battle',true))
    + switchHtml('查合集','featureSwitches.query.lol_shard',get(groupSrc,'featureSwitches.query.lol_shard',true))
    + switchHtml('查骗子','featureSwitches.query.scammer',get(groupSrc,'featureSwitches.query.scammer',true))
    + switchHtml('查同行','featureSwitches.query.peer',get(groupSrc,'featureSwitches.query.peer',true))
    + switchHtml('问答包装','botSendWrapperQaEnabled',get(groupSrc,'botSendWrapperQaEnabled',false))
    + switchHtml('查询包装','botSendWrapperQueryEnabled',get(groupSrc,'botSendWrapperQueryEnabled',false))
    + switchHtml('全局包装','botSendWrapperAllEnabled',get(groupSrc,'botSendWrapperAllEnabled',false))
    + selectHtml('战绩输出格式','lolQueryOutputFormat',get(groupSrc,'lolQueryOutputFormat','forward'),selectOptionsByKey.lolQueryOutputFormat)
    + sectionTitle('本群查封号结果策略')
    + selectHtml('查封号结果模式','banQueryResultMode',get(groupSrc,'banQueryResultMode','short'),selectOptionsByKey.banQueryResultMode)
    + selfRecallForm('', groupSrc)
    + sectionTitle('SUB玩法')
    + subGameplayForm('', groupSrc)
    + sectionTitle('内容风险')
    + contentRiskForm('', groupSrc);
  el('groupEffectiveBox').textContent=JSON.stringify(data.effective||{},null,2);
}
function renderLicenses(list){
  var box=el('licenseBox');
  if(!list||!list.length){ box.innerHTML='<p class="hint">暂无授权记录</p>'; return; }
  var html='<table><thead><tr><th>群号</th><th>等级</th><th>到期</th><th>剩余</th><th>状态</th><th>操作</th></tr></thead><tbody>';
  list.forEach(function(x){ html+='<tr><td>'+esc(x.groupId)+'</td><td>'+esc(x.level)+'</td><td>'+esc(x.expireAt)+'</td><td>'+(x.permanent?'永久':esc(x.remainingDays)+'天')+'</td><td><span class="pill">'+(x.expired?'已过期':'有效')+'</span></td><td><button class="secondary" data-license-group="'+esc(x.groupId)+'" data-license-level="'+esc(x.level)+'">填入</button></td></tr>'; });
  box.innerHTML=html+'</tbody></table>';
}
function renderBackups(list){
  var box=el('backupBox');
  if(!list||!list.length){ box.innerHTML='<p class="hint">暂无备份</p>'; return; }
  var html='<table><thead><tr><th>名称</th><th>时间</th><th>路径</th><th>文件</th></tr></thead><tbody>';
  list.forEach(function(x){ html+='<tr><td>'+esc(x.name)+'</td><td>'+esc(x.mtime)+'</td><td>'+esc(x.path)+'</td><td>'+esc((x.files||[]).join(', '))+'</td></tr>'; });
  box.innerHTML=html+'</tbody></table>';
}
function rowsTable(title, rows, cols){
  var html='<h3>'+esc(title)+'</h3>';
  if(!rows||!rows.length) return html+'<p class="hint">暂无数据</p>';
  html+='<table><thead><tr>'+cols.map(function(c){return '<th>'+esc(c[0])+'</th>';}).join('')+'</tr></thead><tbody>';
  rows.forEach(function(row){ html+='<tr>'+cols.map(function(c){return '<td>'+esc(row[c[1]]==null?'':row[c[1]])+'</td>';}).join('')+'</tr>'; });
  return html+'</tbody></table>';
}
function renderRiskDashboard(data){
  var s=data.highRiskSummary||{};
  var html='<div class="status-grid">'
    + '<div class="k">统计范围</div><div class="v">'+esc(data.hours)+' 小时</div>'
    + '<div class="k">机器人发送</div><div class="v">总 '+esc(data.botSend&&data.botSend.total)+' / 成功 '+esc(data.botSend&&data.botSend.sent)+' / 丢弃 '+esc(data.botSend&&data.botSend.dropped)+' / 失败 '+esc(data.botSend&&data.botSend.failed)+'</div>'
    + '<div class="k">自撤回</div><div class="v">成功 '+esc(data.botSend&&data.botSend.selfRecallSuccess)+' / 失败 '+esc(data.botSend&&data.botSend.selfRecallFailed)+' / 待处理 '+esc(data.botSend&&data.botSend.selfRecallPending)+'</div>'
    + '<div class="k">审计事件</div><div class="v">'+esc(data.audit&&data.audit.total)+'</div>'
    + '</div>';
  html += rowsTable('高频群', s.topGroups, [['群号','groupId'],['次数','count'],['成功','sent'],['丢弃','dropped'],['失败','failed']]);
  html += rowsTable('高频功能/场景', s.topScenes, [['场景','scene'],['次数','count'],['成功','sent'],['丢弃','dropped'],['失败','failed']]);
  html += rowsTable('风险账号', s.topRiskUsers, [['账号','userId'],['次数','count']]);
  html += rowsTable('动作账号', s.topActionUsers, [['账号','userId'],['次数','count']]);
  html += rowsTable('最近发送', data.botSend&&data.botSend.recent, [['群号','groupId'],['场景','scene'],['类型','messageType'],['状态','status'],['原因','reason']]);
  el('riskBox').innerHTML=html;
}
function renderHealth(data){
  var html='<div class="status-grid">'
    + '<div class="k">健康状态</div><div class="v">'+(data.healthy?'<span class="ok">正常</span>':'<span class="error">需关注</span>')+'</div>'
    + '<div class="k">当前账号</div><div class="v">'+esc(data.runtime&&data.runtime.botId)+'</div>'
    + '<div class="k">上次账号</div><div class="v">'+esc(data.runtime&&data.runtime.previousBotId)+'</div>'
    + '<div class="k">WS地址</div><div class="v">'+esc(data.runtime&&data.runtime.wsUrl)+'</div>'
    + '<div class="k">运行秒数</div><div class="v">'+esc(data.runtime&&data.runtime.uptimeSeconds)+'</div>'
    + '</div>';
  if(data.warnings&&data.warnings.length) html+='<h3>提示</h3><pre>'+esc(data.warnings.join('\\n'))+'</pre>';
  html += rowsTable('最近10分钟发送', data.recentSend&&data.recentSend.recent, [['群号','groupId'],['场景','scene'],['状态','status'],['原因','reason']]);
  var lm=data.lanzouMonitor||{};
  var lmStatus=lm.applicable===false
    ? '<span class="ok">已关闭（不适用）</span>'
    : lm.ok
      ? '<span class="ok">运行正常</span>'
      : lm.status==='stopped'
        ? '<span class="error">已连接，但监控任务未运行</span>'
        : lm.connected
          ? '<span class="error">已连接，但健康检查失败</span>'
          : '<span class="error">未连接</span>';
  html+='<h3>Lanzou Monitor</h3><div class="status-grid">'
    + '<div class="k">状态</div><div class="v">'+lmStatus+'</div>'
    + '<div class="k">接口地址</div><div class="v">'+esc(lm.baseUrl||'')+'</div>'
    + '<div class="k">监控数量</div><div class="v">'+esc(lm.enabledWatcherCount==null?'-':lm.enabledWatcherCount)+' / '+esc(lm.watcherCount==null?'-':lm.watcherCount)+'</div>'
    + '<div class="k">最近扫描</div><div class="v">'+esc(lm.lastScan||'-')+'</div>'
    + '<div class="k">检查时间</div><div class="v">'+esc(lm.checkedAt?new Date(lm.checkedAt).toLocaleString():'-')+'</div>'
    + (lm.error?'<div class="k">错误</div><div class="v error">'+esc(lm.error)+'</div>':'')
    + '</div>';
  el('healthBox').innerHTML=html;
}
function ensureSubResourceUi(){
  if(!el('tab-sub-resources')){
    var tabs=document.querySelector('.tabs');
    var btn=document.createElement('button');
    btn.className='tab';
    btn.dataset.tab='sub-resources';
    btn.textContent='SUB资源';
    tabs.appendChild(btn);
    var section=document.createElement('section');
    section.id='tab-sub-resources';
    section.className='card hidden';
    section.innerHTML='<h2>SUB资源</h2>'
      + '<div class="row">'
      + '<label><span>模块</span><select id="resourceModule"><option value="">全部</option><option value="core">core</option><option value="master_servant">master_servant</option><option value="light_entertainment">light_entertainment</option><option value="racing">racing</option><option value="shared">shared</option></select></label>'
      + '<label><span>分类</span><select id="resourceCollection"><option value="">全部</option><option value="raw">raw</option><option value="viewable">viewable</option><option value="selected">selected</option><option value="root">root</option></select></label>'
      + '<label><span>类型</span><select id="resourceMediaType"><option value="">全部</option><option value="image">image</option><option value="audio">audio</option><option value="document">document</option><option value="binary">binary</option></select></label>'
      + '<label><span>来源关系</span><select id="resourceSourceRelation"><option value="">全部</option><option value="direct">direct</option><option value="converted">converted</option></select></label>'
      + '<label><span>搜索</span><input id="resourceQuery" placeholder="resourceId / path / semanticKey"></label>'
      + '<label><span>条数</span><input id="resourceLimit" type="number" value="120"></label>'
      + '<button id="loadResourcesBtn">读取资源</button>'
      + '</div><div id="resourceSummary" class="status-grid"></div><div id="resourceBox"></div>';
    var gameplay=el('tab-gameplay');
    gameplay.parentNode.insertBefore(section, gameplay.nextSibling);
  }
}
function resourceFileUrl(path){ return '/api/sub-gameplay/resource-file?id='+encodeURIComponent(path); }
function renderSubResources(data){
  var summary=data.summary||{};
  var integrity=data.integrity||{};
  var integrityText=integrity.ok===false ? ('异常：'+(integrity.errors||[]).slice(0,8).join('；')) : 'OK';
  el('resourceSummary').innerHTML=
    '<div class="k">资源根目录</div><div class="v">'+esc(data.root||'')+'</div>'
    + '<div class="k">生成时间</div><div class="v">'+esc(data.generatedAt||'')+'</div>'
    + '<div class="k">完整性</div><div class="v">'+esc(integrityText)+'</div>'
    + '<div class="k">已索引/文件</div><div class="v">'+esc((integrity.manifestEntries||0)+' / '+(integrity.resourceFiles||0))+'</div>'
    + '<div class="k">来源覆盖</div><div class="v">'+esc((integrity.sourcePathCoverage||0)+' / '+(integrity.manifestEntries||0))+'</div>'
    + '<div class="k">来源关系</div><div class="v">'+esc(JSON.stringify(integrity.sourceRelations||{}))+'</div>'
    + '<div class="k">总条目</div><div class="v">'+esc(summary.total||0)+'</div>'
    + '<div class="k">模块</div><div class="v">'+esc(JSON.stringify(summary.byModule||{}))+'</div>'
    + '<div class="k">分类</div><div class="v">'+esc(JSON.stringify(summary.byCollection||{}))+'</div>'
    + '<div class="k">媒体</div><div class="v">'+esc(JSON.stringify(summary.byMediaType||{}))+'</div>';
  var rows=data.entries||[];
  if(!rows.length){ el('resourceBox').innerHTML='<p class="hint">暂无资源</p>'; return; }
  var html='<table><thead><tr><th>预览</th><th>操作</th><th>资源ID</th><th>模块</th><th>分类</th><th>类型</th><th>语义</th><th>路径</th><th>来源关系</th><th>来源</th><th>大小</th></tr></thead><tbody>';
  rows.forEach(function(row){
    var preview='';
    var id=row.resourceId||row.path;
    var fileUrl=resourceFileUrl(id);
    var action='<a class="link" target="_blank" rel="noreferrer" href="'+fileUrl+'">打开</a>';
    if(row.mediaType==='image') preview='<img class="resource-preview" src="'+fileUrl+'">';
    else if(row.mediaType==='audio') preview='<audio class="resource-audio" controls src="'+fileUrl+'"></audio>';
    html+='<tr><td>'+preview+'</td><td>'+action+'</td><td>'+esc(id)+'</td><td>'+esc(row.module)+'</td><td>'+esc(row.collection)+'</td><td>'+esc(row.mediaType)+'</td><td>'+esc(row.semanticKey||'')+'</td><td>'+esc(row.path)+'</td><td>'+esc(row.sourceRelation||'')+'</td><td>'+esc(row.sourcePath||'')+'</td><td>'+esc(row.size)+'</td></tr>';
  });
  el('resourceBox').innerHTML=html+'</tbody></table>';
}
function loadSubResources(){
  ensureSubResourceUi();
  var mod=el('resourceModule').value||'';
  var collection=el('resourceCollection').value||'';
  var mediaType=el('resourceMediaType').value||'';
  var sourceRelation=el('resourceSourceRelation').value||'';
  var limit=el('resourceLimit').value||120;
  var q=el('resourceQuery').value||'';
  return api('/api/sub-gameplay/resources?module='+encodeURIComponent(mod)+'&collection='+encodeURIComponent(collection)+'&mediaType='+encodeURIComponent(mediaType)+'&sourceRelation='+encodeURIComponent(sourceRelation)+'&limit='+encodeURIComponent(limit)+'&q='+encodeURIComponent(q)).then(renderSubResources);
}
function loadRiskDashboard(){ return api('/api/risk/dashboard?hours='+encodeURIComponent(el('riskHours').value||24)).then(renderRiskDashboard); }
function loadHealth(){ return api('/api/health').then(renderHealth); }
var selfUpdatePollTimer=null;
function selfUpdateTerminal(status){ return ['current','complete','failed','rolled_back','rollback_failed'].indexOf(String(status||''))>=0; }
function renderSelfUpdate(data){
  var state=data.state||{}; var latest=data.latest||{};
  var received=Number(state.downloadedBytes||0), total=Number(state.totalBytes||0);
  var progress=total>0?Math.min(100,Math.round(received*100/total))+'%':(received?Math.round(received/1024/1024)+' MB':'-');
  var html=''
    + '<div class="k">当前版本</div><div class="v">'+esc(data.currentVersion||'-')+'</div>'
    + '<div class="k">当前提交</div><div class="v">'+esc(data.currentCommit||'-')+'</div>'
    + '<div class="k">最新成功构建</div><div class="v">'+esc(latest.commit||'-')+'</div>'
    + '<div class="k">有可用更新</div><div class="v">'+(data.updateAvailable?'<span class="ok">是</span>':'否')+'</div>'
    + '<div class="k">Token</div><div class="v">'+(data.tokenConfigured?'已配置（'+esc(data.tokenSource||'')+'）':'<span class="error">未配置</span>')+'</div>'
    + '<div class="k">应用目录可写</div><div class="v">'+(data.writable?'<span class="ok">是</span>':'<span class="error">否</span>')+'</div>'
    + '<div class="k">受管运行入口</div><div class="v">'+(data.managedRuntime?'<span class="ok">是</span>':'<span class="error">否（禁止自更新）</span>')+'</div>'
    + '<div class="k">更新状态</div><div class="v">'+esc(state.status||'idle')+' / '+esc(state.phase||'-')+'</div>'
    + '<div class="k">进度</div><div class="v">'+esc(progress)+'</div>'
    + '<div class="k">说明</div><div class="v">'+esc(state.message||data.latestError||'-')+'</div>'
    + (state.error?'<div class="k">错误</div><div class="v error">'+esc(state.error)+'</div>':'');
  el('selfUpdateBox').innerHTML=html;
  var btn=el('applySelfUpdateBtn'); if(btn) btn.disabled=!!data.busy || !data.writable || !data.managedRuntime;
  if(selfUpdateTerminal(state.status) && selfUpdatePollTimer){ clearInterval(selfUpdatePollTimer); selfUpdatePollTimer=null; }
}
function loadSelfUpdate(refresh){ return api('/api/self-update/status'+(refresh?'?refresh=1':'')).then(renderSelfUpdate); }
function startSelfUpdatePolling(){
  if(selfUpdatePollTimer) clearInterval(selfUpdatePollTimer);
  selfUpdatePollTimer=setInterval(function(){ loadSelfUpdate(false).catch(function(){}); },1500);
}
function saveSelfUpdateToken(clear){
  var token=clear?'':el('selfUpdateToken').value.trim();
  if(!clear&&!token){ show('请输入 GitHub 只读 Token',false); return Promise.resolve(); }
  return api('/api/self-update/token',{method:'POST',body:JSON.stringify({token:token})}).then(function(){ el('selfUpdateToken').value=''; show(clear?'更新 Token 已清除':'更新 Token 已保存'); return loadSelfUpdate(true); });
}
function applySelfUpdate(){
  if(!confirm('确认将 GroupGuard 更新到 main 最近成功构建？更新会自动备份当前 dist，并重启 GroupGuard worker。')) return Promise.resolve();
  return api('/api/self-update/apply',{method:'POST',body:JSON.stringify({confirmed:true})}).then(function(){ show('更新已开始，请保持页面打开查看状态'); startSelfUpdatePolling(); return loadSelfUpdate(false); });
}
function applyRiskPreset(level){
  el('presetBox').textContent='应用中...';
  return api('/api/risk/preset',{method:'POST',body:JSON.stringify({level:level})}).then(function(res){
    el('presetBox').textContent=JSON.stringify({level:res.level, patch:res.patch},null,2);
    show(res.message||'风险档位已应用');
    return loadConfig().then(loadStatus);
  });
}
function loadStatus(){ return api('/api/status').then(renderStatus); }
function loadConfig(){ return api('/api/config').then(function(data){ config=data.config; el('configEditor').value=JSON.stringify(config,null,2); renderForms(); }); }
function loadCommands(){ return api('/api/dynamic-commands').then(function(data){ el('commandsEditor').value=JSON.stringify(data.config,null,2); }); }
function loadGroups(){ return api('/api/groups').then(function(data){ renderGroupList(data.groups||[]); }); }
function loadLicenses(){ return api('/api/licenses').then(function(data){ renderLicenses(data.licenses||[]); }); }
function loadBackups(){ return api('/api/backups').then(function(data){ renderBackups(data.backups||[]); }); }
function loadSelectedGroup(){
  var id=el('groupIdInput').value.trim() || el('groupSelect').value;
  if(!id){ show('请先选择或输入群号',false); return; }
  return api('/api/groups/'+encodeURIComponent(id)).then(renderGroupForm);
}
function savePatch(formId){
  return api('/api/config/patch',{method:'POST',body:JSON.stringify({patch:collectPatch(formId)})})
    .then(function(res){ show(res.message||'保存成功'); return loadConfig().then(loadStatus); });
}
function saveLolPatchNotificationRoute(id){
  var list=Array.isArray(config.lolPatchNotifyGroupIds)?config.lolPatchNotifyGroupIds.map(String):[];
  var enabled=!!(el('lolPatchNotifyGroupSwitch')&&el('lolPatchNotifyGroupSwitch').checked);
  var next=list.filter(function(value){ return value!==String(id); });
  if(enabled) next.push(String(id));
  next=Array.from(new Set(next));
  return api('/api/config/patch',{method:'POST',body:JSON.stringify({patch:{lolPatchNotifyGroupIds:next}})}).then(function(){ config.lolPatchNotifyGroupIds=next; });
}
function saveGroupPatch(){
  var id=el('groupIdInput').value.trim();
  if(!id){ show('请先输入群号',false); return; }
  return api('/api/groups/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({patch:collectPatch('groupForm')})})
    .then(function(){ return saveLolPatchNotificationRoute(id); })
    .then(function(){ show('本群配置和通知路由已保存'); return loadConfig().then(loadGroups).then(loadSelectedGroup); });
}
function deleteGroupConfig(){
  var id=el('groupIdInput').value.trim();
  if(!id){ show('请先输入群号',false); return; }
  if(!confirm('确认删除 '+id+' 的本群专属配置？')) return;
  return api('/api/groups/'+encodeURIComponent(id),{method:'DELETE'}).then(function(data){ renderGroupForm(data); show('本群专属配置已删除'); return loadGroups(); });
}
function saveLicense(){
  var id=el('licenseGroupId').value.trim();
  if(!id){ show('请先输入群号',false); return; }
  var days=Number(el('licenseDays').value||0);
  return api('/api/licenses/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({level:el('licenseLevel').value,permanent:days<=0,days:days})}).then(function(res){ show(res.message||'授权已保存'); return loadLicenses().then(loadGroups); });
}
function deleteLicense(){
  var id=el('licenseGroupId').value.trim();
  if(!id){ show('请先输入群号',false); return; }
  if(!confirm('确认取消 '+id+' 的授权？')) return;
  return api('/api/licenses/'+encodeURIComponent(id),{method:'DELETE'}).then(function(res){ show(res.message||'授权已取消'); return loadLicenses().then(loadGroups); });
}
function createBackupSnapshot(){ return api('/api/backups/snapshot',{method:'POST',body:'{}'}).then(function(res){ show(res.message||'快照已创建'); return loadBackups(); }); }
function saveRawConfig(){ var parsed=JSON.parse(el('configEditor').value); return api('/api/config',{method:'POST',body:JSON.stringify({config:parsed})}).then(function(res){ show(res.message||'保存成功'); return reloadAll(); }); }
function saveCommands(){ var parsed=JSON.parse(el('commandsEditor').value); return api('/api/dynamic-commands',{method:'POST',body:JSON.stringify({config:parsed})}).then(function(res){ show(res.message||'保存成功'); return loadCommands().then(loadStatus); }); }
function reloadAll(){ return Promise.resolve().then(loadStatus).then(loadConfig).then(loadCommands).then(loadGroups).then(loadLicenses).then(loadBackups).then(loadRiskDashboard).then(loadHealth).then(function(){ return loadSelfUpdate(false).catch(function(){}); }).then(function(){ show('已刷新'); }).catch(function(e){ show(e.message || e, false); }); }
function switchTab(tab){
  document.querySelectorAll('button.tab[data-tab]').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('section[id^="tab-"]').forEach(function(s){ s.classList.add('hidden'); });
  var btn=document.querySelector('button.tab[data-tab="'+tab+'"]'); if(btn) btn.classList.add('active');
  var section=el('tab-'+tab); if(section) section.classList.remove('hidden');
}
function bind(){
  ensureSubResourceUi();
  el('qaLink').href='/qa.html';
  el('queryLink').href='/query.html';
  document.querySelectorAll('button.tab[data-tab]').forEach(function(btn){ btn.addEventListener('click',function(){ switchTab(btn.dataset.tab); if(btn.dataset.tab==='self-update') loadSelfUpdate(true).catch(function(e){ show(e.message,false); }); }); });
  el('refreshBtn').addEventListener('click',reloadAll);
  document.querySelectorAll('[data-save-form]').forEach(function(btn){ btn.addEventListener('click',function(){ savePatch(btn.dataset.saveForm).catch(function(e){ show(e.message,false); }); }); });
  el('loadGroupBtn').addEventListener('click',function(){ Promise.resolve(loadSelectedGroup()).catch(function(e){ show(e.message,false); }); });
  el('saveGroupBtn').addEventListener('click',function(){ Promise.resolve(saveGroupPatch()).catch(function(e){ show(e.message,false); }); });
  el('deleteGroupBtn').addEventListener('click',function(){ Promise.resolve(deleteGroupConfig()).catch(function(e){ show(e.message,false); }); });
  el('saveLicenseBtn').addEventListener('click',function(){ Promise.resolve(saveLicense()).catch(function(e){ show(e.message,false); }); });
  el('deleteLicenseBtn').addEventListener('click',function(){ Promise.resolve(deleteLicense()).catch(function(e){ show(e.message,false); }); });
  el('snapshotBtn').addEventListener('click',function(){ createBackupSnapshot().catch(function(e){ show(e.message,false); }); });
  el('loadBackupsBtn').addEventListener('click',function(){ loadBackups().catch(function(e){ show(e.message,false); }); });
  el('loadRiskBtn').addEventListener('click',function(){ loadRiskDashboard().catch(function(e){ show(e.message,false); }); });
  el('loadHealthBtn').addEventListener('click',function(){ loadHealth().catch(function(e){ show(e.message,false); }); });
  el('checkSelfUpdateBtn').addEventListener('click',function(){ loadSelfUpdate(true).catch(function(e){ show(e.message,false); }); });
  el('applySelfUpdateBtn').addEventListener('click',function(){ applySelfUpdate().catch(function(e){ show(e.message,false); }); });
  el('saveSelfUpdateTokenBtn').addEventListener('click',function(){ saveSelfUpdateToken(false).catch(function(e){ show(e.message,false); }); });
  el('clearSelfUpdateTokenBtn').addEventListener('click',function(){ saveSelfUpdateToken(true).catch(function(e){ show(e.message,false); }); });
  el('loadResourcesBtn').addEventListener('click',function(){ loadSubResources().catch(function(e){ show(e.message,false); }); });
  document.querySelectorAll('[data-risk-preset]').forEach(function(btn){ btn.addEventListener('click',function(){ applyRiskPreset(btn.dataset.riskPreset).catch(function(e){ show(e.message,false); }); }); });
  el('saveRawBtn').addEventListener('click',function(){ Promise.resolve(saveRawConfig()).catch(function(e){ show(e.message,false); }); });
  el('reloadConfigBtn').addEventListener('click',function(){ loadConfig().catch(function(e){ show(e.message,false); }); });
  el('saveCommandsBtn').addEventListener('click',function(){ Promise.resolve(saveCommands()).catch(function(e){ show(e.message,false); }); });
  el('reloadCommandsBtn').addEventListener('click',function(){ loadCommands().catch(function(e){ show(e.message,false); }); });
  el('groupSelect').addEventListener('change',function(){ if(this.value) el('groupIdInput').value=this.value; });
  el('licenseBox').addEventListener('click',function(e){ var t=e.target; if(t && t.dataset && t.dataset.licenseGroup){ el('licenseGroupId').value=t.dataset.licenseGroup; el('licenseLevel').value=t.dataset.licenseLevel||'pro'; } });
  el('advancedFilter').addEventListener('input',renderAdvancedForm);
}
bind();
reloadAll();
})();
</script>
</body>
</html>`;
}
