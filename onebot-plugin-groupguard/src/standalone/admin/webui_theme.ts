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
  --gg-bg:#eef3fb;
  --gg-panel:rgba(255,255,255,.72);
  --gg-panel-strong:rgba(255,255,255,.9);
  --gg-text:#152238;
  --gg-muted:#66758c;
  --gg-line:rgba(92,116,151,.22);
  --gg-primary:#0a84ff;
  --gg-primary-strong:#006edc;
  --gg-danger:#d0443f;
  --gg-success:#159667;
  --gg-warning:#a66a08;
  --gg-soft:rgba(246,249,255,.72);
  --gg-input:rgba(255,255,255,.76);
  --gg-terminal:#111827;
  --gg-terminal-text:#e8edf7;
  --gg-focus:rgba(10,132,255,.25);
  --gg-shadow:0 24px 70px rgba(44,65,96,.14),0 2px 8px rgba(44,65,96,.08);
  --gg-highlight:inset 0 1px 0 rgba(255,255,255,.78);
}
html[data-theme="dark"]{
  color-scheme:dark;
  --gg-bg:#070b14;
  --gg-panel:rgba(24,32,49,.68);
  --gg-panel-strong:rgba(27,36,55,.9);
  --gg-text:#edf3ff;
  --gg-muted:#9aa9bf;
  --gg-line:rgba(170,193,226,.16);
  --gg-primary:#409cff;
  --gg-primary-strong:#1684ef;
  --gg-danger:#ff716a;
  --gg-success:#45d39a;
  --gg-warning:#f0bd63;
  --gg-soft:rgba(12,18,30,.66);
  --gg-input:rgba(8,14,25,.64);
  --gg-terminal:#050811;
  --gg-terminal-text:#e8edf7;
  --gg-focus:rgba(64,156,255,.28);
  --gg-shadow:0 28px 80px rgba(0,0,0,.42),0 2px 10px rgba(0,0,0,.28);
  --gg-highlight:inset 0 1px 0 rgba(255,255,255,.08);
}
html{min-height:100%;background:var(--gg-bg)}
body{
  min-height:100vh;
  background:
    radial-gradient(circle at 8% 5%,rgba(73,157,255,.24),transparent 30rem),
    radial-gradient(circle at 90% 8%,rgba(169,105,255,.18),transparent 28rem),
    radial-gradient(circle at 52% 94%,rgba(74,213,180,.13),transparent 32rem),
    var(--gg-bg)!important;
  color:var(--gg-text)!important;
  transition:background-color .22s ease,color .22s ease;
}
body:before{
  content:"";
  position:fixed;
  inset:0;
  pointer-events:none;
  z-index:-1;
  background:linear-gradient(135deg,rgba(255,255,255,.14),transparent 38%,rgba(255,255,255,.04));
}
.wrap,.container,.shell{max-width:1240px!important;padding:22px!important}
.top{
  position:sticky!important;
  top:12px;
  z-index:20;
  gap:14px!important;
  padding:16px 18px!important;
  margin-bottom:14px!important;
  border:1px solid var(--gg-line)!important;
  border-radius:22px!important;
  background:var(--gg-panel-strong)!important;
  box-shadow:var(--gg-shadow),var(--gg-highlight)!important;
  -webkit-backdrop-filter:blur(26px) saturate(150%);
  backdrop-filter:blur(26px) saturate(150%);
}
h1{letter-spacing:-.025em;font-weight:850!important;color:var(--gg-text)!important}
h2,h3,.field-title,.switch-title{color:var(--gg-text)!important}
.hint,.muted,.small,.field-desc,.field-path,.switch-path,label span,.k{color:var(--gg-muted)!important}
.card,.panel,.section,.box{
  background:var(--gg-panel)!important;
  border-color:var(--gg-line)!important;
  border-radius:20px!important;
  box-shadow:var(--gg-shadow),var(--gg-highlight)!important;
  -webkit-backdrop-filter:blur(24px) saturate(145%);
  backdrop-filter:blur(24px) saturate(145%);
}
.card,.panel{padding:17px!important}
.tabs{
  position:sticky;
  top:112px;
  z-index:18;
  padding:9px!important;
  border:1px solid var(--gg-line);
  border-radius:18px;
  background:var(--gg-panel-strong)!important;
  box-shadow:0 12px 34px rgba(35,53,82,.12),var(--gg-highlight);
  -webkit-backdrop-filter:blur(22px) saturate(150%);
  backdrop-filter:blur(22px) saturate(150%);
}
button,.tab,.tablink{
  border:1px solid var(--gg-line)!important;
  border-radius:12px!important;
  background:rgba(255,255,255,.42)!important;
  color:var(--gg-text)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 3px 10px rgba(28,46,77,.07)!important;
  transition:transform .16s ease,box-shadow .16s ease,background .16s ease!important;
}
html[data-theme="dark"] button,html[data-theme="dark"] .tab,html[data-theme="dark"] .tablink{background:rgba(31,43,65,.72)!important}
button:hover,.tab:hover,.tablink:hover{transform:translateY(-1px);box-shadow:0 7px 18px rgba(34,58,94,.16),inset 0 1px 0 rgba(255,255,255,.35)!important}
button:active,.tab:active,.tablink:active{transform:translateY(0) scale(.98)}
.tab.active,button.primary{
  background:linear-gradient(180deg,var(--gg-primary),var(--gg-primary-strong))!important;
  border-color:transparent!important;
  color:#fff!important;
  box-shadow:0 9px 22px rgba(10,132,255,.28),inset 0 1px 0 rgba(255,255,255,.3)!important;
}
button.secondary{background:var(--gg-soft)!important;color:var(--gg-text)!important}
button.danger{background:rgba(208,68,63,.1)!important;color:var(--gg-danger)!important;border-color:rgba(208,68,63,.26)!important}
a.link{color:var(--gg-primary)!important}
input,select,textarea{
  border-color:var(--gg-line)!important;
  border-radius:12px!important;
  background:var(--gg-input)!important;
  color:var(--gg-text)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22)!important;
  outline:none;
  transition:border-color .16s ease,box-shadow .16s ease,background .16s ease!important;
}
input:focus,select:focus,textarea:focus{
  border-color:var(--gg-primary)!important;
  box-shadow:0 0 0 4px var(--gg-focus),inset 0 1px 0 rgba(255,255,255,.2)!important;
}
.switch,.switch-row{
  background:var(--gg-soft)!important;
  border-color:var(--gg-line)!important;
  border-radius:14px!important;
}
pre,.result{
  background:var(--gg-terminal)!important;
  color:var(--gg-terminal-text)!important;
  border-color:rgba(145,168,202,.15)!important;
  border-radius:15px!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)!important;
}
table{background:transparent!important}
th{background:var(--gg-soft)!important;color:var(--gg-muted)!important}
th,td{border-color:var(--gg-line)!important}
.pill{background:rgba(118,137,163,.16)!important;color:var(--gg-text)!important}
.pill.on,.on{background:rgba(21,150,103,.18)!important;color:var(--gg-success)!important}
.pill.off,.off{background:rgba(208,68,63,.16)!important;color:var(--gg-danger)!important}
.ok{color:var(--gg-success)!important}.error{color:var(--gg-danger)!important}.warn{color:var(--gg-warning)!important}
.resource-preview,.preview{background:var(--gg-input)!important;border-color:var(--gg-line)!important;border-radius:12px!important}
.section-title{border-color:var(--gg-line)!important;color:var(--gg-primary)!important}
.gg-ios-theme-control{
  display:inline-flex;
  align-items:center;
  gap:3px;
  padding:4px;
  margin-left:auto;
  border:1px solid var(--gg-line);
  border-radius:14px;
  background:var(--gg-soft);
  box-shadow:var(--gg-highlight);
  flex:0 0 auto;
}
.gg-ios-theme-control button{
  min-height:30px!important;
  padding:5px 9px!important;
  border:0!important;
  border-radius:10px!important;
  background:transparent!important;
  box-shadow:none!important;
  color:var(--gg-muted)!important;
  font-size:12px;
  white-space:nowrap;
}
.gg-ios-theme-control button[aria-pressed="true"]{
  color:var(--gg-text)!important;
  background:var(--gg-panel-strong)!important;
  box-shadow:0 3px 10px rgba(35,55,87,.12),var(--gg-highlight)!important;
}
@supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){.top,.tabs,.card,.panel{background:var(--gg-panel-strong)!important}}
@media(max-width:700px){
  .wrap,.container,.shell{padding:10px!important}
  .top{position:relative!important;top:0;padding:14px!important;border-radius:18px!important;align-items:flex-start!important;flex-wrap:wrap}
  .tabs{position:relative;top:0;border-radius:16px;overflow-x:auto;flex-wrap:nowrap!important}
  .tab,.tablink{white-space:nowrap}
  .gg-ios-theme-control{width:100%;margin-left:0;justify-content:space-between}
  .gg-ios-theme-control button{flex:1}
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
  function mount(){
    if(document.querySelector('.gg-ios-theme-control')){sync(getMode());return}
    var control=document.createElement('div');control.className='gg-ios-theme-control';control.setAttribute('role','group');control.setAttribute('aria-label','外观主题');
    [['light','☀ 日间'],['system','◐ 跟随'],['dark','☾ 夜间']].forEach(function(item){var button=document.createElement('button');button.type='button';button.dataset.ggThemeMode=item[0];button.textContent=item[1];button.title='切换到'+item[1]+'模式';button.addEventListener('click',function(){apply(item[0],true)});control.appendChild(button)});
    var host=document.querySelector('.top')||document.querySelector('.actions')||document.body;host.appendChild(control);apply(getMode(),false);
  }
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
