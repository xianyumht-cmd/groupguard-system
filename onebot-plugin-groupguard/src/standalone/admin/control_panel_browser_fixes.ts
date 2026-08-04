const FIX_STYLE = String.raw`<style id="groupguard-control-panel-browser-fixes">
#notice.card{padding:12px 14px!important}
.gg-section-content{min-width:0;overflow-x:auto}
.gg-section-content>.row,.gg-section-content>.grid{min-width:0}
@media(max-width:620px){
  .gg-page-actions{width:100%}
  .gg-page-actions>*{max-width:100%}
  .gg-breadcrumb{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .gg-breadcrumb strong{overflow:hidden;text-overflow:ellipsis}
}
</style>`;

const FIX_SCRIPT = String.raw`<script id="groupguard-control-panel-browser-fixes-controller">(function(){
function applyFixes(){
  var mode=document.documentElement.dataset.themeMode||'system';
  document.querySelectorAll('[data-gg-theme-mode]').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.ggThemeMode===mode))});
  var sidebar=document.querySelector('.gg-sidebar');
  if(sidebar){sidebar.onclick=function(event){var target=event.target.closest&&event.target.closest('.tab,.tablink,.gg-nav-link');if(target)document.body.classList.remove('gg-menu-open')}}
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
