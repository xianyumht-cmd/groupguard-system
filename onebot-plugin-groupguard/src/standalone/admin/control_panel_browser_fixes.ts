const FIX_STYLE = String.raw`<style id="groupguard-control-panel-browser-fixes">
#notice.card:not(.hidden){position:fixed;top:76px;right:24px;z-index:90;width:min(420px,calc(100vw - 48px));margin:0!important;padding:12px 14px!important;border-radius:10px!important;box-shadow:0 14px 40px rgba(16,24,40,.18)!important}
.gg-section-content{min-width:0;overflow-x:auto}
.gg-section-content>.row,.gg-section-content>.grid{min-width:0}
.gg-status-summary{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.gg-status-summary span{display:inline-flex;padding:2px 7px;border:1px solid var(--gg-line);border-radius:999px;background:var(--gg-soft);color:var(--gg-muted);font-size:11px}
@media(max-width:620px){
  #notice.card:not(.hidden){top:auto;right:14px;bottom:14px;width:calc(100vw - 28px)}
  .gg-topbar{gap:6px;padding:0 10px}
  .gg-system-chip{display:none!important}
  .gg-theme{flex:0 0 auto}
  .gg-theme button{width:30px;min-width:30px!important;padding:5px!important;font-size:0!important}
  .gg-theme button:before{content:attr(data-gg-theme-icon);font-size:14px!important}
  .gg-page-actions{width:100%}
  .gg-page-actions>*{max-width:100%}
  .gg-breadcrumb{min-width:0;max-width:128px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .gg-breadcrumb strong{overflow:hidden;text-overflow:ellipsis}
}
</style>`;

const FIX_SCRIPT = String.raw`<script id="groupguard-control-panel-browser-fixes-controller">(function(){
function normalizeNavigation(){
  var labels={status:'运行概览',queryLink:'查询与接口'};
  Object.keys(labels).forEach(function(id){var item=id==='status'?document.querySelector('[data-tab="status"]'):document.getElementById(id);if(item)item.textContent=labels[id]});
  document.querySelectorAll('.gg-page-actions a').forEach(function(link){if(/返回主 WebUI/.test(link.textContent||''))link.textContent='返回控制台'});
}
function compactStatus(){
  var box=document.getElementById('statusBox');if(!box)return;
  function refresh(){
    var cells=[].slice.call(box.children);
    for(var i=0;i+1<cells.length;i+=2){
      var key=cells[i],value=cells[i+1],name=(key.textContent||'').trim();
      if(name==='ok'){key.style.display='none';value.style.display='none';continue}
      if(name==='oneBot'){
        key.textContent='OneBot 状态';
        try{var oneBot=JSON.parse(value.textContent||'{}');value.textContent=oneBot.connected?'已连接（'+(oneBot.status||'connected')+'）':'未连接'}catch(_error){}
      }
      if(name==='文件存在状态'){
        try{var files=JSON.parse(value.textContent||'{}'),names={config:'配置',sqlite:'数据库',dynamicCommands:'动态命令',backupDir:'备份目录'},html='<div class="gg-status-summary">';Object.keys(names).forEach(function(field){html+='<span>'+names[field]+' '+(files[field]?'正常':'缺失')+'</span>'});value.innerHTML=html+'</div>'}catch(_error){}
      }
    }
  }
  refresh();
  if(window.MutationObserver)new MutationObserver(refresh).observe(box,{childList:true,subtree:true,characterData:true});
}
function normalizePageSections(){
  if(location.pathname==='/group-file-mirror.html'){
    var sections=document.querySelectorAll('.gg-page-body>.gg-page-section');
    if(sections[0]){var first=sections[0].querySelector('.gg-section-header h2,.gg-section-header h3');if(first)first.textContent='运行设置'}
    if(sections[1]){var second=sections[1].querySelector('.gg-section-header h2,.gg-section-header h3');if(second)second.textContent='搬运规则'}
  }
}
function setupNotice(){
  var notice=document.getElementById('notice');if(!notice||!window.MutationObserver)return;
  var timer=0;
  new MutationObserver(function(){clearTimeout(timer);if(!notice.classList.contains('hidden')&&!notice.classList.contains('error'))timer=setTimeout(function(){notice.classList.add('hidden')},3500)}).observe(notice,{attributes:true,childList:true,characterData:true,subtree:true});
}
function applyFixes(){
  var mode=document.documentElement.dataset.themeMode||'system';
  document.querySelectorAll('[data-gg-theme-mode]').forEach(function(button){var icon=(button.textContent||'').trim().charAt(0);button.dataset.ggThemeIcon=icon;button.setAttribute('aria-label',(button.textContent||'').trim());button.setAttribute('aria-pressed',String(button.dataset.ggThemeMode===mode))});
  var sidebar=document.querySelector('.gg-sidebar');
  if(sidebar){sidebar.onclick=function(event){var target=event.target.closest&&event.target.closest('.tab,.tablink,.gg-nav-link');if(target)document.body.classList.remove('gg-menu-open')}}
  normalizeNavigation();compactStatus();normalizePageSections();setupNotice();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyFixes);else applyFixes();
})();</script>`;

function replaceRequired(page: string, search: string, replacement: string, label: string): string {
  if (!page.includes(search)) throw new Error(`webui_browser_fix_anchor_missing:${label}`);
  return page.replace(search, replacement);
}

export function applyControlPanelBrowserFixes(page: string): string {
  if (page.includes('id="groupguard-control-panel-browser-fixes"')) return page;

  let patched = page;
  patched = replaceRequired(
    patched,
    "if(button&&(button.hasAttribute('data-save-form')||/^save/i.test(button.id||'')||/保存|授权|创建配置快照/.test(button.textContent||'')))setTimeout(function(){mark(false)},700)",
    "if(button&&(button.hasAttribute('data-save-form')||/^save/i.test(button.id||'')||/保存|授权|创建配置快照/.test(button.textContent||''))){var notice=body.querySelector('#notice'),beforeText=notice?notice.textContent:'',beforeClass=notice?notice.className:'',attempts=0,timer=setInterval(function(){attempts++;if(!notice){clearInterval(timer);return}var changed=notice.textContent!==beforeText||notice.className!==beforeClass;if(changed){clearInterval(timer);if(!notice.classList.contains('error'))mark(false)}else if(attempts>=25)clearInterval(timer)},200)}",
    'save-result-tracking'
  );
  patched = replaceRequired(
    patched,
    "var dangerous=button.classList.contains('danger')||/^delete/i.test(button.id||'')||/删除|取消授权|清除/.test(button.textContent||'');if(dangerous&&!confirm('这是高风险操作，确认继续吗？'))",
    "var dangerous=button.classList.contains('danger')||/^delete/i.test(button.id||'')||/删除|取消授权|清除/.test(button.textContent||'');var nativeConfirm=/^(deleteGroupBtn|deleteLicenseBtn|deleteGroupQuery)$/.test(button.id||'')||/deleteQa\\s*\\(/.test(button.getAttribute('onclick')||'');if(dangerous&&nativeConfirm)return;if(dangerous&&!confirm('这是高风险操作，确认继续吗？'))",
    'native-confirm-deduplication'
  );

  if (!patched.includes('</head>') || !patched.includes('</body>')) throw new Error('webui_browser_fix_invalid_html');
  return patched.replace('</head>', `${FIX_STYLE}</head>`).replace('</body>', `${FIX_SCRIPT}</body>`);
}
