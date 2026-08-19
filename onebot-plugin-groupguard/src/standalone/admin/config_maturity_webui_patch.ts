const CONFIG_MATURITY_STYLE = String.raw`<style id="groupguard-config-maturity-style">
.gg-config-maturity-panel{margin:14px 0 18px;padding:14px 16px;border:1px solid var(--gg-line);border-radius:10px;background:var(--gg-soft)}
.gg-config-maturity-panel h3{margin:0 0 6px;font-size:14px}.gg-config-maturity-panel p{margin:4px 0 10px;color:var(--gg-muted);font-size:12px}.gg-config-maturity-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.gg-config-maturity-actions label{min-width:180px;margin:0!important}.gg-config-maturity-status{margin-top:10px;color:var(--gg-muted);font-size:12px}.gg-config-source{display:inline-flex;align-items:center;gap:5px;margin-top:5px;padding:2px 7px;border:1px solid var(--gg-line);border-radius:999px;color:var(--gg-muted);font-size:10px;font-weight:650}.gg-config-source[data-source="group"]{border-color:color-mix(in srgb,var(--gg-primary) 40%,var(--gg-line));color:var(--gg-primary)}.gg-config-restore{min-height:0!important;margin-left:4px;padding:1px 6px!important;border:0!important;background:transparent!important;color:var(--gg-primary)!important;font-size:10px!important}.gg-global-mode-note{margin:0 0 14px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--gg-primary) 35%,var(--gg-line));border-radius:8px;background:color-mix(in srgb,var(--gg-primary) 7%,var(--gg-panel));color:var(--gg-muted);font-size:12px}
</style>`;

