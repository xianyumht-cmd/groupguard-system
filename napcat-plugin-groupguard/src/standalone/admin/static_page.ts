export function renderHomePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GroupGuard SnowLuma WebUI</title>
<style>
:root{color-scheme:dark light}body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101827;color:#e5e7eb}.wrap{max-width:1180px;margin:0 auto;padding:22px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.card{background:#172033;border:1px solid #2f3d56;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 12px 28px rgba(0,0,0,.18)}h1{font-size:22px;margin:0}h2{font-size:17px;margin:0 0 12px}button{background:#2563eb;color:white;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;font-weight:600}button.secondary{background:#334155}button.danger{background:#b91c1c}input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #40506b;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:9px;font-family:inherit}textarea{min-height:420px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.45}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.row>*{flex:1;min-width:220px}.row button{flex:0 0 auto}label{display:block;margin-bottom:10px}label span{display:block;font-size:13px;color:#9ca3af;margin-bottom:5px}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:10px}.switch-row input{width:auto}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.tab{background:#1f2937}.tab.active{background:#2563eb}.hidden{display:none}.status-grid{display:grid;grid-template-columns:190px 1fr;gap:8px 12px;font-size:13px}.k{color:#9ca3af}.v{word-break:break-all}.hint{color:#93c5fd;font-size:13px}.error{color:#fca5a5}.ok{color:#86efac}.footer{font-size:12px;color:#94a3b8;margin-top:18px}pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:12px;max-height:420px;overflow:auto}table{width:100%;border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden}th,td{text-align:left;border-bottom:1px solid #263349;padding:8px;font-size:13px}th{color:#93c5fd;background:#111827}.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#334155;font-size:12px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>GroupGuard SnowLuma WebUI</h1><div class="hint">用于修改 SnowLuma 独立版群管配置。保存前会自动备份。</div></div><button onclick="reloadAll()">刷新</button></div>
  <div class="tabs">
    <button class="tab active" data-tab="status">状态</button>
    <button class="tab" data-tab="switches">全局开关</button>
    <button class="tab" data-tab="groups">分群开关</button>
    <button class="tab" data-tab="licenses">授权管理</button>
    <button class="tab" data-tab="backups">备份</button>
    <button class="tab" data-tab="query">查询配置</button>
    <button class="tab" data-tab="send">发送/风控</button>
    <button class="tab" data-tab="raw">config.json</button>
    <button class="tab" data-tab="commands">动态命令</button>
  </div>
  <div id="notice" class="card hidden"></div>
  <section id="tab-status" class="card"><h2>运行状态</h2><div id="statusBox" class="status-grid"></div></section>
  <section id="tab-switches" class="card hidden"><h2>全局开关</h2><div id="switchForm" class="grid"></div><button onclick="savePatch('switchForm')">保存全局开关</button></section>
  <section id="tab-groups" class="card hidden"><h2>分群开关</h2><div class="row"><label><span>选择已有群</span><select id="groupSelect"></select></label><label><span>或输入群号</span><input id="groupIdInput" placeholder="例如 960957757"></label><button onclick="loadSelectedGroup()">读取本群</button></div><p class="hint">保存这里的开关会写入本群专属配置；点“删除本群专属配置”后，本群恢复走全局配置。</p><div id="groupMeta" class="hint"></div><h2>本群专属开关</h2><div id="groupForm" class="grid"></div><div class="toolbar"><button onclick="saveGroupPatch()">保存本群开关</button><button class="danger" onclick="deleteGroupConfig()">删除本群专属配置</button></div><h2>最终生效配置预览</h2><pre id="groupEffectiveBox"></pre></section>
  <section id="tab-licenses" class="card hidden"><h2>授权管理</h2><div class="row"><label><span>群号</span><input id="licenseGroupId" placeholder="例如 960957757"></label><label><span>授权等级</span><select id="licenseLevel"><option value="free">free</option><option value="pro" selected>pro</option><option value="enterprise">enterprise</option></select></label><label><span>授权天数（0=永久）</span><input id="licenseDays" type="number" value="30"></label><button onclick="saveLicense()">授权/续费</button><button class="danger" onclick="deleteLicense()">取消授权</button></div><p class="hint">授权天数填 0 表示永久；填 30/90/365 会从当前时间开始计算到期时间。</p><div id="licenseBox"></div></section>
  <section id="tab-backups" class="card hidden"><h2>备份</h2><div class="toolbar"><button onclick="createBackupSnapshot()">立即创建配置快照</button><button class="secondary" onclick="loadBackups()">刷新备份列表</button></div><p class="hint">当前只提供创建和查看备份，不做一键回滚，避免误恢复旧配置。</p><div id="backupBox"></div></section>
  <section id="tab-query" class="card hidden"><h2>查询配置</h2><div id="queryForm" class="grid"></div><button onclick="savePatch('queryForm')">保存查询配置</button><p class="hint">查合集当前通常由 shardQueryOutputFormat 控制；查战绩是否真正支持图片，还取决于查询链路是否实现 image 输出。</p></section>
  <section id="tab-send" class="card hidden"><h2>发送/风控配置</h2><div id="sendForm" class="grid"></div><button onclick="savePatch('sendForm')">保存发送/风控配置</button></section>
  <section id="tab-raw" class="card hidden"><h2>原始 config.json</h2><textarea id="configEditor"></textarea><div class="toolbar"><button onclick="saveRawConfig()">保存 config.json</button><button class="secondary" onclick="loadConfig()">重新加载</button></div></section>
  <section id="tab-commands" class="card hidden"><h2>动态命令 commands.json</h2><textarea id="commandsEditor"></textarea><div class="toolbar"><button onclick="saveCommands()">保存动态命令</button><button class="secondary" onclick="loadCommands()">重新加载</button></div></section>
  <div class="footer">默认仅建议在本机或内网使用。若暴露公网，请设置强 token 并限制访问来源。</div>
