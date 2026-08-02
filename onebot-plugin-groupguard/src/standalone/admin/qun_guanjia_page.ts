export function renderQunGuanjiaPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Q群管家发送通道</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101827;color:#e5e7eb;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:980px;margin:0 auto;padding:22px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px}.card{background:#172033;border:1px solid #2f3d56;border-radius:14px;padding:16px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.row>*{flex:1;min-width:210px}.row button{flex:0 0 auto}label{display:block}label span{display:block;color:#9ca3af;font-size:13px;margin-bottom:5px}input,select,textarea{width:100%;border:1px solid #40506b;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:9px}textarea{min-height:110px}button,a.button{background:#2563eb;color:#fff;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;text-decoration:none;font-weight:600;display:inline-block}.secondary{background:#334155!important}.danger{background:#b91c1c!important}.switch{display:flex;gap:10px;align-items:center;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:11px}.switch input{width:auto}.hint{color:#93c5fd;font-size:13px}.muted{color:#94a3b8;font-size:12px}.ok{color:#86efac}.error{color:#fca5a5}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:12px}.status{display:grid;grid-template-columns:180px 1fr;gap:8px 12px;font-size:13px}.status .k{color:#9ca3af}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>Q群管家发送通道</h1><div class="hint">让纯文本回复显示为 Q群管家发送。默认关闭，失败可自动降级普通机器人发送。</div></div><a class="button secondary" id="homeLink" href="/">返回控制台</a></div>
  <div id="notice" class="card" style="display:none"></div>

  <section class="card">
    <h2>配置范围</h2>
    <div class="row">
      <label><span>配置范围</span><select id="scope"><option value="global">全局默认</option><option value="group">指定群</option></select></label>
      <label><span>群号</span><input id="groupId" placeholder="例如 960957757"></label>
      <button id="loadBtn">读取配置</button>
    </div>
    <p class="muted">分群配置保存后会设置 useGlobal=false；其他未覆盖字段仍按当前插件的分群合并规则生效。</p>
  </section>

  <section class="card">
    <h2>发送通道</h2>
    <div class="grid">
      <label class="switch"><input id="enabled" type="checkbox"><span>启用 Q群管家通道</span></label>
      <label><span>发送模式</span><select id="mode"><option value="auto">自动：优先群管家，失败降级</option><option value="guanjia">强制：只用群管家</option><option value="bot">普通：只用机器人</option></select></label>
      <label class="switch"><input id="fallbackToBot" type="checkbox" checked><span>失败后降级普通机器人</span></label>
      <label class="switch"><input id="textOnly" type="checkbox" checked disabled><span>仅纯文本（第一版固定）</span></label>
      <label><span>首次采集 token 超时（毫秒）</span><input id="timeoutMs" type="number" min="5000" max="60000" value="20000"></label>
    </div>
    <h3>允许使用的功能</h3>
    <div class="grid">
      <label class="switch"><input id="featureQa" type="checkbox" checked><span>问答回复</span></label>
      <label class="switch"><input id="featureQuery" type="checkbox" checked><span>查询结果</span></label>
      <label class="switch"><input id="featureDynamic" type="checkbox" checked><span>动态命令</span></label>
      <label class="switch"><input id="featureSystem" type="checkbox"><span>系统提示</span></label>
    </div>
    <div class="toolbar"><button id="saveBtn">保存配置</button><button class="secondary" id="refreshStatusBtn">刷新状态</button></div>
  </section>

  <section class="card">
    <h2>当前群状态</h2>
    <div id="statusBox" class="status"></div>
    <div class="toolbar"><button class="danger" id="clearTokenBtn">清除并重新采集 token</button></div>
    <p class="muted">token 只保存在插件数据目录，不会显示在页面。首次测试可能短暂发送一条 @Q群管家 的探测消息，插件会尝试自动撤回。</p>
  </section>

  <section class="card">
    <h2>测试代发</h2>
    <label><span>测试文本</span><textarea id="testText">Q群管家通道测试成功</textarea></label>
    <div class="toolbar"><button id="testBtn">通过 Q群管家发送</button></div>
    <pre id="testResult">尚未测试</pre>
  </section>

  <section class="card">
    <h2>使用条件</h2>
    <div class="hint">群内已添加 Q群管家；机器人 QQ 为群管理员或群主；当前宿主 Profile 已启用 Q群管家所需的 Cookie 与群消息历史能力。</div>
  </section>
