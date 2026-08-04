export const GROUPGUARD_WEBUI_THEME_STORAGE_KEY = 'GROUPGUARD_WEBUI_THEME';

const THEME_BOOTSTRAP = String.raw`<script id="groupguard-ios-theme-bootstrap">
(function(){
  var key='GROUPGUARD_WEBUI_THEME';
  var allowed={light:1,dark:1,system:1};
  var mode='system';
  try{var saved=localStorage.getItem(key);if(allowed[saved])mode=saved}catch(_error){}
  var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.themeMode=mode;
  document.documentElement.dataset.theme=mode==='system'?(dark?'dark':'light'):mode;
})();
</script>`;

const THEME_STYLE = String.raw`<style id="groupguard-ios-theme-style">
:root{
  color-scheme:light;
  --gg-bg:#f3f6fa;
  --gg-panel:#ffffff;
  --gg-panel-strong:#ffffff;
  --gg-text:#172033;
  --gg-muted:#68758a;
  --gg-line:#dfe5ee;
  --gg-primary:#1677ff;
  --gg-primary-strong:#095ec7;
  --gg-danger:#d14343;
  --gg-success:#16875f;
  --gg-warning:#a56600;
  --gg-soft:#f7f9fc;
  --gg-input:#ffffff;
  --gg-terminal:#111827;
  --gg-terminal-text:#e8edf7;
  --gg-focus:rgba(22,119,255,.2);
  --gg-shadow:0 8px 24px rgba(29,43,70,.07);
  --gg-highlight:inset 0 1px 0 rgba(255,255,255,.8);
  --gg-nav-bg:#101828;
  --gg-nav-panel:#182236;
  --gg-nav-text:#d9e2f1;
  --gg-nav-muted:#8492a8;
  --gg-nav-line:rgba(255,255,255,.08);
}
html[data-theme="dark"]{
  color-scheme:dark;
  --gg-bg:#0c121d;
  --gg-panel:#151e2d;
  --gg-panel-strong:#182233;
  --gg-text:#edf3fc;
  --gg-muted:#96a4b9;
  --gg-line:#29364a;
  --gg-primary:#409cff;
  --gg-primary-strong:#1684ef;
  --gg-danger:#ff716a;
  --gg-success:#45d39a;
  --gg-warning:#f0bd63;
  --gg-soft:#101826;
  --gg-input:#0e1724;
  --gg-terminal:#070b12;
  --gg-terminal-text:#e8edf7;
  --gg-focus:rgba(64,156,255,.25);
  --gg-shadow:0 12px 34px rgba(0,0,0,.24);
  --gg-highlight:inset 0 1px 0 rgba(255,255,255,.04);
  --gg-nav-bg:#080d16;
  --gg-nav-panel:#111a29;
  --gg-nav-text:#dce6f5;
  --gg-nav-muted:#7f8fa7;
  --gg-nav-line:rgba(255,255,255,.07);
}
*{box-sizing:border-box}
html{min-height:100%;background:var(--gg-bg)}
body{
  min-height:100vh;
  background:var(--gg-bg)!important;
  color:var(--gg-text)!important;
  transition:background-color .2s ease,color .2s ease;
}
body:before{display:none!important}
.wrap,.container,.shell{max-width:1240px!important;padding:22px!important}
.top{
  position:sticky!important;
  top:12px;
  z-index:20;
  gap:14px!important;
  padding:15px 18px!important;
  margin-bottom:16px!important;
  border:1px solid var(--gg-line)!important;
  border-radius:14px!important;
  background:var(--gg-panel-strong)!important;
  box-shadow:var(--gg-shadow),var(--gg-highlight)!important;
  -webkit-backdrop-filter:blur(18px) saturate(135%);
  backdrop-filter:blur(18px) saturate(135%);
}
h1{letter-spacing:-.02em;font-weight:760!important;color:var(--gg-text)!important}
h2,h3,.field-title,.switch-title{color:var(--gg-text)!important}
.hint,.muted,.small,.field-desc,.field-path,.switch-path,label span,.k{color:var(--gg-muted)!important}
.card,.panel,.section,.box{
  background:var(--gg-panel)!important;
  border:1px solid var(--gg-line)!important;
  border-radius:14px!important;
  box-shadow:var(--gg-shadow),var(--gg-highlight)!important;
  -webkit-backdrop-filter:blur(16px) saturate(125%);
  backdrop-filter:blur(16px) saturate(125%);
}
.card,.panel{padding:18px!important}
.tabs{
  position:sticky;
  top:104px;
  z-index:18;
  padding:8px!important;
  border:1px solid var(--gg-line);
  border-radius:14px;
  background:var(--gg-panel-strong)!important;
  box-shadow:var(--gg-shadow),var(--gg-highlight);
  -webkit-backdrop-filter:blur(16px) saturate(130%);
  backdrop-filter:blur(16px) saturate(130%);
}
button,.tab,.tablink{
  border:1px solid var(--gg-line)!important;
  border-radius:9px!important;
  background:var(--gg-panel)!important;
  color:var(--gg-text)!important;
  box-shadow:none!important;
  transition:border-color .15s ease,background .15s ease,color .15s ease,transform .15s ease!important;
}
button:hover,.tab:hover,.tablink:hover{transform:translateY(-1px);border-color:var(--gg-primary)!important}
button:active,.tab:active,.tablink:active{transform:translateY(0)}
.tab.active,button.primary{
  background:var(--gg-primary)!important;
  border-color:var(--gg-primary)!important;
  color:#fff!important;
  box-shadow:0 5px 14px rgba(22,119,255,.2)!important;
}
button.secondary{background:var(--gg-soft)!important;color:var(--gg-text)!important}
button.danger{background:rgba(209,67,67,.08)!important;color:var(--gg-danger)!important;border-color:rgba(209,67,67,.25)!important}
a.link{color:var(--gg-primary)!important}
input,select,textarea{
  border-color:var(--gg-line)!important;
  border-radius:9px!important;
  background:var(--gg-input)!important;
  color:var(--gg-text)!important;
  box-shadow:none!important;
  outline:none;
  transition:border-color .15s ease,box-shadow .15s ease,background .15s ease!important;
}
input:focus,select:focus,textarea:focus{
  border-color:var(--gg-primary)!important;
  box-shadow:0 0 0 3px var(--gg-focus)!important;
}
.switch,.switch-row{
  background:var(--gg-soft)!important;
  border-color:var(--gg-line)!important;
  border-radius:10px!important;
}
pre,.result{
  background:var(--gg-terminal)!important;
  color:var(--gg-terminal-text)!important;
  border-color:rgba(145,168,202,.15)!important;
  border-radius:10px!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important;
}
table{background:transparent!important}
th{background:var(--gg-soft)!important;color:var(--gg-muted)!important}
th,td{border-color:var(--gg-line)!important}
.pill{background:rgba(118,137,163,.14)!important;color:var(--gg-text)!important}
.pill.on,.on{background:rgba(22,135,95,.13)!important;color:var(--gg-success)!important}
.pill.off,.off{background:rgba(209,67,67,.12)!important;color:var(--gg-danger)!important}
.ok{color:var(--gg-success)!important}.error{color:var(--gg-danger)!important}.warn{color:var(--gg-warning)!important}
.resource-preview,.preview{background:var(--gg-input)!important;border-color:var(--gg-line)!important;border-radius:9px!important}
.section-title{border-color:var(--gg-line)!important;color:var(--gg-primary)!important}
.gg-ios-theme-control{
  display:inline-flex;
  align-items:center;
  gap:2px;
  padding:3px;
  margin-left:auto;
  border:1px solid var(--gg-line);
  border-radius:9px;
  background:var(--gg-soft);
  box-shadow:none;
  flex:0 0 auto;
}
.gg-ios-theme-control button{
  min-height:29px!important;
  padding:5px 8px!important;
  border:0!important;
  border-radius:7px!important;
  background:transparent!important;
  box-shadow:none!important;
  color:var(--gg-muted)!important;
  font-size:12px;
  white-space:nowrap;
}
.gg-ios-theme-control button[aria-pressed="true"]{
  color:var(--gg-primary)!important;
  background:var(--gg-panel-strong)!important;
  box-shadow:0 1px 4px rgba(29,43,70,.1)!important;
}

/* Professional admin shell: mounted without replacing existing controls or listeners. */
body.gg-admin-console{overflow-x:hidden}
body.gg-admin-console .wrap.gg-admin-shell{
  width:100%;
  max-width:none!important;
  min-height:100vh;
  margin:0!important;
  padding:0!important;
  display:grid;
  grid-template-columns:248px minmax(0,1fr);
  align-items:start;
}
.gg-sidebar{
  position:sticky;
  top:0;
  height:100vh;
  min-height:100vh;
  overflow-y:auto;
  padding:18px 14px;
  background:var(--gg-nav-bg);
  border-right:1px solid var(--gg-nav-line);
  color:var(--gg-nav-text);
  z-index:40;
}
.gg-brand{display:flex;align-items:center;gap:11px;padding:4px 8px 18px;border-bottom:1px solid var(--gg-nav-line);margin-bottom:12px}
.gg-brand-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:var(--gg-primary);color:#fff;font-weight:800;letter-spacing:-.04em;box-shadow:0 8px 22px rgba(22,119,255,.24)}
.gg-brand-title{font-size:15px;font-weight:720;color:#fff;line-height:1.25}
.gg-brand-subtitle{font-size:11px;color:var(--gg-nav-muted);margin-top:3px;letter-spacing:.03em}
.gg-sidebar .tabs{
  position:static!important;
  display:block!important;
  margin:0!important;
  padding:0!important;
  border:0!important;
  border-radius:0!important;
  background:transparent!important;
  box-shadow:none!important;
  backdrop-filter:none!important;
  -webkit-backdrop-filter:none!important;
}
.gg-menu-group{margin:12px 0 16px}
.gg-menu-group-title{padding:0 10px 6px;color:var(--gg-nav-muted);font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.gg-sidebar .tab,.gg-sidebar .tablink{
  width:100%;
  min-height:39px;
  display:flex!important;
  align-items:center;
  gap:10px;
  margin:2px 0;
  padding:8px 10px!important;
  border:1px solid transparent!important;
  border-radius:8px!important;
  background:transparent!important;
  color:var(--gg-nav-text)!important;
  box-shadow:none!important;
  text-align:left;
  text-decoration:none;
  font-size:13px;
  font-weight:540;
}
.gg-sidebar .tab:before,.gg-sidebar .tablink:before{
  content:attr(data-gg-icon);
  width:24px;
  height:24px;
  flex:0 0 24px;
  display:grid;
  place-items:center;
  border-radius:7px;
  background:rgba(255,255,255,.055);
  color:#aebbd0;
  font-size:11px;
  font-weight:750;
}
.gg-sidebar .tab:hover,.gg-sidebar .tablink:hover{transform:none;background:rgba(255,255,255,.055)!important;border-color:var(--gg-nav-line)!important;color:#fff!important}
.gg-sidebar .tab.active{
  background:rgba(22,119,255,.16)!important;
  border-color:rgba(64,156,255,.24)!important;
  color:#fff!important;
  box-shadow:none!important;
}
.gg-sidebar .tab.active:before{background:var(--gg-primary);color:#fff}
.gg-sidebar-footer{margin-top:18px;padding:13px 10px 2px;border-top:1px solid var(--gg-nav-line);color:var(--gg-nav-muted);font-size:11px;line-height:1.6}
.gg-sidebar-footer strong{display:block;color:#aab8cb;font-weight:600}
.gg-main{min-width:0;padding:18px 24px 30px}
body.gg-admin-console .gg-main>.top{
  top:12px;
  display:flex!important;
  align-items:center!important;
  min-height:70px;
  margin-bottom:18px!important;
  border-radius:12px!important;
}
body.gg-admin-console .gg-main>.top h1{font-size:20px!important;margin-bottom:3px!important}
body.gg-admin-console .gg-main>.top .hint{font-size:12px!important}
.gg-header-status{display:inline-flex;align-items:center;gap:7px;margin-left:auto;padding:6px 9px;border:1px solid var(--gg-line);border-radius:8px;background:var(--gg-soft);color:var(--gg-muted);font-size:12px;white-space:nowrap}
.gg-header-status:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--gg-success);box-shadow:0 0 0 3px rgba(22,135,95,.11)}
.gg-menu-toggle{display:none!important;width:38px;min-width:38px;height:36px;padding:0!important;align-items:center;justify-content:center;font-size:18px}
body.gg-admin-console .gg-main>.card{margin-bottom:16px!important}
body.gg-admin-console .gg-main>section.card{padding:20px!important}
body.gg-admin-console .gg-main>section.card>h2:first-child{font-size:17px!important;padding-bottom:13px;margin-bottom:16px!important;border-bottom:1px solid var(--gg-line)}
.gg-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.gg-metric{min-width:0;padding:15px;border:1px solid var(--gg-line);border-radius:11px;background:var(--gg-soft)}
.gg-metric-label{font-size:12px;color:var(--gg-muted);margin-bottom:8px}
.gg-metric-value{display:flex;align-items:center;gap:7px;color:var(--gg-text);font-size:17px;font-weight:700;line-height:1.25}
.gg-metric-value:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--gg-primary)}
.gg-metric[data-tone="success"] .gg-metric-value:before{background:var(--gg-success)}
.gg-metric[data-tone="danger"] .gg-metric-value:before{background:var(--gg-danger)}
.gg-metric-detail{font-size:11px;color:var(--gg-muted);margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gg-mobile-mask{display:none}
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.top,.tabs,.card,.panel{background:var(--gg-panel-strong)!important}}
@media(max-width:1040px){
  .gg-overview{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:820px){
  body.gg-admin-console .wrap.gg-admin-shell{display:block}
  .gg-sidebar{position:fixed;left:0;top:0;width:260px;transform:translateX(-105%);transition:transform .2s ease;box-shadow:14px 0 40px rgba(0,0,0,.28)}
  body.gg-menu-open .gg-sidebar{transform:translateX(0)}
  .gg-main{padding:10px}
  .gg-menu-toggle{display:inline-flex!important}
  .gg-mobile-mask{display:block;position:fixed;inset:0;background:rgba(4,9,18,.48);opacity:0;pointer-events:none;transition:opacity .2s ease;z-index:35}
  body.gg-menu-open .gg-mobile-mask{opacity:1;pointer-events:auto}
  body.gg-admin-console .gg-main>.top{position:sticky!important;top:8px;padding:12px!important;align-items:flex-start!important;flex-wrap:wrap}
  body.gg-admin-console .gg-main>.top>div:first-of-type{flex:1;min-width:180px}
  .gg-header-status{margin-left:0}
  .gg-ios-theme-control{width:auto;margin-left:0}
}
@media(max-width:700px){
  .wrap,.container,.shell{padding:10px!important}
  body:not(.gg-admin-console) .top{position:relative!important;top:0;padding:14px!important;align-items:flex-start!important;flex-wrap:wrap}
  body:not(.gg-admin-console) .tabs{position:relative;top:0;overflow-x:auto;flex-wrap:nowrap!important}
  body:not(.gg-admin-console) .tab,body:not(.gg-admin-console) .tablink{white-space:nowrap}
  .gg-overview{grid-template-columns:1fr}
  .gg-ios-theme-control button{padding:5px 7px!important}
}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
</style>`;