const CONFIG_MATURITY_SCRIPT = String.raw`<script id="groupguard-config-maturity-controller">(function(){
var TOKEN_KEY='GROUPGUARD_WEBUI_TOKEN',openingGlobal=false,globalMode=false,refreshingSources=false,sourceTimer=0;
function token(){try{return new URL(location.href).searchParams.get('token')||localStorage.getItem(TOKEN_KEY)||''}catch(error){return''}}
function withToken(path){var url=new URL(path,location.origin),value=token();if(value)url.searchParams.set('token',value);return url.pathname+url.search}
async function api(path,method,body){var res=await fetch(withToken(path),{method:method||'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});var text=await res.text(),data={};try{data=text?JSON.parse(text):{}}catch(error){throw new Error(text||('HTTP '+res.status))}if(!res.ok||data.ok===false)throw new Error(data.error||data.message||('HTTP '+res.status));return data}
function text(node,value){if(node)node.textContent=value}
function dispatchInput(node){if(!node)return;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}))}
function advancedSection(){return document.getElementById('tab-advanced')}
function advancedTab(){return document.querySelector('button.tab[data-tab="advanced"],.tab[data-tab="advanced"]')}
function setGlobalMode(enabled){
  globalMode=!!enabled;
  var section=advancedSection(),filter=document.getElementById('advancedFilter');
  if(filter){filter.value=globalMode?'global.':'';dispatchInput(filter)}
  if(section){
    var heading=section.querySelector('h2');
    if(heading)heading.textContent=globalMode?'全局配置':'全量配置';
    var old=section.querySelector('.gg-global-mode-note');if(old)old.remove();
    if(globalMode){var note=document.createElement('div');note.className='gg-global-mode-note';note.textContent='这里仅显示 global.* 全局默认值。保存只修改全局默认；已有分群覆盖不会被偷偷改写。要让某字段以后持续跟随全局，请到“分群配置”使用“恢复字段继承”。';var anchor=section.querySelector('#advancedFilter')?.closest('label')||section.firstElementChild;if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(note,anchor.nextSibling);else section.prepend(note)}
  }
  var own=document.querySelector('[data-gg-global-config="1"]');
  if(globalMode){document.querySelectorAll('.gg-nav .tab').forEach(function(item){item.classList.remove('active')});if(own)own.classList.add('active');var crumb=document.querySelector('.gg-breadcrumb strong');text(crumb,'全局配置')}
  else if(own)own.classList.remove('active');
}
function openGlobalConfig(){var original=advancedTab();if(!original)return;openingGlobal=true;original.click();openingGlobal=false;setGlobalMode(true)}
function mountGlobalNavigation(){
  var nav=document.querySelector('.gg-nav');if(!nav||nav.querySelector('[data-gg-global-config="1"]'))return !!nav;
  var groups=[].slice.call(nav.querySelectorAll('.gg-menu-group'));var block=groups.find(function(item){var title=item.querySelector('.gg-menu-group-title');return title&&title.textContent.trim()==='群首配置'});if(!block)return false;
  var button=document.createElement('button');button.type='button';button.className='tab';button.dataset.ggGlobalConfig='1';button.dataset.ggIcon='全';button.dataset.search='群首配置 全局配置 global 默认值';button.textContent='全局配置';button.addEventListener('click',openGlobalConfig);
  var groupTab=block.querySelector('[data-tab="groups"]');if(groupTab)block.insertBefore(button,groupTab);else block.appendChild(button);
  var original=advancedTab();if(original)original.addEventListener('click',function(){if(!openingGlobal)setGlobalMode(false)},true);
  return true;
}
function groupId(){var input=document.getElementById('groupIdInput');return input?String(input.value||'').trim():''}
function panelStatus(message,bad){var node=document.getElementById('ggConfigMaturityStatus');if(!node)return;node.textContent=message||'';node.style.color=bad?'var(--gg-danger)':'var(--gg-muted)'}
function batchSummary(result,verb){var updated=Number(result&&result.updated||0),skipped=Number(result&&result.skippedDormant||0),target=Number(result&&result.targetCount||0);var msg=(verb||'已处理')+' '+updated+' 个群';if(target)msg+='（目标 '+target+' 个）';if(skipped)msg+='；另有 '+skipped+' 个群包含休眠历史覆盖，为避免误激活/误删除已安全跳过';return msg+'。'}
async function inheritGlobalQaLink(){
  if(!confirm('让所有群的“问答链接先提示”恢复继承全局？\n只删除各群 qaLinkDelivery.enabled 这一条覆盖，其它分群设置完全不动。以后全局开关再变化，这个字段也会继续跟随。'))return;
  panelStatus('正在恢复链接提示的全局继承…');var result=await api('/api/groups/batch','POST',{patch:{__operation:'restore-path',path:'qaLinkDelivery.enabled'}});panelStatus(batchSummary(result,'已恢复继承'));scheduleSources(80)
}
async function applyCommonField(){
  var pathNode=document.getElementById('ggBatchField'),valueNode=document.getElementById('ggBatchValue');if(!pathNode||!valueNode)return;var path=String(pathNode.value||''),value=valueNode.value==='true';if(!path)return;
  if(!confirm('把 '+path+' = '+String(value)+' 写成所有群的“本群覆盖”？\n这是显式分群值，不会跟随以后全局变化。其它字段不会被修改。'))return;
  panelStatus('正在写入分群覆盖…');var result=await api('/api/groups/batch','POST',{patch:{__operation:'set-path',path:path,value:value}});panelStatus(batchSummary(result,'已写入覆盖'));scheduleSources(80)
}
async function restoreCommonField(){
  var pathNode=document.getElementById('ggBatchField');if(!pathNode)return;var path=String(pathNode.value||'');if(!path)return;
  if(!confirm('让所有群的 '+path+' 恢复继承全局？\n只删除这个字段的分群覆盖，其它分群设置不变。'))return;
  panelStatus('正在恢复字段继承…');var result=await api('/api/groups/batch','POST',{patch:{__operation:'restore-path',path:path}});panelStatus(batchSummary(result,'已恢复继承'));scheduleSources(80)
}
async function inheritAll(){
  if(!confirm('确认让全部已知群进入“完全继承全局配置”模式？\n这会让这些群现有的所有本群覆盖暂时不生效，但不会删除已存覆盖。只想同步一个字段时不要用这个按钮。'))return;
  panelStatus('正在切换继承模式…');var result=await api('/api/groups/batch','POST',{patch:{__operation:'set-inheritance',useGlobal:true}});panelStatus(batchSummary(result,'已切换完全继承'));scheduleSources(80)
}
function mountBatchPanel(){
  var section=document.getElementById('tab-groups'),meta=document.getElementById('groupMeta');if(!section||!meta||section.querySelector('#ggConfigMaturityPanel'))return !!section;
  var panel=document.createElement('div');panel.id='ggConfigMaturityPanel';panel.className='gg-config-maturity-panel';panel.innerHTML='<h3>全局与分群批量管理</h3><p><b>恢复字段继承</b>：以后持续跟随全局；<b>写入分群覆盖</b>：固定成群自己的值；<b>全部群继承全局</b>：整套分群覆盖暂时停用。三种操作语义不同。</p><div class="gg-config-maturity-actions"><button type="button" id="ggInheritQaLink">让所有群的链接提示继承全局</button><label><span>常用字段</span><select id="ggBatchField"><option value="qaEnabled">问答 qaEnabled</option><option value="queryEnabled">查询 queryEnabled</option><option value="dynamicCommandEnabled">动态命令 dynamicCommandEnabled</option><option value="activeReplyEnabled">主动回复 activeReplyEnabled</option><option value="qaLinkDelivery.enabled">链接提示 qaLinkDelivery.enabled</option></select></label><label><span>分群覆盖目标值</span><select id="ggBatchValue"><option value="true">开启</option><option value="false">关闭</option></select></label><button type="button" id="ggRestoreCommonField" class="secondary">恢复该字段为全局继承</button><button type="button" id="ggApplyCommonField" class="secondary">将目标值写成分群覆盖</button><button type="button" id="ggInheritAll" class="danger">全部群完全继承全局</button></div><div id="ggConfigMaturityStatus" class="gg-config-maturity-status">推荐优先使用“恢复字段继承”；它不会复制当前全局值，而是删除该字段的本群覆盖。</div>';
  meta.parentNode.insertBefore(panel,meta.nextSibling);
  document.getElementById('ggInheritQaLink').addEventListener('click',function(){inheritGlobalQaLink().catch(function(error){panelStatus(error.message,true)})});
  document.getElementById('ggRestoreCommonField').addEventListener('click',function(){restoreCommonField().catch(function(error){panelStatus(error.message,true)})});
  document.getElementById('ggApplyCommonField').addEventListener('click',function(){applyCommonField().catch(function(error){panelStatus(error.message,true)})});
  document.getElementById('ggInheritAll').addEventListener('click',function(){inheritAll().catch(function(error){panelStatus(error.message,true)})});
  return true;
}
function renameInheritanceSwitch(){var input=document.querySelector('#groupForm [data-config-key="useGlobal"]');if(!input)return;var row=input.closest('label'),title=row&&row.querySelector('.switch-title');if(title)title.textContent='继承全局配置'}
function sourceTarget(input){var row=input.closest('label');if(!row)return null;return row.querySelector('.switch-copy')||row.querySelector('span')||row}
async function restorePath(path){var id=groupId();if(!/^\d{4,20}$/.test(id))throw new Error('请先读取一个有效群');if(!confirm('恢复 '+path+' 为继承全局值？\n该字段的本群覆盖会被删除，其它设置不变。'))return;await api('/api/groups/'+encodeURIComponent(id),'POST',{patch:{__restorePath:path}});var load=document.getElementById('loadGroupBtn');if(load)load.click();scheduleSources(250)}
async function refreshSources(){
  if(refreshingSources)return;var id=groupId(),form=document.getElementById('groupForm');if(!form||!/^\d{4,20}$/.test(id))return;refreshingSources=true;
  try{
    renameInheritanceSwitch();var data=await api('/api/groups/'+encodeURIComponent(id));var sources=data.sources||{};form.querySelectorAll('.gg-config-source').forEach(function(node){node.remove()});
    form.querySelectorAll('[data-config-key]').forEach(function(input){var key=String(input.dataset.configKey||'');if(!key||key==='useGlobal')return;var source=sources[key]||'global',target=sourceTarget(input);if(!target)return;var badge=document.createElement('span');badge.className='gg-config-source';badge.dataset.source=source;badge.textContent=source==='group'?'来源：本群':'来源：全局';if(source==='group'){var restore=document.createElement('button');restore.type='button';restore.className='gg-config-restore';restore.textContent='恢复继承';restore.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();restorePath(key).catch(function(error){panelStatus(error.message,true)})});badge.appendChild(restore)}target.appendChild(badge)});
    var meta=document.getElementById('groupMeta');if(meta){var mode=data.useGlobal===true?'完全继承全局':'全局默认 + 本群覆盖';var own=Object.values(sources).filter(function(value){return value==='group'}).length;meta.textContent='配置模式：'+mode+'；当前本群覆盖字段 '+own+' 个。最终生效值由全局默认与本群覆盖共同计算。'}
  }catch(error){panelStatus('读取配置来源失败：'+error.message,true)}finally{refreshingSources=false}
}
function scheduleSources(delay){clearTimeout(sourceTimer);sourceTimer=setTimeout(function(){refreshSources()},delay||180)}
function bindSourceRefresh(){['loadGroupBtn','saveGroupBtn'].forEach(function(id){var node=document.getElementById(id);if(node)node.addEventListener('click',function(){scheduleSources(id==='saveGroupBtn'?650:250)})});var select=document.getElementById('groupSelect');if(select)select.addEventListener('change',function(){scheduleSources(250)});var form=document.getElementById('groupForm');if(form){var observer=new MutationObserver(function(list){if(refreshingSources)return;var relevant=list.some(function(item){return [].slice.call(item.addedNodes||[]).some(function(node){return !(node.nodeType===1&&node.classList&&node.classList.contains('gg-config-source'))})});if(relevant)scheduleSources(120)});observer.observe(form,{childList:true,subtree:true})}}
function start(){mountGlobalNavigation();mountBatchPanel();bindSourceRefresh();renameInheritanceSwitch();scheduleSources(350);var observer=new MutationObserver(function(){mountGlobalNavigation();mountBatchPanel();renameInheritanceSwitch()});observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){observer.disconnect();mountGlobalNavigation();mountBatchPanel()},3500)}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();</script>`;

export function applyConfigMaturityWebUiPatch(page: string): string {
  if (page.includes('id="groupguard-config-maturity-controller"')) return page;
  if (!page.includes('</body>')) throw new Error('config_maturity_webui_invalid_html');
  return page.replace('</head>', `${CONFIG_MATURITY_STYLE}</head>`).replace('</body>', `${CONFIG_MATURITY_SCRIPT}</body>`);
}