</div>
<script>
var token = new URL(location.href).searchParams.get('token') || localStorage.getItem('GROUPGUARD_WEBUI_TOKEN') || '';
if (!token) token = prompt('请输入 GROUPGUARD_WEBUI_TOKEN / 启动日志里的临时 token') || '';
localStorage.setItem('GROUPGUARD_WEBUI_TOKEN', token);
document.getElementById('homeLink').href = '/?token=' + encodeURIComponent(token);
var config = {};
function api(path, options){ options=options||{}; return fetch(path,{method:options.method||'GET',body:options.body,headers:Object.assign({'content-type':'application/json','x-groupguard-token':token},options.headers||{})}).then(async function(r){var text=await r.text();var data;try{data=JSON.parse(text)}catch(e){data={ok:false,error:text}}if(!r.ok)throw new Error(data.error||text||r.statusText);return data}) }
function show(message, ok){var box=document.getElementById('notice');box.style.display='block';box.className='card '+(ok===false?'error':'ok');box.textContent=message}
function gid(){return document.getElementById('groupId').value.trim()}
function currentScope(){return document.getElementById('scope').value}
function defaults(){return {enabled:false,mode:'auto',fallbackToBot:true,textOnly:true,timeoutMs:20000,allowedFeatures:['qa','dynamicCommand','query']}}
function normalize(raw){var d=defaults();raw=raw&&typeof raw==='object'?raw:{};return {enabled:raw.enabled===true,mode:['bot','guanjia','auto'].indexOf(raw.mode)>=0?raw.mode:d.mode,fallbackToBot:raw.fallbackToBot!==false,textOnly:true,timeoutMs:Number(raw.timeoutMs)||d.timeoutMs,allowedFeatures:Array.isArray(raw.allowedFeatures)?raw.allowedFeatures:d.allowedFeatures}}
function applyForm(value){var v=normalize(value);document.getElementById('enabled').checked=v.enabled;document.getElementById('mode').value=v.mode;document.getElementById('fallbackToBot').checked=v.fallbackToBot;document.getElementById('timeoutMs').value=v.timeoutMs;document.getElementById('featureQa').checked=v.allowedFeatures.indexOf('qa')>=0;document.getElementById('featureQuery').checked=v.allowedFeatures.indexOf('query')>=0;document.getElementById('featureDynamic').checked=v.allowedFeatures.indexOf('dynamicCommand')>=0||v.allowedFeatures.indexOf('dynamic')>=0;document.getElementById('featureSystem').checked=v.allowedFeatures.indexOf('system')>=0}
function collect(){var features=[];if(document.getElementById('featureQa').checked)features.push('qa');if(document.getElementById('featureQuery').checked)features.push('query');if(document.getElementById('featureDynamic').checked)features.push('dynamicCommand');if(document.getElementById('featureSystem').checked)features.push('system');return {enabled:document.getElementById('enabled').checked,mode:document.getElementById('mode').value,fallbackToBot:document.getElementById('fallbackToBot').checked,textOnly:true,timeoutMs:Math.max(5000,Math.min(60000,Number(document.getElementById('timeoutMs').value)||20000)),allowedFeatures:features}}
async function loadConfig(){var data=await api('/api/config');config=data.config||{};var scope=currentScope();var group=gid();if(scope==='group'&&!/^\\d+$/.test(group)){applyForm(defaults());show('请输入有效群号后读取分群配置。',false);return}var value=scope==='global'?config.global&&config.global.qunGuanjia:config.groups&&config.groups[group]&&config.groups[group].qunGuanjia;if(!value&&scope==='group')value=config.global&&config.global.qunGuanjia;applyForm(value||defaults());await loadStatus()}
async function saveConfig(){var scope=currentScope();var group=gid();if(scope==='group'&&!/^\\d+$/.test(group)){show('请输入有效群号。',false);return}var patch={};if(scope==='global'){patch['global.qunGuanjia']=collect()}else{patch['groups.'+group+'.useGlobal']=false;patch['groups.'+group+'.qunGuanjia']=collect()}await api('/api/config/patch',{method:'POST',body:JSON.stringify({patch:patch})});show(scope==='global'?'全局 Q群管家通道配置已保存。':'本群 Q群管家通道配置已保存。',true);await loadConfig()}
function fmtTime(v){var n=Number(v||0);return n?new Date(n).toLocaleString():'—'}
async function loadStatus(){var group=gid();var box=document.getElementById('statusBox');if(!/^\\d+$/.test(group)){box.innerHTML='<div class="k">提示</div><div>输入群号后可查看 token 与测试状态。</div>';return}try{var data=await api('/api/qun-guanjia/status?groupId='+encodeURIComponent(group));var s=data.status||{};var rows=[['群号',s.groupId||group],['功能启用',s.enabled?'是':'否'],['模式',s.mode||'auto'],['token',s.hasToken?'已获取':'未获取'],['token 更新时间',fmtTime(s.tokenUpdatedAt)],['最近成功',fmtTime(s.lastSuccessAt)],['最近失败',fmtTime(s.lastErrorAt)],['当前忙碌',s.busy?'是':'否'],['最近错误',s.lastError||'—']];box.innerHTML=rows.map(function(r){return '<div class="k">'+r[0]+'</div><div>'+String(r[1]).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>'}).join('')}catch(e){box.innerHTML='<div class="k">错误</div><div class="error">'+String(e.message||e)+'</div>'}}
async function clearToken(){var group=gid();if(!/^\\d+$/.test(group)){show('请输入有效群号。',false);return}await api('/api/qun-guanjia/token/clear',{method:'POST',body:JSON.stringify({groupId:group})});show('本群 token 已清除，下次发送会自动重新采集。',true);await loadStatus()}
async function testSend(){var group=gid();var text=document.getElementById('testText').value;if(!/^\\d+$/.test(group)){show('请输入有效群号。',false);return}if(!text.trim()){show('测试文本不能为空。',false);return}var result=document.getElementById('testResult');result.textContent='正在执行首次 token 采集与代发…';try{var data=await api('/api/qun-guanjia/test',{method:'POST',body:JSON.stringify({groupId:group,text:text})});result.textContent=JSON.stringify(data,null,2);show('Q群管家测试发送成功。',true)}catch(e){result.textContent=String(e.message||e);show('测试失败：'+String(e.message||e),false)}await loadStatus()}
document.getElementById('loadBtn').onclick=loadConfig;document.getElementById('saveBtn').onclick=saveConfig;document.getElementById('refreshStatusBtn').onclick=loadStatus;document.getElementById('clearTokenBtn').onclick=clearToken;document.getElementById('testBtn').onclick=testSend;document.getElementById('scope').onchange=function(){document.getElementById('groupId').disabled=currentScope()==='global';loadConfig().catch(function(e){show(String(e.message||e),false)})};document.getElementById('groupId').disabled=true;
loadConfig().catch(function(e){show(String(e.message||e),false)});
</script>
</body>
</html>`;
}