</div>
<script>
let token = new URL(location.href).searchParams.get('token') || localStorage.getItem('GROUPGUARD_WEBUI_TOKEN') || '';
if (!token) token = prompt('请输入 GROUPGUARD_WEBUI_TOKEN / 启动日志里的临时 token') || '';
localStorage.setItem('GROUPGUARD_WEBUI_TOKEN', token);
let config = {};
let currentGroup = null;
function api(path, options){ options = options || {}; return fetch(path, { method: options.method || 'GET', body: options.body, headers: Object.assign({ 'content-type': 'application/json', 'x-groupguard-token': token }, options.headers || {}) }).then(async function(r){ var text = await r.text(); var data; try { data = JSON.parse(text); } catch(e) { data = { ok:false, error:text }; } if(!r.ok) throw new Error(data.error || text || r.statusText); return data; }); }
function show(msg, ok){ var n=document.getElementById('notice'); n.className='card ' + (ok === false ? 'error' : 'ok'); n.textContent=msg; }
function get(obj, p, fallback){ if(!obj)return fallback; if(p.indexOf('featureSwitches.query.')===0){ var key='query.'+p.slice('featureSwitches.query.'.length); return obj.featureSwitches && obj.featureSwitches[key] !== undefined ? obj.featureSwitches[key] : fallback; } if(p.indexOf('global.featureSwitches.query.')===0){ var key2='query.'+p.slice('global.featureSwitches.query.'.length); return obj.global && obj.global.featureSwitches && obj.global.featureSwitches[key2] !== undefined ? obj.global.featureSwitches[key2] : fallback; } var cur=obj; var parts=p.split('.'); for(var i=0;i<parts.length;i++){ if(!cur || cur[parts[i]]===undefined) return fallback; cur=cur[parts[i]]; } return cur; }
function htmlEscape(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function inputHtml(label,key,value,type){ return '<label><span>'+label+'</span><input data-config-key="'+key+'" type="'+(type||'text')+'" value="'+htmlEscape(value)+'"></label>'; }
function selectHtml(label,key,value,opts){ var s='<label><span>'+label+'</span><select data-config-key="'+key+'">'; for(var i=0;i<opts.length;i++){ var o=opts[i]; s+='<option value="'+o+'" '+(String(value)===o?'selected':'')+'>'+o+'</option>'; } return s+'</select></label>'; }
function switchHtml(label,key,value){ return '<label class="switch-row"><span>'+label+'</span><input data-config-key="'+key+'" type="checkbox" '+(value?'checked':'')+'></label>'; }
document.querySelectorAll('.tab').forEach(function(btn){ btn.onclick=function(){ document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')}); btn.classList.add('active'); document.querySelectorAll('section[id^="tab-"]').forEach(function(s){s.classList.add('hidden')}); document.getElementById('tab-'+btn.dataset.tab).classList.remove('hidden'); }; });
function fieldValue(input){ if(input.type==='checkbox') return input.checked; var v=input.value.trim(); if(v==='true')return true;if(v==='false')return false;if(v==='null')return null;if(/^-?\\d+(\\.\\d+)?$/.test(v))return Number(v); if((v.startsWith('[')&&v.endsWith(']'))||(v.startsWith('{')&&v.endsWith('}'))) return JSON.parse(v); return input.value; }
function collectPatch(formId){ var patch={}; document.querySelectorAll('#'+formId+' [data-config-key]').forEach(function(i){ patch[i.dataset.configKey]=fieldValue(i); }); return patch; }
function renderStatus(status){ var box=document.getElementById('statusBox'); box.innerHTML=''; Object.entries(status).forEach(function(entry){ var a=document.createElement('div'); a.className='k'; a.textContent=entry[0]; var b=document.createElement('div'); b.className='v'; b.textContent=typeof entry[1]==='object'?JSON.stringify(entry[1]):String(entry[1]); box.append(a,b); }); }
function renderForms(){
  document.getElementById('switchForm').innerHTML = ''+
    switchHtml('总开关 masterEnabled','global.masterEnabled',get(config,'global.masterEnabled',true))+
    selectHtml('静默模式 silentMode','global.silentMode',get(config,'global.silentMode','off'),['off','noPassiveReply','noBotSend'])+
    switchHtml('主动发送 activeReplyEnabled','global.activeReplyEnabled',get(config,'global.activeReplyEnabled',true))+
    switchHtml('查询总开关 queryEnabled','global.queryEnabled',get(config,'global.queryEnabled',true))+
    switchHtml('问答总开关 qaEnabled','global.qaEnabled',get(config,'global.qaEnabled',true))+
    switchHtml('动态命令 dynamicCommandEnabled','global.dynamicCommandEnabled',get(config,'global.dynamicCommandEnabled',true))+
    switchHtml('旧问答禁用 disableQA','global.disableQA',get(config,'global.disableQA',false))+
    switchHtml('旧LOL查询禁用 disableLolQuery','global.disableLolQuery',get(config,'global.disableLolQuery',false))+
    switchHtml('查封号 query.lol_ban','global.featureSwitches.query.lol_ban',get(config,'global.featureSwitches.query.lol_ban',true))+
    switchHtml('查战绩 query.lol_battle','global.featureSwitches.query.lol_battle',get(config,'global.featureSwitches.query.lol_battle',true))+
    switchHtml('查隐藏 query.lol_hidden','global.featureSwitches.query.lol_hidden',get(config,'global.featureSwitches.query.lol_hidden',true))+
    switchHtml('查合集 query.lol_shard','global.featureSwitches.query.lol_shard',get(config,'global.featureSwitches.query.lol_shard',true));
  document.getElementById('queryForm').innerHTML = ''+
    inputHtml('LOL API Base','lolApiBaseUrl',get(config,'lolApiBaseUrl',''))+
    inputHtml('查封号主接口','lolBanPrimaryUrl',get(config,'lolBanPrimaryUrl',''))+
    inputHtml('战绩查询接口','lolQueryUrl',get(config,'lolQueryUrl',''))+
    inputHtml('战绩授权 key','lolAuthKey',get(config,'lolAuthKey',''))+
    selectHtml('战绩输出格式','global.lolQueryOutputFormat',get(config,'global.lolQueryOutputFormat','forward'),['forward','text','image','card'])+
    inputHtml('查询超时秒','global.lolQueryRequestTimeoutSeconds',get(config,'global.lolQueryRequestTimeoutSeconds',20),'number')+
    inputHtml('全局查询间隔秒','global.lolQueryGlobalMinIntervalSeconds',get(config,'global.lolQueryGlobalMinIntervalSeconds',1),'number')+
    inputHtml('群查询间隔秒','global.lolQueryGroupMinIntervalSeconds',get(config,'global.lolQueryGroupMinIntervalSeconds',2),'number')+
    selectHtml('合集输出格式','shardQueryOutputFormat',get(config,'shardQueryOutputFormat','image'),['image','text','forward','card'])+
    inputHtml('合集数据 URL','shardDataUrl',get(config,'shardDataUrl',''))+
    inputHtml('英雄列表 URL','shardHeroListUrl',get(config,'shardHeroListUrl',''));
  document.getElementById('sendForm').innerHTML = ''+
    switchHtml('发送包装 botSendWrapperEnabled','global.botSendWrapperEnabled',get(config,'global.botSendWrapperEnabled',false))+
    selectHtml('包装模式','global.botSendWrapperMode',get(config,'global.botSendWrapperMode','normal'),['normal','forward'])+
    switchHtml('问答包装','global.botSendWrapperQaEnabled',get(config,'global.botSendWrapperQaEnabled',false))+
    switchHtml('查询包装','global.botSendWrapperQueryEnabled',get(config,'global.botSendWrapperQueryEnabled',false))+
    switchHtml('全局包装','global.botSendWrapperAllEnabled',get(config,'global.botSendWrapperAllEnabled',false))+
    selectHtml('随机后缀模式','global.botAntiRiskSuffixMode',get(config,'global.botAntiRiskSuffixMode','mixed'),['mixed','punctuation','none','global'])+
    inputHtml('最小随机延迟 ms','global.randomDelayMin',get(config,'global.randomDelayMin',500),'number')+
    inputHtml('最大随机延迟 ms','global.randomDelayMax',get(config,'global.randomDelayMax',1500),'number')+
    inputHtml('全局每分钟上限','global.globalMaxPerMinute',get(config,'global.globalMaxPerMinute',60),'number')+
    inputHtml('每分钟撤回上限','global.maxRecallPerMinute',get(config,'global.maxRecallPerMinute',60),'number')+
    inputHtml('群熔断阈值','global.groupFuseThreshold',get(config,'global.groupFuseThreshold',45),'number')+
    inputHtml('群熔断冷却秒','global.groupFuseCooldownSeconds',get(config,'global.groupFuseCooldownSeconds',90),'number');
}
function renderGroupList(groups){ var sel=document.getElementById('groupSelect'); sel.innerHTML='<option value="">选择群号</option>'; groups.forEach(function(g){ var tag=(g.licensed?'授权':'未授权')+(g.configured?' / 已配置':' / 走全局'); sel.innerHTML += '<option value="'+g.groupId+'">'+g.groupId+' - '+tag+'</option>'; }); }
function renderGroupForm(data){ currentGroup=data; document.getElementById('groupIdInput').value=data.groupId; document.getElementById('groupMeta').textContent='群 '+data.groupId+'：'+(data.licensed?'已授权':'未授权')+'，'+(data.configured?'存在专属配置':'当前走全局/默认配置'); var g=data.group||{}; var e=data.effective||{}; document.getElementById('groupForm').innerHTML=''+
    switchHtml('使用全局配置 useGlobal','useGlobal',get(g,'useGlobal',false))+
    switchHtml('总开关 masterEnabled','masterEnabled',get(g,'masterEnabled',get(e,'masterEnabled',true)))+
    selectHtml('静默模式 silentMode','silentMode',get(g,'silentMode',get(e,'silentMode','off')),['off','noPassiveReply','noBotSend'])+
    switchHtml('主动发送 activeReplyEnabled','activeReplyEnabled',get(g,'activeReplyEnabled',get(e,'activeReplyEnabled',true)))+
    switchHtml('查询总开关 queryEnabled','queryEnabled',get(g,'queryEnabled',get(e,'queryEnabled',true)))+
    switchHtml('问答总开关 qaEnabled','qaEnabled',get(g,'qaEnabled',get(e,'qaEnabled',true)))+
    switchHtml('动态命令 dynamicCommandEnabled','dynamicCommandEnabled',get(g,'dynamicCommandEnabled',get(e,'dynamicCommandEnabled',true)))+
    switchHtml('旧问答禁用 disableQA','disableQA',get(g,'disableQA',get(e,'disableQA',false)))+
    switchHtml('旧LOL查询禁用 disableLolQuery','disableLolQuery',get(g,'disableLolQuery',get(e,'disableLolQuery',false)))+
    switchHtml('查封号 query.lol_ban','featureSwitches.query.lol_ban',get(g,'featureSwitches.query.lol_ban',get(e,'featureSwitches.query.lol_ban',true)))+
    switchHtml('查战绩 query.lol_battle','featureSwitches.query.lol_battle',get(g,'featureSwitches.query.lol_battle',get(e,'featureSwitches.query.lol_battle',true)))+
    switchHtml('查隐藏 query.lol_hidden','featureSwitches.query.lol_hidden',get(g,'featureSwitches.query.lol_hidden',get(e,'featureSwitches.query.lol_hidden',true)))+
    switchHtml('查合集 query.lol_shard','featureSwitches.query.lol_shard',get(g,'featureSwitches.query.lol_shard',get(e,'featureSwitches.query.lol_shard',true)))+
    switchHtml('问答包装 botSendWrapperQaEnabled','botSendWrapperQaEnabled',get(g,'botSendWrapperQaEnabled',get(e,'botSendWrapperQaEnabled',false)))+
    switchHtml('查询包装 botSendWrapperQueryEnabled','botSendWrapperQueryEnabled',get(g,'botSendWrapperQueryEnabled',get(e,'botSendWrapperQueryEnabled',false)))+
    switchHtml('全局包装 botSendWrapperAllEnabled','botSendWrapperAllEnabled',get(g,'botSendWrapperAllEnabled',get(e,'botSendWrapperAllEnabled',false)))+
    selectHtml('战绩输出格式','lolQueryOutputFormat',get(g,'lolQueryOutputFormat',get(e,'lolQueryOutputFormat','forward')),['forward','text','image','card']);
  document.getElementById('groupEffectiveBox').textContent=JSON.stringify(data.effective||{},null,2);
}
function renderLicenses(list){ var box=document.getElementById('licenseBox'); if(!list.length){ box.innerHTML='<p class="hint">暂无授权记录</p>'; return; } var html='<table><thead><tr><th>群号</th><th>等级</th><th>到期</th><th>剩余</th><th>状态</th><th>操作</th></tr></thead><tbody>'; list.forEach(function(x){ html+='<tr><td>'+x.groupId+'</td><td>'+x.level+'</td><td>'+htmlEscape(x.expireAt)+'</td><td>'+(x.permanent?'永久':x.remainingDays+'天')+'</td><td>'+(x.expired?'<span class="pill">已过期</span>':'<span class="pill">有效</span>')+'</td><td><button class="secondary" onclick="fillLicense(\''+x.groupId+'\',\''+x.level+'\')">填入</button></td></tr>'; }); box.innerHTML=html+'</tbody></table>'; }
function fillLicense(groupId,level){ document.getElementById('licenseGroupId').value=groupId; document.getElementById('licenseLevel').value=level||'pro'; }
function renderBackups(list){ var box=document.getElementById('backupBox'); if(!list.length){ box.innerHTML='<p class="hint">暂无备份</p>'; return; } var html='<table><thead><tr><th>名称</th><th>时间</th><th>路径</th><th>文件</th></tr></thead><tbody>'; list.forEach(function(x){ html+='<tr><td>'+htmlEscape(x.name)+'</td><td>'+htmlEscape(x.mtime)+'</td><td>'+htmlEscape(x.path)+'</td><td>'+htmlEscape((x.files||[]).join(', '))+'</td></tr>'; }); box.innerHTML=html+'</tbody></table>'; }
async function loadStatus(){ renderStatus(await api('/api/status')); }
async function loadConfig(){ var data=await api('/api/config'); config=data.config; document.getElementById('configEditor').value=JSON.stringify(config,null,2); renderForms(); }
async function loadCommands(){ var data=await api('/api/dynamic-commands'); document.getElementById('commandsEditor').value=JSON.stringify(data.config,null,2); }
async function loadGroups(){ var data=await api('/api/groups'); renderGroupList(data.groups||[]); }
async function loadLicenses(){ var data=await api('/api/licenses'); renderLicenses(data.licenses||[]); }
async function loadBackups(){ var data=await api('/api/backups'); renderBackups(data.backups||[]); }
async function loadSelectedGroup(){ var id=document.getElementById('groupIdInput').value.trim() || document.getElementById('groupSelect').value; if(!id){show('请先选择或输入群号',false);return;} var data=await api('/api/groups/'+encodeURIComponent(id)); renderGroupForm(data); }
async function savePatch(formId){ try{ var res=await api('/api/config/patch',{method:'POST',body:JSON.stringify({patch:collectPatch(formId)})}); show(res.message||'保存成功'); await loadConfig(); await loadStatus(); }catch(e){show(e.message,false);} }
async function saveGroupPatch(){ try{ var id=document.getElementById('groupIdInput').value.trim(); if(!id){show('请先输入群号',false);return;} var data=await api('/api/groups/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify({patch:collectPatch('groupForm')})}); renderGroupForm(data); await loadGroups(); show('本群开关已保存'); }catch(e){show(e.message,false);} }
async function deleteGroupConfig(){ try{ var id=document.getElementById('groupIdInput').value.trim(); if(!id){show('请先输入群号',false);return;} if(!confirm('确认删除 '+id+' 的本群专属配置？删除后该群走全局配置。'))return; var data=await api('/api/groups/'+encodeURIComponent(id),{method:'DELETE'}); renderGroupForm(data); await loadGroups(); show('本群专属配置已删除'); }catch(e){show(e.message,false);} }
async function saveLicense(){ try{ var id=document.getElementById('licenseGroupId').value.trim(); if(!id){show('请先输入群号',false);return;} var days=Number(document.getElementById('licenseDays').value||0); var payload={level:document.getElementById('licenseLevel').value, permanent:days<=0, days:days}; var res=await api('/api/licenses/'+encodeURIComponent(id),{method:'POST',body:JSON.stringify(payload)}); show(res.message||'授权已保存'); await loadLicenses(); await loadGroups(); }catch(e){show(e.message,false);} }
async function deleteLicense(){ try{ var id=document.getElementById('licenseGroupId').value.trim(); if(!id){show('请先输入群号',false);return;} if(!confirm('确认取消 '+id+' 的授权？'))return; var res=await api('/api/licenses/'+encodeURIComponent(id),{method:'DELETE'}); show(res.message||'授权已取消'); await loadLicenses(); await loadGroups(); }catch(e){show(e.message,false);} }
async function createBackupSnapshot(){ try{ var res=await api('/api/backups/snapshot',{method:'POST',body:'{}'}); show(res.message||'快照已创建'); await loadBackups(); }catch(e){show(e.message,false);} }
async function saveRawConfig(){ try{ var parsed=JSON.parse(document.getElementById('configEditor').value); var res=await api('/api/config',{method:'POST',body:JSON.stringify({config:parsed})}); show(res.message||'保存成功'); await loadConfig(); await loadStatus(); await loadGroups(); await loadLicenses(); }catch(e){show(e.message,false);} }
async function saveCommands(){ try{ var parsed=JSON.parse(document.getElementById('commandsEditor').value); var res=await api('/api/dynamic-commands',{method:'POST',body:JSON.stringify({config:parsed})}); show(res.message||'保存成功'); await loadCommands(); await loadStatus(); }catch(e){show(e.message,false);} }
async function reloadAll(){ try{ await loadStatus(); await loadConfig(); await loadCommands(); await loadGroups(); await loadLicenses(); await loadBackups(); show('已刷新'); }catch(e){show(e.message,false);} }
document.getElementById('groupSelect').addEventListener('change',function(){ if(this.value) document.getElementById('groupIdInput').value=this.value; });
reloadAll();
</script>
</body>
</html>`;
}
