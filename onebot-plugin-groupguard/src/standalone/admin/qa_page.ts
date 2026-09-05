export function renderQaPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GroupGuard 问答管理</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101827;color:#e5e7eb}.wrap{max-width:1180px;margin:0 auto;padding:22px}.card{background:#172033;border:1px solid #2f3d56;border-radius:14px;padding:16px;margin-bottom:14px}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:0 0 12px}.hint{color:#93c5fd;font-size:13px}.error{color:#fca5a5}.ok{color:#86efac}button{background:#2563eb;color:white;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;font-weight:600}button.secondary{background:#334155}button.danger{background:#b91c1c}button.warn{background:#92400e}input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #40506b;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:9px;font-family:inherit}textarea{min-height:88px}.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.row>*{flex:1;min-width:190px}.row button{flex:0 0 auto}label{display:block;margin-bottom:10px}label span{display:block;font-size:13px;color:#9ca3af;margin-bottom:5px}table{width:100%;border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden}th,td{text-align:left;border-bottom:1px solid #263349;padding:8px;font-size:13px;vertical-align:top}th{color:#93c5fd;background:#111827}.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#334155;font-size:12px}.pill.off{background:#7f1d1d}.pill.on{background:#14532d}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.top{display:flex;justify-content:space-between;gap:12px;align-items:center}.link{color:#93c5fd;text-decoration:none}.reply{white-space:pre-wrap;word-break:break-word;max-width:560px}.kw{font-weight:700;color:#fde68a}.hidden{display:none}.group-table tr{cursor:pointer}.group-table tr:hover td{background:#17233a}.group-name{font-weight:700;color:#f8fafc}.muted{color:#9ca3af}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>GroupGuard 问答管理</h1><div class="hint">支持全局问答和分群问答。分群新增会自动把该群切到独立配置。</div></div><a class="link" href="/" id="backLink">返回主 WebUI</a></div>
  <div id="notice" class="card hidden"></div>
  <section class="card">
    <h2>查询范围</h2>
    <div class="row">
      <label><span>范围</span><select id="scope"><option value="global">全局问答</option><option value="group">分群问答</option></select></label>
      <label><span>群号（分群时必填）</span><input id="groupId" placeholder="例如 960957757"></label>
      <label><span>搜索关键词/回复</span><input id="searchKeyword" placeholder="留空显示全部"></label>
      <button onclick="loadQa()">读取列表</button>
    </div>
    <div id="meta" class="hint"></div>
  </section>
  <section class="card">
    <h2>已有群聊列表</h2>
    <div class="row">
      <label><span>筛选</span><select id="groupFilter" onchange="renderQaGroups()"><option value="all">全部群</option><option value="hasQa">有问答</option><option value="noQa">无问答</option><option value="licensed">已授权</option><option value="configured">有分群配置</option></select></label>
      <button class="secondary" onclick="loadQaGroups()">刷新群列表</button>
    </div>
    <div id="groupListMeta" class="hint"></div>
    <div id="groupListBox"></div>
  </section>
  <section class="card">
    <h2 id="formTitle">新增问答</h2>
    <input id="editIndex" type="hidden" value="">
    <div class="row">
      <label><span>匹配模式</span><select id="mode"><option value="exact">精确 exact</option><option value="contains">模糊 contains</option><option value="regex">正则 regex</option></select></label>
      <label><span>触发关键词</span><input id="keyword" placeholder="例如 dy"></label>
      <label><span>状态</span><select id="enabled"><option value="true">启用</option><option value="false">禁用</option></select></label>
    </div>
    <label><span>回复内容</span><textarea id="reply" placeholder="支持 {user} {group}，也可以放链接"></textarea></label>
    <div class="toolbar"><button onclick="saveQa()">保存问答</button><button class="secondary" onclick="resetForm()">取消编辑/清空</button></div>
  </section>
  <section class="card">
    <h2>问答列表</h2>
    <div id="qaBox"></div>
  </section>
