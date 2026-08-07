export function renderTargetFilePushPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>定向文件推送</title>
<style>
:root{color-scheme:dark;--bg:#08111f;--card:rgba(20,33,55,.78);--line:rgba(148,163,184,.2);--text:#eef4ff;--muted:#9fb0c8;--blue:#4f8cff;--green:#39d98a;--red:#ff647c;--amber:#f4b942;--shadow:0 22px 55px rgba(0,0,0,.3)}
*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{margin:0;min-height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--text);background:radial-gradient(circle at 15% 5%,rgba(79,140,255,.22),transparent 34%),linear-gradient(180deg,#0b1628 0%,#07101d 100%)}
.wrap{width:min(1060px,100%);margin:auto;padding:22px 16px 44px}.top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px}.title h1{margin:0 0 6px;font-size:clamp(24px,4vw,34px)}.title p{margin:0;color:var(--muted);line-height:1.65}.glass{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}.card{padding:18px;margin-bottom:15px}.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center}.button,button{appearance:none;border:0;border-radius:13px;padding:11px 16px;background:linear-gradient(135deg,#4f8cff,#376ee8);color:white;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}.secondary{background:rgba(71,85,105,.72);box-shadow:none}.danger{background:rgba(190,55,75,.88)}button:disabled{opacity:.55;cursor:not-allowed}.notice{display:none;padding:13px 15px;border-radius:14px;margin-bottom:15px;line-height:1.55}.notice.ok{display:block;background:rgba(57,217,138,.12);border:1px solid rgba(57,217,138,.35);color:#a7f3d0}.notice.error{display:block;background:rgba(255,100,124,.12);border:1px solid rgba(255,100,124,.38);color:#fecdd3}.switchline{display:flex;justify-content:space-between;gap:16px;align-items:center}.switchcopy small{display:block;color:var(--muted);margin-top:5px}.switch{position:relative;width:54px;height:31px}.switch input{position:absolute;opacity:0}.slider{position:absolute;inset:0;border-radius:999px;background:#37465d}.slider:before{content:"";position:absolute;width:25px;height:25px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}.switch input:checked+.slider{background:var(--green)}.switch input:checked+.slider:before{transform:translateX(23px)}
.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:15px}.step{padding:12px;border-radius:13px;background:rgba(8,17,31,.62);border:1px solid var(--line);font-size:12px;line-height:1.55}.step b{display:block;color:#a9c7ff;margin-bottom:4px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:block}.field.full{grid-column:1/-1}.field span{display:block;color:#c7d7ed;font-size:13px;margin-bottom:6px}.field small{display:block;color:var(--muted);font-size:12px;margin-top:6px;line-height:1.5}input{width:100%;border:1px solid rgba(148,163,184,.26);background:rgba(5,13,25,.74);color:var(--text);border-radius:12px;padding:11px 12px;font:inherit;outline:none}input:focus{border-color:rgba(79,140,255,.8);box-shadow:0 0 0 3px rgba(79,140,255,.13)}h2{margin:0 0 13px;font-size:19px}.status{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.status div{padding:11px 12px;border-radius:12px;background:rgba(5,13,25,.58);border:1px solid var(--line);font-size:12px;word-break:break-all}.status b{display:block;color:var(--muted);font-weight:600;margin-bottom:5px}.good{color:#8ff0bd}.warn{color:#ffd27a}.bad{color:#ff9bad}.bottom{position:sticky;bottom:10px;padding:12px;display:flex;justify-content:space-between;gap:10px;align-items:center}.hint{color:var(--muted);font-size:12px;line-height:1.6}.loading{opacity:.65;pointer-events:none}
@media(max-width:760px){.top{flex-direction:column}.grid,.status,.flow{grid-template-columns:1fr}.field.full{grid-column:auto}.bottom{flex-direction:column;align-items:stretch}.bottom button{width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div class="title"><h1>定向文件推送</h1><p>只监控下面指定的蓝奏链接。文件发生变化后，接口端解析最新直链，GroupGuard 下载到本机、上传到目标群，上传成功后立即删除临时文件。</p></div><a id="homeLink" class="button secondary" href="/">返回控制台</a></div>
  <div id="notice" class="notice"></div>
  <section class="glass card">
    <div class="switchline"><div class="switchcopy"><strong>定向文件推送总开关</strong><small>第一次启用只建立当前文件基线，不会把现有文件误当成更新。</small></div><label class="switch"><input id="enabled" type="checkbox"><span class="slider"></span></label></div>
    <div class="flow"><div class="step"><b>1</b>接口端检查指定蓝奏链接</div><div class="step"><b>2</b>检测文件指纹变化</div><div class="step"><b>3</b>重新解析最新下载直链</div><div class="step"><b>4</b>192.168.3.89 下载并上传群文件</div><div class="step"><b>5</b>确认上传成功后删除本地文件</div></div>
  </section>
  <section class="glass card">
    <h2>推送设置</h2>
    <div class="grid">
      <label class="field full"><span>指定蓝奏网盘链接（person setting url）</span><input id="sourceUrl" placeholder="https://...lanzou.../..."><small>只处理这一条链接。建议使用单文件分享链接；如果链接解析出多个文件，接口端会拒绝猜测。</small></label>
      <label class="field"><span>目标群号（person setting group）</span><input id="targetGroupId" inputmode="numeric" placeholder="QQ群号"></label>
      <label class="field"><span>检查间隔（秒）</span><input id="checkIntervalSeconds" type="number" min="30" max="86400" value="300"></label>
      <label class="field"><span>接口端地址</span><input id="apiBaseUrl" placeholder="http://接口机:5001"><small>使用 lolapisevers 主 API，不使用蓝奏监控 6178。</small></label>
      <label class="field"><span>GroupGuard 回调地址</span><input id="callbackBaseUrl" placeholder="http://192.168.3.89:6108"><small>通常就是你当前打开的 GroupGuard WebUI 地址。</small></label>
      <label class="field"><span>单文件最大大小（MB）</span><input id="maxFileSizeMb" type="number" min="1" max="4096" value="2048"></label>
      <label class="field"><span>群文件夹位置</span><input id="targetFolderId" value="/"><small>上传到群文件根目录时保持 /。</small></label>
      <label class="field full"><span>接口写入 Token</span><input id="apiToken" type="password" autocomplete="new-password" placeholder="留空表示保留已保存 Token"><small id="tokenHint">Token 不会回显到浏览器。应与接口端 GROUPGUARD_WRITE_TOKEN 一致。</small></label>
    </div>
  </section>
  <section class="glass card"><h2>运行状态</h2><div id="status" class="status"><div>正在读取...</div></div></section>
  <div class="glass bottom"><div class="hint">“重新建立基线”不会上传文件，只会让接口端把当前文件重新视为初始版本。</div><div class="toolbar"><button class="secondary" id="refreshBtn">刷新</button><button class="secondary" id="checkBtn">立即检查</button><button class="danger" id="rebaselineBtn">重新建立基线</button><button id="saveBtn">保存并同步</button></div></div>
</div>
<script>
(function(){
var token=new URL(location.href).searchParams.get('token')||localStorage.getItem('GROUPGUARD_WEBUI_TOKEN')||'';
if(!token)token=prompt('请输入控制台访问令牌')||'';
localStorage.setItem('GROUPGUARD_WEBUI_TOKEN',token);
document.getElementById('homeLink').href='/?token='+encodeURIComponent(token);
var busy=false;
function api(path,options){options=options||{};return fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json','x-groupguard-token':token},body:options.body}).then(async function(r){var text=await r.text();var data;try{data=JSON.parse(text)}catch(e){data={ok:false,error:text}}if(!r.ok)throw new Error(data.error||data.detail||'操作失败');return data})}
function show(msg,ok){var box=document.getElementById('notice');box.className='notice '+(ok===false?'error':'ok');box.textContent=msg;window.scrollTo({top:0,behavior:'smooth'})}
function setBusy(v){busy=v;document.body.classList.toggle('loading',v);['saveBtn','refreshBtn','checkBtn','rebaselineBtn'].forEach(function(id){document.getElementById(id).disabled=v})}
function fmtTime(v){var n=Number(v||0);return n?new Date(n).toLocaleString('zh-CN',{hour12:false}):String(v||'暂无')}
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function read(){return {enabled:document.getElementById('enabled').checked,sourceUrl:document.getElementById('sourceUrl').value.trim(),targetGroupId:document.getElementById('targetGroupId').value.trim(),apiBaseUrl:document.getElementById('apiBaseUrl').value.trim(),callbackBaseUrl:document.getElementById('callbackBaseUrl').value.trim(),checkIntervalSeconds:Number(document.getElementById('checkIntervalSeconds').value||300),maxFileSizeMb:Number(document.getElementById('maxFileSizeMb').value||2048),targetFolderId:document.getElementById('targetFolderId').value.trim()||'/'}}
function fill(data){var e=data.editor||{};document.getElementById('enabled').checked=e.enabled===true;document.getElementById('sourceUrl').value=e.sourceUrl||'';document.getElementById('targetGroupId').value=e.targetGroupId||'';document.getElementById('apiBaseUrl').value=e.apiBaseUrl||'';document.getElementById('callbackBaseUrl').value=e.callbackBaseUrl||location.origin;document.getElementById('checkIntervalSeconds').value=e.checkIntervalSeconds||300;document.getElementById('maxFileSizeMb').value=e.maxFileSizeMb||2048;document.getElementById('targetFolderId').value=e.targetFolderId||'/';document.getElementById('tokenHint').textContent=(data.apiTokenConfigured?'✓ 已保存接口写入 Token；留空不会覆盖。':'尚未保存接口写入 Token。')+' Token 不会回显到浏览器。';renderStatus(data)}
function renderStatus(data){var local=data.local||{},remote=data.remote||{},cfg=(remote.config||{}),base=remote.baseline||{},pending=remote.pending||{};var remoteText=data.remoteError?'<span class="bad">连接失败：'+esc(data.remoteError)+'</span>':remote&&remote.ok?'<span class="good">接口端在线</span>':'<span class="warn">尚未读取接口端</span>';var html='';html+='<div><b>接口端状态</b>'+remoteText+'</div>';html+='<div><b>接口监控运行</b>'+(remote.running===true?'<span class="good">运行中</span>':'未运行 / 未读取')+'</div>';html+='<div><b>接口端当前配置</b>'+(cfg.enabled===true?'已启用':'未启用')+' · '+esc(cfg.check_interval_seconds||'--')+' 秒</div>';html+='<div><b>本地临时目录</b>'+esc(data.tempDir||'--')+'</div>';html+='<div><b>当前基线文件</b>'+esc(base.name||'暂无')+'</div>';html+='<div><b>待处理文件</b>'+esc(pending.name||'暂无')+'</div>';html+='<div><b>最近接口检查</b>'+esc(remote.last_check_at||'暂无')+'</div>';html+='<div><b>最近群文件上传成功</b>'+fmtTime(local.lastSuccessAt)+'</div>';html+='<div><b>本地已完成事件</b>'+esc(local.completedCount||0)+'</div>';html+='<div><b>最近错误</b>'+(esc(local.lastError||remote.last_error_code||data.remoteError||'无'))+'</div>';document.getElementById('status').innerHTML=html}
async function load(){if(busy)return;setBusy(true);try{var data=await api('/api/target-file-push');fill(data)}catch(e){show(e.message,false)}finally{setBusy(false)}}
async function save(){if(busy)return;setBusy(true);try{var payload={config:read(),apiToken:document.getElementById('apiToken').value.trim()};var data=await api('/api/target-file-push',{method:'POST',body:JSON.stringify(payload)});document.getElementById('apiToken').value='';fill(data);show(data.message||'已保存',!data.syncError)}catch(e){show(e.message,false)}finally{setBusy(false)}}
async function action(path,label){if(busy)return;setBusy(true);try{var data=await api(path,{method:'POST',body:'{}'});fill(data);show(label+'完成',true)}catch(e){show(e.message,false)}finally{setBusy(false)}}
document.getElementById('saveBtn').onclick=save;document.getElementById('refreshBtn').onclick=load;document.getElementById('checkBtn').onclick=function(){action('/api/target-file-push/check','立即检查')};document.getElementById('rebaselineBtn').onclick=function(){if(confirm('确定重新建立基线？当前文件不会上传。'))action('/api/target-file-push/rebaseline','重新建立基线')};load();
})();
</script>
</body>
</html>`;
}