const THEME_CONTROLLER = String.raw`<script id="groupguard-ios-theme-controller">
(function(){
  var key='GROUPGUARD_WEBUI_THEME';
  var allowed={light:1,dark:1,system:1};
  var media=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  function getMode(){try{var mode=localStorage.getItem(key);return allowed[mode]?mode:'system'}catch(_error){return 'system'}}
  function resolved(mode){return mode==='system'?(media&&media.matches?'dark':'light'):mode}
  function sync(mode){document.querySelectorAll('[data-gg-theme-mode]').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.ggThemeMode===mode))})}
  function apply(mode,persist){if(!allowed[mode])mode='system';document.documentElement.dataset.themeMode=mode;document.documentElement.dataset.theme=resolved(mode);if(persist!==false){try{localStorage.setItem(key,mode)}catch(_error){}}sync(mode);window.dispatchEvent(new CustomEvent('groupguard-theme-change',{detail:{mode:mode,resolved:resolved(mode)}}))}
  function mountThemeControl(){
    if(document.querySelector('.gg-ios-theme-control')){sync(getMode());return}
    var control=document.createElement('div');control.className='gg-ios-theme-control';control.setAttribute('role','group');control.setAttribute('aria-label','外观主题');
    [['light','☀ 日间'],['system','◐ 跟随'],['dark','☾ 夜间']].forEach(function(item){var button=document.createElement('button');button.type='button';button.dataset.ggThemeMode=item[0];button.textContent=item[1];button.title='切换到'+item[1]+'模式';button.addEventListener('click',function(){apply(item[0],true)});control.appendChild(button)});
    var host=document.querySelector('.top')||document.querySelector('.actions')||document.body;host.appendChild(control);apply(getMode(),false);
  }
  function directChild(parent,className){
    if(!parent)return null;
    for(var i=0;i<parent.children.length;i++){var child=parent.children[i];if(child.classList&&child.classList.contains(className))return child}
    return null;
  }
  function menuKey(node){return node.getAttribute('data-tab')||node.id||''}
  function mountOverview(main){
    var statusSection=main.querySelector('#tab-status');
    var statusBox=main.querySelector('#statusBox');
    if(!statusSection||!statusBox||statusSection.querySelector('.gg-overview'))return;
    var overview=document.createElement('div');overview.className='gg-overview';overview.setAttribute('aria-label','控制台摘要');
    overview.innerHTML='<article class="gg-metric" data-tone="success"><div class="gg-metric-label">服务状态</div><div class="gg-metric-value" data-gg-metric="service">检查中</div><div class="gg-metric-detail">等待读取运行状态</div></article><article class="gg-metric"><div class="gg-metric-label">运行宿主</div><div class="gg-metric-value">SnowLuma</div><div class="gg-metric-detail">OneBot Host Profile</div></article><article class="gg-metric"><div class="gg-metric-label">配置保护</div><div class="gg-metric-value">自动备份</div><div class="gg-metric-detail">保存前创建配置快照</div></article><article class="gg-metric"><div class="gg-metric-label">控制台安全</div><div class="gg-metric-value">Token 保护</div><div class="gg-metric-detail">建议仅本机或内网访问</div></article>';
    statusSection.insertBefore(overview,statusBox);
    var service=overview.querySelector('[data-gg-metric="service"]');
    var detail=overview.querySelector('.gg-metric-detail');
    function refresh(){
      var text=(statusBox.textContent||'').trim();
      var hasError=!!statusBox.querySelector('.error')||/失败|断开|错误/.test(text);
      if(!text){service.textContent='检查中';detail.textContent='等待读取运行状态';return}
      service.textContent=hasError?'需要检查':'运行正常';
      detail.textContent=hasError?'状态数据包含异常信息':'状态数据已成功载入';
      overview.firstElementChild.setAttribute('data-tone',hasError?'danger':'success');
    }
    refresh();
    if(window.MutationObserver)new MutationObserver(refresh).observe(statusBox,{childList:true,subtree:true,characterData:true});
  }
  function mountAdminShell(){
    var wrap=document.querySelector('.wrap');
    var tabs=directChild(wrap,'tabs');
    if(!wrap||!tabs||!tabs.querySelector('[data-tab]')||wrap.classList.contains('gg-admin-shell'))return;
    var nodes=Array.prototype.slice.call(wrap.children);
    var sidebar=document.createElement('aside');sidebar.className='gg-sidebar';sidebar.setAttribute('aria-label','控制台导航');
    var brand=document.createElement('div');brand.className='gg-brand';brand.innerHTML='<div class="gg-brand-mark">GG</div><div><div class="gg-brand-title">GroupGuard</div><div class="gg-brand-subtitle">SNOWLUMA CONTROL</div></div>';
    sidebar.appendChild(brand);
    var groups=[
      {title:'概览',items:['status']},
      {title:'群管配置',items:['switches','groups','licenses','backups']},
      {title:'服务与风控',items:['qaLink','queryLink','send','presets','risklog','health']},
      {title:'扩展模块',items:['gameplay','content-risk','ele']},
      {title:'高级设置',items:['advanced','raw','commands']}
    ];
    var icons={status:'总',switches:'开',groups:'群',qaLink:'问',licenses:'权',backups:'备',queryLink:'查',send:'发',presets:'档',risklog:'析',health:'健',gameplay:'玩','content-risk':'风',ele:'构',advanced:'全',raw:'JSON',commands:'令'};
    var items=Array.prototype.slice.call(tabs.children);
    tabs.innerHTML='';
    groups.forEach(function(group){
      var block=document.createElement('div');block.className='gg-menu-group';block.dataset.ggMenuGroup=group.title;
      var title=document.createElement('div');title.className='gg-menu-group-title';title.textContent=group.title;block.appendChild(title);
      group.items.forEach(function(id){
        for(var i=0;i<items.length;i++){
          if(menuKey(items[i])===id){items[i].dataset.ggIcon=icons[id]||'·';block.appendChild(items[i]);break}
        }
      });
      tabs.appendChild(block);
    });
    items.forEach(function(item){if(!tabs.contains(item)){item.dataset.ggIcon='·';tabs.appendChild(item)}});
    sidebar.appendChild(tabs);
    var footer=document.createElement('div');footer.className='gg-sidebar-footer';footer.innerHTML='<strong>管理端控制台</strong>配置变更会保留备份，请谨慎开放公网访问。';sidebar.appendChild(footer);
    var main=document.createElement('main');main.className='gg-main';
    nodes.forEach(function(node){if(node!==tabs)main.appendChild(node)});
    wrap.appendChild(sidebar);wrap.appendChild(main);wrap.classList.add('gg-admin-shell');document.body.classList.add('gg-admin-console');
    var mask=document.createElement('div');mask.className='gg-mobile-mask';mask.setAttribute('aria-hidden','true');document.body.appendChild(mask);
    var top=directChild(main,'top');
    if(top){
      var toggle=document.createElement('button');toggle.type='button';toggle.className='gg-menu-toggle secondary';toggle.setAttribute('aria-label','打开导航菜单');toggle.textContent='☰';top.insertBefore(toggle,top.firstChild);
      var status=document.createElement('div');status.className='gg-header-status';status.textContent='管理端在线';top.appendChild(status);
      toggle.addEventListener('click',function(){document.body.classList.toggle('gg-menu-open')});
    }
    mask.addEventListener('click',function(){document.body.classList.remove('gg-menu-open')});
    tabs.addEventListener('click',function(){document.body.classList.remove('gg-menu-open')});
    mountOverview(main);
  }
  function mount(){mountAdminShell();mountThemeControl()}
  if(media){var onChange=function(){if(getMode()==='system')apply('system',false)};if(media.addEventListener)media.addEventListener('change',onChange);else if(media.addListener)media.addListener(onChange)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
</script>`;

export function applyWebUiTheme(page: string): string {
  if (page.includes('id="groupguard-ios-theme-style"')) return page;
  if (!page.includes('</head>') || !page.includes('</body>')) {
    throw new Error('webui_theme_invalid_html');
  }
  return page
    .replace('</head>', `${THEME_BOOTSTRAP}${THEME_STYLE}</head>`)
    .replace('</body>', `${THEME_CONTROLLER}</body>`);
}