</div>
<script>
let token = '';
localStorage.removeItem('GROUPGUARD_WEBUI_TOKEN');
document.getElementById('backLink').href='/';
function api(path, options){ options = options || {}; return fetch(path, { method: options.method || 'GET', body: options.body, headers: Object.assign({ 'content-type': 'application/json', 'x-groupguard-token': token }, options.headers || {}) }).then(async function(r){ var text = await r.text(); var data; try { data = JSON.parse(text); } catch(e) { data = { ok:false, error:text }; } if(!r.ok) throw new Error(data.error || text || r.statusText); return data; }); }
function show(msg, ok){ var n=document.getElementById('notice'); n.className='card ' + (ok === false ? 'error' : 'ok'); n.textContent=msg; }
function htmlEscape(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function pill(text,on){ return '<span class="pill '+(on?'on':'off')+'">'+htmlEscape(text)+'</span>'; }
function currentParams(){ return { scope:document.getElementById('scope').value, groupId:document.getElementById('groupId').value.trim(), q:document.getElementById('searchKeyword').value.trim() }; }
function apiListPath(){ var p=currentParams(); var url='/api/qa?scope='+encodeURIComponent(p.scope)+'&q='+encodeURIComponent(p.q); if(p.scope==='group') url+='&groupId='+encodeURIComponent(p.groupId); return url; }
function renderQaGroups(){ var list=window.__qaGroups||[]; var filter=document.getElementById('groupFilter').value; var rows=list.filter(function(g){ if(filter==='hasQa')return Number(g.qaCount||0)>0; if(filter==='noQa')return Number(g.qaCount||0)<=0; if(filter==='licensed')return !!g.licensed; if(filter==='configured')return !!g.configured; return true; }); document.getElementById('groupListMeta').textContent='显示 '+rows.length+' 个群 / 总计 '+list.length+' 个群'; var box=document.getElementById('groupListBox'); if(!rows.length){ box.innerHTML='<p class="hint">暂无可显示群聊</p>'; return; } var html='<table class="group-table"><thead><tr><th>群</th><th>问答</th><th>配置</th><th>授权</th><th>QA 状态</th><th>操作</th></tr></thead><tbody>'; rows.forEach(function(g){ var qaOn=g.qaEnabled!==false&&!g.disableQA; var gid=htmlEscape(g.groupId); html+='<tr data-group-id="'+gid+'" onclick="selectQaGroup(this.dataset.groupId)"><td><div class="group-name">'+htmlEscape(g.name||g.groupId)+'</div><div class="muted">'+gid+'</div></td><td>'+Number(g.qaCount||0)+'</td><td>'+(g.configured?pill('有分群配置',true):pill('走全局',false))+'</td><td>'+(g.licensed?pill('已授权',true):pill('未授权',false))+'</td><td>'+(qaOn?pill('qaEnabled',true):pill(g.disableQA?'disableQA':'qaDisabled',false))+'</td><td><button class="secondary" onclick="event.stopPropagation();selectQaGroup(this.parentNode.parentNode.dataset.groupId)">选择</button></td></tr>'; }); box.innerHTML=html+'</tbody></table>'; }
async function loadQaGroups(){ try{ var data=await api('/api/qa/groups'); window.__qaGroups=data.groups||[]; renderQaGroups(); }catch(e){ document.getElementById('groupListBox').innerHTML='<p class="error">'+htmlEscape(e.message)+'</p>'; } }
function selectQaGroup(groupId){ document.getElementById('scope').value='group'; document.getElementById('groupId').value=groupId; resetForm(); loadQa(); }
function renderQa(data){ var box=document.getElementById('qaBox'); var list=data.list||[]; document.getElementById('meta').textContent='范围：'+data.scope+(data.groupId?' / 群：'+data.groupId:'')+'，显示 '+list.length+' 条 / 总计 '+data.total+' 条'+(data.scope==='group'?'，本群 useGlobal='+data.useGlobal+'，全局问答 '+data.globalTotal+' 条':''); if(!list.length){ box.innerHTML='<p class="hint">暂无问答</p>'; return; } var html='<table><thead><tr><th>#</th><th>状态</th><th>模式</th><th>关键词</th><th>回复</th><th>操作</th></tr></thead><tbody>'; list.forEach(function(x){ var on=x.enabled!==false; html+='<tr><td>'+x.index+'</td><td><span class="pill '+(on?'on':'off')+'">'+(on?'启用':'禁用')+'</span></td><td><span class="pill">'+htmlEscape(x.mode)+'</span></td><td class="kw">'+htmlEscape(x.keyword)+'</td><td class="reply">'+htmlEscape(x.reply)+'</td><td><button class="secondary" onclick="editQa('+x.index+')">编辑</button> <button class="'+(on?'warn':'secondary')+'" onclick="toggleQa('+x.index+','+(!on)+')">'+(on?'禁用':'启用')+'</button> <button class="danger" onclick="deleteQa('+x.index+')">删除</button></td></tr>'; }); box.innerHTML=html+'</tbody></table>'; window.__qaList=list; }
async function loadQa(){ try{ var p=currentParams(); if(p.scope==='group'&&!p.groupId){show('分群问答必须填写群号',false);return;} var data=await api(apiListPath()); renderQa(data); show('问答列表已刷新'); }catch(e){show(e.message,false);} }
function resetForm(){ document.getElementById('editIndex').value=''; document.getElementById('formTitle').textContent='新增问答'; document.getElementById('mode').value='exact'; document.getElementById('enabled').value='true'; document.getElementById('keyword').value=''; document.getElementById('reply').value=''; }
function editQa(index){ var list=window.__qaList||[]; var item=list.find(function(x){return Number(x.index)===Number(index)}); if(!item)return; document.getElementById('editIndex').value=String(item.index); document.getElementById('formTitle').textContent='编辑问答 #' + item.index; document.getElementById('mode').value=item.mode||'exact'; document.getElementById('enabled').value=item.enabled===false?'false':'true'; document.getElementById('keyword').value=item.keyword||''; document.getElementById('reply').value=item.reply||''; window.scrollTo({top:0,behavior:'smooth'}); }
async function saveQa(){ try{ var p=currentParams(); if(p.scope==='group'&&!p.groupId){show('分群问答必须填写群号',false);return;} var payload={scope:p.scope,groupId:p.groupId,mode:document.getElementById('mode').value,enabled:document.getElementById('enabled').value!=='false',keyword:document.getElementById('keyword').value,reply:document.getElementById('reply').value}; var idx=document.getElementById('editIndex').value; var path=idx===''?'/api/qa':'/api/qa/'+encodeURIComponent(idx); var data=await api(path,{method:idx===''?'POST':'PUT',body:JSON.stringify(payload)}); renderQa(data); resetForm(); show(data.message||'问答已保存'); }catch(e){show(e.message,false);} }
async function toggleQa(index,enabled){ try{ var p=currentParams(); if(p.scope==='group'&&!p.groupId){show('分群问答必须填写群号',false);return;} var payload={scope:p.scope,groupId:p.groupId,enabled:enabled}; var data=await api('/api/qa/'+encodeURIComponent(index),{method:'PATCH',body:JSON.stringify(payload)}); renderQa(data); show(data.message||'状态已更新'); }catch(e){show(e.message,false);} }
async function deleteQa(index){ try{ if(!confirm('确认删除问答 #'+index+'？'))return; var p=currentParams(); var path='/api/qa/'+encodeURIComponent(index)+'?scope='+encodeURIComponent(p.scope)+'&groupId='+encodeURIComponent(p.groupId); var data=await api(path,{method:'DELETE'}); renderQa(data); show(data.message||'问答已删除'); }catch(e){show(e.message,false);} }
loadQaGroups().then(function(){ loadQa(); });
</script>
</body>
</html>`;
}
