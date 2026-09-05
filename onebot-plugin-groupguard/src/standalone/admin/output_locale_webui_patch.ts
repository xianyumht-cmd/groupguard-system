const OUTPUT_LOCALE_STYLE = String.raw`<style id="groupguard-output-locale-style">
.gg-output-locale-panel{margin:14px 0;padding:14px 16px;border:1px solid var(--gg-line);border-radius:10px;background:var(--gg-soft)}
.gg-output-locale-panel h3{margin:0 0 6px;font-size:14px}.gg-output-locale-panel p{margin:4px 0 12px;color:var(--gg-muted);font-size:12px;line-height:1.6}
.gg-output-locale-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.gg-output-locale-row label{min-width:240px;max-width:360px;margin:0!important;flex:1}.gg-output-locale-row button{flex:0 0 auto}
.gg-output-locale-status{margin-top:9px;color:var(--gg-muted);font-size:12px}
</style>`;

const OUTPUT_LOCALE_SCRIPT = String.raw`<script id="groupguard-output-locale-controller">(function(){
var loading=false;
function withToken(path){var url=new URL(path,location.origin);return url.pathname+url.search+url.hash}
async function api(path,method,body){var res=await fetch(withToken(path),{method:method||'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});var text=await res.text(),data={};try{data=text?JSON.parse(text):{}}catch(error){throw new Error(text||('HTTP '+res.status))}if(!res.ok||data.ok===false)throw new Error(data.error||data.message||('HTTP '+res.status));return data}
function status(message,bad){var node=document.getElementById('ggOutputLocaleStatus');if(!node)return;node.textContent=message||'';node.style.color=bad?'var(--gg-danger)':'var(--gg-muted)'}
function normalize(value){return value==='zh-TW'||value==='en'?value:'zh-CN'}
function syncGenericField(value){document.querySelectorAll('[data-config-key="global.outputLocale"]').forEach(function(node){if(node.id==='ggOutputLocale')return;if('value'in node)node.value=value;node.setAttribute('value',value)});var refresh=document.getElementById('refreshBtn');if(refresh&&typeof refresh.click==='function')refresh.click()}
async function load(){if(loading)return;var select=document.getElementById('ggOutputLocale');if(!select)return;loading=true;try{var data=await api('/api/config');select.value=normalize(data&&data.config&&data.config.global&&data.config.global.outputLocale);syncGenericField(select.value);status('当前生效：'+select.options[select.selectedIndex].text,false)}catch(error){status('读取输出语言失败：'+error.message,true)}finally{loading=false}}
async function save(){var select=document.getElementById('ggOutputLocale'),button=document.getElementById('ggOutputLocaleSave');if(!select)return;var value=normalize(select.value);if(button)button.disabled=true;status('正在保存…',false);try{await api('/api/config/patch','POST',{patch:{'global.outputLocale':value}});syncGenericField(value);status('已保存并立即生效：'+select.options[select.selectedIndex].text,false)}catch(error){status('保存失败：'+error.message,true)}finally{if(button)button.disabled=false}}
function mount(){
  if(document.getElementById('ggOutputLocalePanel'))return true;
  var section=document.getElementById('tab-advanced'),form=document.getElementById('advancedForm');if(!section||!form)return false;
  var panel=document.createElement('div');panel.id='ggOutputLocalePanel';panel.className='gg-output-locale-panel';
  panel.innerHTML='<h3>机器人全局输出语言</h3><p>只转换机器人最终发出的文字。图片、文件、命令识别、URL、CQ 码、QQ 号和代码不处理；用户自定义问答只在发送时转换，数据库中的原始简体内容不会被改写。</p><div class="gg-output-locale-row"><label><span>输出语言</span><select id="ggOutputLocale" data-config-key="global.outputLocale"><option value="zh-CN">简体中文（默认）</option><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label><button type="button" id="ggOutputLocaleSave">保存输出语言</button></div><div id="ggOutputLocaleStatus" class="gg-output-locale-status">正在读取当前设置…</div>';
  var filter=document.getElementById('advancedFilter');var anchor=filter&&filter.closest('label');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(panel,anchor.nextSibling);else form.insertBefore(panel,form.firstChild);
  document.getElementById('ggOutputLocaleSave').addEventListener('click',function(){save()});
  load();return true;
}
function start(){if(mount())return;var observer=new MutationObserver(function(){if(mount())observer.disconnect()});observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){observer.disconnect();mount()},3500)}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();</script>`;

export function applyOutputLocaleWebUiPatch(page: string): string {
  if (page.includes('id="groupguard-output-locale-controller"')) return page;
  if (!page.includes('</body>')) throw new Error('output_locale_webui_invalid_html');
  return page
    .replace('</head>', `${OUTPUT_LOCALE_STYLE}</head>`)
    .replace('</body>', `${OUTPUT_LOCALE_SCRIPT}</body>`);
}
