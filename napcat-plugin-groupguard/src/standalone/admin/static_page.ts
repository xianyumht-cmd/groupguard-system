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
.full{grid-column:1/-1}
.section-title{grid-column:1/-1;border-bottom:1px solid #263349;padding:12px 0 4px;margin-top:4px;color:#bfdbfe;font-weight:700}
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
    <p class="hint">这里会把当前 config.json 的所有字段展平成表单。布尔值用勾选框，数字用数字框，数组和对象用 JSON 文本框。</p>
    <div class="row"><label><span>筛选字段</span><input id="advancedFilter" placeholder="例如 selfRecall、replyProbability、contentRisk"></label></div>
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
var token = new URL(location.href).searchParams.get('token') || localStorage.getItem('GROUPGUARD_WEBUI_TOKEN') || '';
if (!token) token = prompt('请输入 GROUPGUARD_WEBUI_TOKEN') || '';
localStorage.setItem('GROUPGUARD_WEBUI_TOKEN', token);
var config = {};
var currentGroup = null;
var statusLabels = {
  workDir:'工作目录', processCwd:'进程目录', configPath:'配置文件', dataDir:'数据目录', sqlitePath:'数据库',
  backupDir:'备份目录', dynamicCommandsPath:'动态命令配置', wsUrl:'WebSocket地址', botId:'机器人QQ',
  adapterName:'适配器', dynamicCommandsCount:'动态命令数量', feature:'功能开关快照', exists:'文件存在状态'
};
var actionOptions = [
  ['recall','仅撤回'],
  ['recall_warn','撤回并提示'],
  ['recall_ban','撤回并禁言'],
  ['recall_kick','撤回并踢出'],
  ['recall_blacklist','撤回并拉黑']
];
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
function inputHtml(label,key,value,type,extra){ return '<label '+(extra&&extra.full?'class="full"':'')+'><span>'+label+'</span><input data-config-key="'+key+'" type="'+(type||'text')+'" value="'+esc(value)+'"></label>'; }
function textareaHtml(label,key,value){ return '<label class="full"><span>'+label+'</span><textarea data-config-key="'+key+'">'+esc(JSON.stringify(value == null ? null : value,null,2))+'</textarea></label>'; }
function selectHtml(label,key,value,opts){
  var s='<label><span>'+label+'</span><select data-config-key="'+key+'">';
  opts.forEach(function(o){ var valueText=Array.isArray(o)?o[0]:o; var labelText=Array.isArray(o)?o[1]:o; s+='<option value="'+esc(valueText)+'" '+(String(value)===String(valueText)?'selected':'')+'>'+esc(labelText)+'</option>'; });
  return s+'</select></label>';
}
function switchHtml(label,key,value){ return '<label class="switch-row"><span>'+label+'</span><input data-config-key="'+key+'" type="checkbox" '+(value?'checked':'')+'></label>'; }
function riskActionHtml(label,key,value){ return selectHtml(label,key,value||'recall',actionOptions); }
function numberHtml(label,key,value){ return inputHtml(label,key,value,'number'); }
function jsonInputHtml(label,key,value){ return textareaHtml(label,key,value || []); }
function sectionTitle(text){ return '<div class="section-title">'+text+'</div>'; }
function selfRecallForm(prefix, src){
  return sectionTitle('自撤回')
    + switchHtml('启用自撤回 selfRecall.enabled',prefix+'selfRecall.enabled',get(src,'selfRecall.enabled',get(src,'autoRecallSelf',false)))
    + numberHtml('自撤回几率 selfRecall.probability（0-100）',prefix+'selfRecall.probability',get(src,'selfRecall.probability',get(src,'autoRecallSelfProbability',100)))
    + selectHtml('延迟模式 selfRecall.mode',prefix+'selfRecall.mode',get(src,'selfRecall.mode','fixed'),[['fixed','固定延迟'],['random','随机延迟']])
    + numberHtml('固定延迟秒 selfRecall.fixedDelay',prefix+'selfRecall.fixedDelay',get(src,'selfRecall.fixedDelay',get(src,'autoRecallSelfDelay',60)))
    + numberHtml('随机最小延迟秒 selfRecall.minDelay',prefix+'selfRecall.minDelay',get(src,'selfRecall.minDelay',45))
    + numberHtml('随机最大延迟秒 selfRecall.maxDelay',prefix+'selfRecall.maxDelay',get(src,'selfRecall.maxDelay',90))
    + numberHtml('额外抖动秒 selfRecall.jitter',prefix+'selfRecall.jitter',get(src,'selfRecall.jitter',0));
}
function subGameplayForm(prefix, src){
  return switchHtml('SUB总开关 subGameplay.enabled',prefix+'subGameplay.enabled',get(src,'subGameplay.enabled',false))
    + switchHtml('主仆契约 masterServantEnabled',prefix+'subGameplay.masterServantEnabled',get(src,'subGameplay.masterServantEnabled',true))
    + switchHtml('竞速赛车 racingEnabled',prefix+'subGameplay.racingEnabled',get(src,'subGameplay.racingEnabled',true))
    + switchHtml('轻娱乐 lightEntertainmentEnabled',prefix+'subGameplay.lightEntertainmentEnabled',get(src,'subGameplay.lightEntertainmentEnabled',true))
    + inputHtml('命令前缀 commandPrefix',prefix+'subGameplay.commandPrefix',get(src,'subGameplay.commandPrefix',''))
    + numberHtml('每日福利黄金 dailyWelfareGold',prefix+'subGameplay.dailyWelfareGold',get(src,'subGameplay.dailyWelfareGold',1000))
    + numberHtml('初始黄金 initialGold',prefix+'subGameplay.initialGold',get(src,'subGameplay.initialGold',500))
    + numberHtml('初始车币 initialRacingCoins',prefix+'subGameplay.initialRacingCoins',get(src,'subGameplay.initialRacingCoins',0))
    + numberHtml('初始汽油 initialFuel',prefix+'subGameplay.initialFuel',get(src,'subGameplay.initialFuel',100))
    + numberHtml('汽油上限 maxFuel',prefix+'subGameplay.maxFuel',get(src,'subGameplay.maxFuel',100))
    + numberHtml('对决耗油 duelCostFuel',prefix+'subGameplay.duelCostFuel',get(src,'subGameplay.duelCostFuel',10))
    + numberHtml('参赛耗油 raceCostFuel',prefix+'subGameplay.raceCostFuel',get(src,'subGameplay.raceCostFuel',15))
    + numberHtml('车币兑换率 carCoinExchangeRate',prefix+'subGameplay.carCoinExchangeRate',get(src,'subGameplay.carCoinExchangeRate',10))
    + numberHtml('汽油兑换率 fuelExchangeRate',prefix+'subGameplay.fuelExchangeRate',get(src,'subGameplay.fuelExchangeRate',5))
    + numberHtml('PK冷却秒 pkCooldownSeconds',prefix+'subGameplay.pkCooldownSeconds',get(src,'subGameplay.pkCooldownSeconds',30))
    + numberHtml('逃跑成功率 escapeSuccessRate',prefix+'subGameplay.escapeSuccessRate',get(src,'subGameplay.escapeSuccessRate',18))
    + numberHtml('抢走成功率 snatchSuccessRate',prefix+'subGameplay.snatchSuccessRate',get(src,'subGameplay.snatchSuccessRate',45))
    + numberHtml('契约税率 contractTaxRate',prefix+'subGameplay.contractTaxRate',get(src,'subGameplay.contractTaxRate',10))
    + numberHtml('排行条数 rankLimit',prefix+'subGameplay.rankLimit',get(src,'subGameplay.rankLimit',10))
    + jsonInputHtml('文本模板 textTemplates',prefix+'subGameplay.textTemplates',get(src,'subGameplay.textTemplates',{}))
    + jsonInputHtml('命令别名 commandAliases',prefix+'subGameplay.commandAliases',get(src,'subGameplay.commandAliases',{}));
}
function contentRiskForm(prefix, src){
  var p=prefix+'contentRisk.';
  var html=switchHtml('内容风险总开关 enabled',p+'enabled',get(src,'contentRisk.enabled',false))
    + switchHtml('仅记录不处理 logOnly',p+'logOnly',get(src,'contentRisk.logOnly',false))
    + switchHtml('群内通知 notifyGroup',p+'notifyGroup',get(src,'contentRisk.notifyGroup',false));
  [
    ['url','链接'],['qr','二维码'],['lightApp','小程序卡片'],['forward','合并转发'],['contact','名片分享'],
    ['groupInvite','群邀请'],['image','图片'],['video','视频'],['record','语音']
  ].forEach(function(item){
    var t=item[0], name=item[1];
    html += sectionTitle(name)
      + switchHtml('拦截 '+name+' rules.'+t+'.enabled',p+'rules.'+t+'.enabled',get(src,'contentRisk.rules.'+t+'.enabled',false))
      + riskActionHtml(name+'处理动作 action',p+'rules.'+t+'.action',get(src,'contentRisk.rules.'+t+'.action','recall'))
      + numberHtml(name+'禁言分钟 banMinutes',p+'rules.'+t+'.banMinutes',get(src,'contentRisk.rules.'+t+'.banMinutes',10))
      + inputHtml(name+'原因 reason',p+'rules.'+t+'.reason',get(src,'contentRisk.rules.'+t+'.reason',''));
  });
  html += sectionTitle('名单和二维码检测')
    + jsonInputHtml('URL白名单 urlAllowlist',p+'urlAllowlist',get(src,'contentRisk.urlAllowlist',[]))
    + jsonInputHtml('URL黑名单 urlBlocklist',p+'urlBlocklist',get(src,'contentRisk.urlBlocklist',[]))
    + numberHtml('二维码检测超时毫秒 qrDetectTimeoutMs',p+'qrDetectTimeoutMs',get(src,'contentRisk.qrDetectTimeoutMs',3000))
    + numberHtml('二维码最大字节 qrDetectMaxBytes',p+'qrDetectMaxBytes',get(src,'contentRisk.qrDetectMaxBytes',5242880))
    + numberHtml('二维码检测并发 qrDetectConcurrency',p+'qrDetectConcurrency',get(src,'contentRisk.qrDetectConcurrency',2))
    + numberHtml('二维码缓存秒 qrCacheSeconds',p+'qrCacheSeconds',get(src,'contentRisk.qrCacheSeconds',300))
    + switchHtml('群邀请URL检测 groupInviteDetectUrl',p+'groupInviteDetectUrl',get(src,'contentRisk.groupInviteDetectUrl',true))
    + switchHtml('群邀请卡片检测 groupInviteDetectCard',p+'groupInviteDetectCard',get(src,'contentRisk.groupInviteDetectCard',true))
    + switchHtml('群邀请合并转发检测 groupInviteDetectForward',p+'groupInviteDetectForward',get(src,'contentRisk.groupInviteDetectForward',true));
  return html;
}
function mergedGroupSettings(e,g){
  var out=Object.assign({}, e||{}, g||{});
  out.featureSwitches=Object.assign({}, get(e,'featureSwitches',{}), get(g,'featureSwitches',{}));
  out.selfRecall=Object.assign({}, get(e,'selfRecall',{}), get(g,'selfRecall',{}));
  out.subGameplay=Object.assign({}, get(e,'subGameplay',{}), get(g,'subGameplay',{}));
  out.contentRisk=Object.assign({}, get(e,'contentRisk',{}), get(g,'contentRisk',{}));
  out.contentRisk.rules=Object.assign({}, get(e,'contentRisk.rules',{}), get(g,'contentRisk.rules',{}));
  return out;
}
function fieldValue(input){
  if(input.type==='checkbox') return input.checked;
  var v=input.value.trim();
  if(v==='true') return true;
  if(v==='false') return false;
  if(v==='null') return null;
  if(/^-?\\d+(\\.\\d+)?$/.test(v)) return Number(v);
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
    switchHtml('总开关 masterEnabled','global.masterEnabled',get(config,'global.masterEnabled',true))
    + selectHtml('静默模式 silentMode','global.silentMode',get(config,'global.silentMode','off'),[['off','关闭'],['noPassiveReply','不被动回复'],['noBotSend','不由机器人发送']])
    + switchHtml('主动发送 activeReplyEnabled','global.activeReplyEnabled',get(config,'global.activeReplyEnabled',true))
    + switchHtml('查询总开关 queryEnabled','global.queryEnabled',get(config,'global.queryEnabled',true))
    + switchHtml('问答总开关 qaEnabled','global.qaEnabled',get(config,'global.qaEnabled',true))
    + switchHtml('动态命令 dynamicCommandEnabled','global.dynamicCommandEnabled',get(config,'global.dynamicCommandEnabled',true))
    + switchHtml('禁用旧问答 disableQA','global.disableQA',get(config,'global.disableQA',false))
    + switchHtml('禁用旧LOL查询 disableLolQuery','global.disableLolQuery',get(config,'global.disableLolQuery',false))
    + switchHtml('禁用签到 disableSignin','global.disableSignin',get(config,'global.disableSignin',false))
    + switchHtml('禁用抽奖 disableLottery','global.disableLottery',get(config,'global.disableLottery',false))
    + switchHtml('禁用邀请统计 disableInvite','global.disableInvite',get(config,'global.disableInvite',false))
    + switchHtml('禁用活跃统计 disableActivity','global.disableActivity',get(config,'global.disableActivity',false))
    + switchHtml('查封号 query.lol_ban','global.featureSwitches.query.lol_ban',get(config,'global.featureSwitches.query.lol_ban',true))
    + switchHtml('查战绩 query.lol_battle','global.featureSwitches.query.lol_battle',get(config,'global.featureSwitches.query.lol_battle',true))
    + switchHtml('查隐藏 query.lol_hidden','global.featureSwitches.query.lol_hidden',get(config,'global.featureSwitches.query.lol_hidden',true))
    + switchHtml('查合集 query.lol_shard','global.featureSwitches.query.lol_shard',get(config,'global.featureSwitches.query.lol_shard',true));
  el('sendForm').innerHTML =
    sectionTitle('回复控制')
    + numberHtml('回复消息几率 replyProbability（0-100）','global.replyProbability',get(config,'global.replyProbability',100))
    + numberHtml('最小随机延迟 ms randomDelayMin','global.randomDelayMin',get(config,'global.randomDelayMin',500))
    + numberHtml('最大随机延迟 ms randomDelayMax','global.randomDelayMax',get(config,'global.randomDelayMax',1500))
    + selectHtml('随机后缀模式 botAntiRiskSuffixMode','global.botAntiRiskSuffixMode',get(config,'global.botAntiRiskSuffixMode','mixed'),[['mixed','混合'],['punctuation','标点'],['none','关闭'],['global','跟随全局']])
    + jsonInputHtml('场景策略 botAntiRiskScenePolicies','global.botAntiRiskScenePolicies',get(config,'global.botAntiRiskScenePolicies',{}))
    + sectionTitle('发送包装')
    + switchHtml('发送包装总开关 botSendWrapperEnabled','global.botSendWrapperEnabled',get(config,'global.botSendWrapperEnabled',false))
    + selectHtml('包装模式 botSendWrapperMode','global.botSendWrapperMode',get(config,'global.botSendWrapperMode','normal'),[['normal','普通发送'],['forward','合并转发']])
    + switchHtml('问答包装 botSendWrapperQaEnabled','global.botSendWrapperQaEnabled',get(config,'global.botSendWrapperQaEnabled',false))
    + switchHtml('查询包装 botSendWrapperQueryEnabled','global.botSendWrapperQueryEnabled',get(config,'global.botSendWrapperQueryEnabled',false))
    + switchHtml('全局包装 botSendWrapperAllEnabled','global.botSendWrapperAllEnabled',get(config,'global.botSendWrapperAllEnabled',false))
    + selfRecallForm('global.', config.global || {})
    + sectionTitle('队列和限流')
    + selectHtml('发送队列模式 queueMode','global.queueMode',get(config,'global.queueMode','group'),[['group','分群队列'],['global','全局队列']])
    + numberHtml('发送并发 queueConcurrency','global.queueConcurrency',get(config,'global.queueConcurrency',1))
    + numberHtml('全局每分钟上限 globalMaxPerMinute','global.globalMaxPerMinute',get(config,'global.globalMaxPerMinute',60))
    + switchHtml('超限后排队 rateLimitEnqueue','global.rateLimitEnqueue',get(config,'global.rateLimitEnqueue',true))
    + numberHtml('全局队列上限 maxQueueSizeGlobal','global.maxQueueSizeGlobal',get(config,'global.maxQueueSizeGlobal',3000))
    + numberHtml('单群队列上限 maxQueueSizePerGroup','global.maxQueueSizePerGroup',get(config,'global.maxQueueSizePerGroup',120))
    + numberHtml('群熔断窗口秒 groupFuseWindowSeconds','global.groupFuseWindowSeconds',get(config,'global.groupFuseWindowSeconds',60))
    + numberHtml('群熔断阈值 groupFuseThreshold','global.groupFuseThreshold',get(config,'global.groupFuseThreshold',45))
    + numberHtml('群熔断冷却秒 groupFuseCooldownSeconds','global.groupFuseCooldownSeconds',get(config,'global.groupFuseCooldownSeconds',90))
    + sectionTitle('动作队列')
    + numberHtml('每分钟撤回上限 maxRecallPerMinute','global.maxRecallPerMinute',get(config,'global.maxRecallPerMinute',60))
    + numberHtml('每分钟禁言上限 maxBanPerMinute','global.maxBanPerMinute',get(config,'global.maxBanPerMinute',5))
    + numberHtml('每分钟踢出上限 maxKickPerMinute','global.maxKickPerMinute',get(config,'global.maxKickPerMinute',3))
    + numberHtml('撤回去重秒 recallDedupSeconds','global.recallDedupSeconds',get(config,'global.recallDedupSeconds',20));
  el('gameplayForm').innerHTML = subGameplayForm('global.', config.global || {});
  el('contentRiskForm').innerHTML = contentRiskForm('global.', config.global || {});
  el('eleForm').innerHTML = inputHtml('ELE API Base URL','eleBuildApiBaseUrl',get(config,'eleBuildApiBaseUrl',''));
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
function renderAdvancedForm(){
  var box=el('advancedForm');
  if(!box) return;
  var filter=(el('advancedFilter') && el('advancedFilter').value || '').trim().toLowerCase();
  var rows=flattenConfig(config,'').filter(function(row){ return !filter || row.key.toLowerCase().indexOf(filter)>=0; });
  var html='';
  rows.forEach(function(row){
    if(!row.key) return;
    var v=row.value;
    if(typeof v === 'boolean') html += switchHtml(row.key,row.key,v);
    else if(typeof v === 'number') html += numberHtml(row.key,row.key,v);
    else if(v === null || Array.isArray(v) || typeof v === 'object') html += textareaHtml(row.key,row.key,v);
    else html += inputHtml(row.key,row.key,v);
  });
  box.innerHTML = html || '<p class="hint">没有匹配的字段。</p>';
}
function renderGroupList(groups){
  var sel=el('groupSelect'); sel.innerHTML='<option value="">选择群号</option>';
  (groups||[]).forEach(function(g){
    var tag=(g.licensed?'已授权':'未授权')+(g.configured?' / 已配置':' / 走全局');
    sel.innerHTML+='<option value="'+g.groupId+'">'+g.groupId+' - '+tag+'</option>';
  });
}
function renderGroupForm(data){
  currentGroup=data;
  el('groupIdInput').value=data.groupId;
  el('groupMeta').textContent='群 '+data.groupId+'：'+(data.licensed?'已授权':'未授权')+'，'+(data.configured?'存在专属配置':'当前走全局/默认配置');
  var g=data.group||{}; var e=data.effective||{}; var groupSrc=mergedGroupSettings(e,g);
  el('groupForm').innerHTML =
    switchHtml('使用全局配置 useGlobal','useGlobal',get(g,'useGlobal',false))
    + switchHtml('总开关 masterEnabled','masterEnabled',get(groupSrc,'masterEnabled',true))
    + selectHtml('静默模式 silentMode','silentMode',get(groupSrc,'silentMode','off'),[['off','关闭'],['noPassiveReply','不被动回复'],['noBotSend','不由机器人发送']])
    + switchHtml('主动发送 activeReplyEnabled','activeReplyEnabled',get(groupSrc,'activeReplyEnabled',true))
    + switchHtml('查询总开关 queryEnabled','queryEnabled',get(groupSrc,'queryEnabled',true))
    + switchHtml('问答总开关 qaEnabled','qaEnabled',get(groupSrc,'qaEnabled',true))
    + switchHtml('动态命令 dynamicCommandEnabled','dynamicCommandEnabled',get(groupSrc,'dynamicCommandEnabled',true))
    + numberHtml('回复消息几率 replyProbability（0-100）','replyProbability',get(groupSrc,'replyProbability',100))
    + switchHtml('查封号 query.lol_ban','featureSwitches.query.lol_ban',get(groupSrc,'featureSwitches.query.lol_ban',true))
    + switchHtml('查战绩 query.lol_battle','featureSwitches.query.lol_battle',get(groupSrc,'featureSwitches.query.lol_battle',true))
    + switchHtml('查隐藏 query.lol_hidden','featureSwitches.query.lol_hidden',get(groupSrc,'featureSwitches.query.lol_hidden',true))
    + switchHtml('查合集 query.lol_shard','featureSwitches.query.lol_shard',get(groupSrc,'featureSwitches.query.lol_shard',true))
    + switchHtml('问答包装 botSendWrapperQaEnabled','botSendWrapperQaEnabled',get(groupSrc,'botSendWrapperQaEnabled',false))
    + switchHtml('查询包装 botSendWrapperQueryEnabled','botSendWrapperQueryEnabled',get(groupSrc,'botSendWrapperQueryEnabled',false))
    + switchHtml('全局包装 botSendWrapperAllEnabled','botSendWrapperAllEnabled',get(groupSrc,'botSendWrapperAllEnabled',false))
    + selectHtml('战绩输出格式 lolQueryOutputFormat','lolQueryOutputFormat',get(groupSrc,'lolQueryOutputFormat','forward'),['forward','text','image','card'])
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
  list.forEach(function(x){ html+='<tr><td>'+x.groupId+'</td><td>'+x.level+'</td><td>'+esc(x.expireAt)+'</td><td>'+(x.permanent?'永久':x.remainingDays+'天')+'</td><td><span class="pill">'+(x.expired?'已过期':'有效')+'</span></td><td><button class="secondary" data-license-group="'+x.groupId+'" data-license-level="'+x.level+'">填入</button></td></tr>'; });
  box.innerHTML=html+'</tbody></table>';
}
function renderBackups(list){
  var box=el('backupBox');
  if(!list||!list.length){ box.innerHTML='<p class="hint">暂无备份</p>'; return; }
  var html='<table><thead><tr><th>名称</th><th>时间</th><th>路径</th><th>文件</th></tr></thead><tbody>';
  list.forEach(function(x){ html+='<tr><td>'+esc(x.name)+'</td><td>'+esc(x.mtime)+'</td><td>'+esc(x.path)+'</td><td>'+esc((x.files||[]).join(', '))+'</td></tr>'; });
  box.innerHTML=html+'</tbody></table>';
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
function saveGroupPatch(){
  var id=el('groupIdInput').value.trim();
  if(!id){ show('请先输入群号',false); return; }
  return api('/api/groups/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({patch:collectPatch('groupForm')})})
    .then(function(data){ renderGroupForm(data); show('本群配置已保存'); return loadGroups(); });
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
function reloadAll(){ return Promise.resolve().then(loadStatus).then(loadConfig).then(loadCommands).then(loadGroups).then(loadLicenses).then(loadBackups).then(function(){ show('已刷新'); }).catch(function(e){ show(e.message || e, false); }); }
function switchTab(tab){
  document.querySelectorAll('button.tab[data-tab]').forEach(function(b){ b.classList.remove('active'); });
  document.querySelectorAll('section[id^="tab-"]').forEach(function(s){ s.classList.add('hidden'); });
  var btn=document.querySelector('button.tab[data-tab="'+tab+'"]'); if(btn) btn.classList.add('active');
  var section=el('tab-'+tab); if(section) section.classList.remove('hidden');
}
function bind(){
  el('qaLink').href='/qa.html?token='+encodeURIComponent(token);
  el('queryLink').href='/query.html?token='+encodeURIComponent(token);
  document.querySelectorAll('button.tab[data-tab]').forEach(function(btn){ btn.addEventListener('click',function(){ switchTab(btn.dataset.tab); }); });
  el('refreshBtn').addEventListener('click',reloadAll);
  document.querySelectorAll('[data-save-form]').forEach(function(btn){ btn.addEventListener('click',function(){ savePatch(btn.dataset.saveForm).catch(function(e){ show(e.message,false); }); }); });
  el('loadGroupBtn').addEventListener('click',function(){ Promise.resolve(loadSelectedGroup()).catch(function(e){ show(e.message,false); }); });
  el('saveGroupBtn').addEventListener('click',function(){ Promise.resolve(saveGroupPatch()).catch(function(e){ show(e.message,false); }); });
  el('deleteGroupBtn').addEventListener('click',function(){ Promise.resolve(deleteGroupConfig()).catch(function(e){ show(e.message,false); }); });
  el('saveLicenseBtn').addEventListener('click',function(){ Promise.resolve(saveLicense()).catch(function(e){ show(e.message,false); }); });
  el('deleteLicenseBtn').addEventListener('click',function(){ Promise.resolve(deleteLicense()).catch(function(e){ show(e.message,false); }); });
  el('snapshotBtn').addEventListener('click',function(){ createBackupSnapshot().catch(function(e){ show(e.message,false); }); });
  el('loadBackupsBtn').addEventListener('click',function(){ loadBackups().catch(function(e){ show(e.message,false); }); });
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
