export function renderGroupFileMirrorPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>群文件搬运设置</title>
<style>
:root{color-scheme:dark;--bg:#08111f;--card:rgba(20,33,55,.78);--line:rgba(148,163,184,.2);--text:#eef4ff;--muted:#9fb0c8;--blue:#4f8cff;--green:#39d98a;--red:#ff647c;--shadow:0 22px 55px rgba(0,0,0,.3)}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{margin:0;min-height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--text);background:radial-gradient(circle at 15% 5%,rgba(79,140,255,.22),transparent 34%),radial-gradient(circle at 90% 10%,rgba(57,217,138,.12),transparent 28%),linear-gradient(180deg,#0b1628 0%,#07101d 100%)}
.wrap{width:min(1120px,100%);margin:0 auto;padding:22px max(16px,env(safe-area-inset-right)) 44px max(16px,env(safe-area-inset-left))}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}.title h1{margin:0 0 6px;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em}.title p{margin:0;color:var(--muted);line-height:1.65}.glass{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}.card{padding:18px;margin-bottom:15px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.button,button{appearance:none;border:0;border-radius:13px;padding:11px 16px;background:linear-gradient(135deg,#4f8cff,#376ee8);color:white;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 8px 20px rgba(55,110,232,.24)}button.secondary,.button.secondary{background:rgba(71,85,105,.7);box-shadow:none}button.danger{background:rgba(190,55,75,.88);box-shadow:none}button:disabled{opacity:.55;cursor:not-allowed}.notice{display:none;padding:13px 15px;border-radius:14px;margin-bottom:15px;line-height:1.55}.notice.ok{display:block;background:rgba(57,217,138,.12);border:1px solid rgba(57,217,138,.35);color:#a7f3d0}.notice.error{display:block;background:rgba(255,100,124,.12);border:1px solid rgba(255,100,124,.38);color:#fecdd3}
.switchline{display:flex;align-items:center;justify-content:space-between;gap:16px}.switchcopy strong{font-size:17px}.switchcopy small{display:block;color:var(--muted);margin-top:5px;line-height:1.55}.switch{position:relative;width:54px;height:31px;flex:0 0 auto}.switch input{position:absolute;opacity:0;pointer-events:none}.slider{position:absolute;inset:0;border-radius:999px;background:#37465d;transition:.2s}.slider:before{content:"";position:absolute;width:25px;height:25px;left:3px;top:3px;border-radius:50%;background:white;box-shadow:0 3px 10px rgba(0,0,0,.35);transition:.2s}.switch input:checked+.slider{background:var(--green)}.switch input:checked+.slider:before{transform:translateX(23px)}
.flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-top:14px}.step{position:relative;padding:13px 11px;border-radius:14px;background:rgba(8,17,31,.62);border:1px solid var(--line);font-size:13px;line-height:1.5;color:#d9e7fb}.step b{display:flex;width:25px;height:25px;border-radius:50%;align-items:center;justify-content:center;background:rgba(79,140,255,.2);color:#a9c7ff;margin-bottom:8px}.step:not(:last-child):after{content:"›";position:absolute;right:-8px;top:50%;transform:translateY(-50%);font-size:22px;color:#7184a2;z-index:2}
.sectionhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.sectionhead h2{margin:0;font-size:19px}.summary{color:var(--muted);font-size:13px}.rules{display:grid;gap:14px}.rule{padding:17px}.rulehead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.rulehead h3{margin:0;font-size:17px}.rulegrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:block}.field.full{grid-column:1/-1}.field span{display:block;color:#c7d7ed;font-size:13px;margin-bottom:6px}.field small{display:block;color:var(--muted);font-size:12px;margin-top:6px;line-height:1.5}input,select{width:100%;border:1px solid rgba(148,163,184,.26);background:rgba(5,13,25,.74);color:var(--text);border-radius:12px;padding:11px 12px;font:inherit;outline:none}input:focus,select:focus{border-color:rgba(79,140,255,.8);box-shadow:0 0 0 3px rgba(79,140,255,.13)}.mini-switch{display:flex;align-items:center;gap:9px;color:#dbeafe;font-size:13px}.mini-switch input{width:18px;height:18px}.fixed{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:13px}.fixed span{padding:9px 10px;border-radius:11px;background:rgba(57,217,138,.09);border:1px solid rgba(57,217,138,.22);font-size:12px;color:#b8f5d5}.statusbox{margin-top:13px;padding:12px;border-radius:13px;background:rgba(5,13,25,.6);border:1px solid var(--line);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;font-size:12px}.statusbox .k{color:var(--muted)}.statusbox .v{color:#e4edfa;word-break:break-all}.statusbox .wide{grid-column:1/-1}.empty{text-align:center;padding:34px 16px;color:var(--muted)}details{margin-top:13px;border-top:1px solid var(--line);padding-top:11px}summary{cursor:pointer;color:#b8c9df;font-size:13px}.bottom{position:sticky;bottom:10px;z-index:5;padding:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:16px}.bottom .tip{color:var(--muted);font-size:12px;line-height:1.45}.loading{opacity:.64;pointer-events:none}
@media(max-width:780px){.top{flex-direction:column}.flow{grid-template-columns:1fr}.step:not(:last-child):after{content:"↓";right:auto;left:50%;top:auto;bottom:-19px;transform:translateX(-50%)}.rulegrid,.fixed,.statusbox{grid-template-columns:1fr}.field.full,.statusbox .wide{grid-column:auto}.bottom{align-items:stretch;flex-direction:column}.bottom button{width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="title"><h1>群文件搬运</h1><p>机器人发现来源群的新文件后，自动上传到接收群。所有页面文字和操作提示均使用中文。</p></div>
    <a class="button secondary" id="homeLink" href="/">返回控制台</a>
  </div>

  <div id="notice" class="notice"></div>

  <section class="glass card">
    <div class="switchline">
      <div class="switchcopy"><strong>群文件搬运总开关</strong><small>关闭时保留全部规则和运行记录，但不会处理新文件。</small></div>
      <label class="switch"><input id="totalEnabled" type="checkbox"><span class="slider"></span></label>
    </div>
    <div class="flow">
      <div class="step"><b>1</b>新文件成功上传到接收群</div>
      <div class="step"><b>2</b>撤回接收群上一份文件消息</div>
      <div class="step"><b>3</b>删除接收群上一份群文件</div>
      <div class="step"><b>4</b>接收群只保留最新文件</div>
      <div class="step"><b>5</b>来源群撤回时同步清理</div>
    </div>
  </section>

  <section class="glass card">
    <div class="sectionhead"><div><h2>搬运规则</h2><div id="summary" class="summary">正在读取...</div></div><button id="addRuleBtn">添加搬运规则</button></div>
    <div id="rules" class="rules"></div>
  </section>

  <div class="glass bottom">
    <div class="tip">保存后立即生效，不需要重启。第一次测试请等待来源群出现一个新文件。</div>
    <div class="toolbar"><button class="secondary" id="refreshBtn">刷新状态</button><button id="saveBtn">保存全部设置</button></div>
  </div>
</div>
<script>
(function(){
var token='';
localStorage.removeItem('GROUPGUARD_WEBUI_TOKEN');
document.getElementById('homeLink').href='/';
var editor={enabled:false,rules:[]};
var statuses={};
var busy=false;

function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function api(path,options){options=options||{};return fetch(path,{method:options.method||'GET',headers:Object.assign({'content-type':'application/json','x-groupguard-token':token},options.headers||{}),body:options.body}).then(async function(response){var text=await response.text();var data;try{data=JSON.parse(text)}catch(e){data={ok:false,error:text}}if(!response.ok)throw new Error(data.error||'操作失败');return data})}
function show(message,ok){var box=document.getElementById('notice');box.className='notice '+(ok===false?'error':'ok');box.textContent=message;window.scrollTo({top:0,behavior:'smooth'})}
function setBusy(value){busy=value;document.body.classList.toggle('loading',value);document.getElementById('saveBtn').disabled=value;document.getElementById('refreshBtn').disabled=value}
function fmtTime(value){var n=Number(value||0);return n?new Date(n).toLocaleString('zh-CN',{hour12:false}):'暂无'}
function fmtSize(value){var n=Number(value||0);if(!n)return '暂无';if(n<1024)return n+' 字节';if(n<1024*1024)return (n/1024).toFixed(1)+' KB';return (n/1024/1024).toFixed(2)+' MB'}
function defaultRule(){return {name:'搬运规则 '+(editor.rules.length+1),enabled:true,sourceGroupId:'',targetGroupId:'',sourceUploaderText:'',fileMode:'sevenZip',customPattern:'',maxFileSizeMb:512,targetFolderId:'/'}}
function statusFor(name){return statuses[name]||{currentFileName:'',currentFileSize:0,mirroredAt:0,lastSuccessAt:0,lastErrorAt:0,lastError:'',pendingCleanupCount:0}}
function modeOptions(value){var items=[['all','所有文件'],['sevenZip','仅 7Z 压缩包'],['archive','常见压缩包（7Z、ZIP、RAR）'],['custom','自定义文件规则']];return items.map(function(item){return '<option value="'+item[0]+'"'+(value===item[0]?' selected':'')+'>'+item[1]+'</option>'}).join('')}
function renderRule(rule,index){var status=statusFor(rule.name);var custom=rule.fileMode==='custom';return '<article class="glass rule" data-rule="'+index+'">'
+'<div class="rulehead"><h3>'+escapeHtml(rule.name||('搬运规则 '+(index+1)))+'</h3><div class="toolbar"><label class="mini-switch"><input type="checkbox" data-index="'+index+'" data-field="enabled"'+(rule.enabled!==false?' checked':'')+'>启用此规则</label><button class="danger" data-delete="'+index+'">删除</button></div></div>'
+'<div class="rulegrid">'
+'<label class="field full"><span>规则名称</span><input data-index="'+index+'" data-field="name" value="'+escapeHtml(rule.name)+'" placeholder="例如：软件包搬运"></label>'
+'<label class="field"><span>来源群号</span><input inputmode="numeric" data-index="'+index+'" data-field="sourceGroupId" value="'+escapeHtml(rule.sourceGroupId)+'" placeholder="填写发现新文件的群号"></label>'
+'<label class="field"><span>接收群号</span><input inputmode="numeric" data-index="'+index+'" data-field="targetGroupId" value="'+escapeHtml(rule.targetGroupId)+'" placeholder="填写接收文件的群号"></label>'
+'<label class="field full"><span>只搬运这些 QQ 上传的文件</span><input data-index="'+index+'" data-field="sourceUploaderText" value="'+escapeHtml(rule.sourceUploaderText)+'" placeholder="填写上传文件机器人的 QQ；多个 QQ 用逗号分开"><small>留空表示搬运来源群内所有人上传的匹配文件。</small></label>'
+'<label class="field"><span>搬运哪些文件</span><select data-index="'+index+'" data-field="fileMode">'+modeOptions(rule.fileMode)+'</select></label>'
+'<label class="field"><span>单个文件最大大小</span><input type="number" min="1" max="4096" data-index="'+index+'" data-field="maxFileSizeMb" value="'+escapeHtml(rule.maxFileSizeMb||512)+'"><small>单位：MB，最大可填 4096。</small></label>'
+(custom?'<label class="field full"><span>自定义文件名匹配规则</span><input data-index="'+index+'" data-field="customPattern" value="'+escapeHtml(rule.customPattern)+'" placeholder="例如：\\.(apk|exe)$"><small>这是高级设置，用于按文件名后缀或名称筛选。</small></label>':'')
+'</div>'
+'<details><summary>更多设置</summary><div class="rulegrid" style="margin-top:12px"><label class="field full"><span>接收群文件夹位置</span><input data-index="'+index+'" data-field="targetFolderId" value="'+escapeHtml(rule.targetFolderId||'/')+'"><small>根目录保持“/”即可，只有明确知道群文件夹编号时才修改。</small></label></div></details>'
+'<div class="fixed"><span>✓ 新文件成功后再删除旧文件</span><span>✓ 自动撤回旧文件消息</span><span>✓ 自动删除旧群文件</span><span>✓ 来源撤回时同步清理</span></div>'
+'<div class="statusbox"><div><span class="k">当前最新文件</span><div class="v">'+escapeHtml(status.currentFileName||'暂无')+'</div></div><div><span class="k">文件大小</span><div class="v">'+fmtSize(status.currentFileSize)+'</div></div><div><span class="k">最近搬运成功</span><div class="v">'+fmtTime(status.lastSuccessAt||status.mirroredAt)+'</div></div><div><span class="k">等待清理数量</span><div class="v">'+Number(status.pendingCleanupCount||0)+'</div></div><div class="wide"><span class="k">最近错误</span><div class="v">'+escapeHtml(status.lastError||'暂无')+(status.lastErrorAt?'（'+fmtTime(status.lastErrorAt)+'）':'')+'</div></div></div>'
+'</article>'}
function render(){document.getElementById('totalEnabled').checked=editor.enabled===true;document.getElementById('summary').textContent='共 '+editor.rules.length+' 条规则，其中 '+editor.rules.filter(function(rule){return rule.enabled!==false}).length+' 条已启用';var box=document.getElementById('rules');box.innerHTML=editor.rules.length?editor.rules.map(renderRule).join(''):'<div class="empty">还没有搬运规则，点击“添加搬运规则”开始设置。</div>'}
function updateField(target){var index=Number(target.getAttribute('data-index'));var field=target.getAttribute('data-field');if(!Number.isInteger(index)||!editor.rules[index]||!field)return;var value=target.type==='checkbox'?target.checked:target.value;if(field==='maxFileSizeMb')value=Number(value||512);editor.rules[index][field]=value;if(field==='name'||field==='fileMode')render()}
async function load(){setBusy(true);try{var data=await api('/api/group-file-mirror');editor=data.editor||{enabled:false,rules:[]};statuses={};(data.statuses||[]).forEach(function(item){statuses[item.name]=item});render()}catch(error){show('读取失败：'+String(error.message||error),false)}finally{setBusy(false)}}
async function save(){setBusy(true);try{var data=await api('/api/group-file-mirror',{method:'POST',body:JSON.stringify({config:editor})});editor=data.editor||editor;statuses={};(data.statuses||[]).forEach(function(item){statuses[item.name]=item});render();show(data.message||'群文件搬运设置已保存。',true)}catch(error){show('保存失败：'+String(error.message||error),false)}finally{setBusy(false)}}

document.getElementById('totalEnabled').addEventListener('change',function(event){editor.enabled=event.target.checked});
document.getElementById('addRuleBtn').addEventListener('click',function(){editor.rules.push(defaultRule());render();setTimeout(function(){var cards=document.querySelectorAll('[data-rule]');if(cards.length)cards[cards.length-1].scrollIntoView({behavior:'smooth',block:'center'})},0)});
document.getElementById('rules').addEventListener('input',function(event){updateField(event.target)});
document.getElementById('rules').addEventListener('change',function(event){updateField(event.target)});
document.getElementById('rules').addEventListener('click',function(event){var button=event.target.closest('[data-delete]');if(!button)return;var index=Number(button.getAttribute('data-delete'));if(!Number.isInteger(index)||!editor.rules[index])return;if(confirm('确定删除规则“'+(editor.rules[index].name||'未命名规则')+'”吗？')){editor.rules.splice(index,1);render()}});
document.getElementById('refreshBtn').addEventListener('click',load);
document.getElementById('saveBtn').addEventListener('click',save);
load();
})();
</script>
</body>
</html>`;
}
