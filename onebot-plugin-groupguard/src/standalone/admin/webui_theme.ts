import { applyControlPanelDesign, CONTROL_PANEL_THEME_STORAGE_KEY } from './control_panel_design';
import { applyControlPanelBrowserFixes } from './control_panel_browser_fixes';
import { applyConfigMaturityWebUiPatch } from './config_maturity_webui_patch';
import { applyOutputLocaleWebUiPatch } from './output_locale_webui_patch';

export const GROUPGUARD_WEBUI_THEME_STORAGE_KEY = CONTROL_PANEL_THEME_STORAGE_KEY;

const TARGET_FILE_PUSH_NAVIGATION_PATCH = String.raw`<script id="groupguard-target-file-push-navigation-patch">(function(){
var TOKEN_KEY='GROUPGUARD_WEBUI_TOKEN';
function token(){try{return new URL(location.href).searchParams.get('token')||localStorage.getItem(TOKEN_KEY)||''}catch(error){return''}}
function withToken(path){var url=new URL(path,location.origin),value=token();if(value)url.searchParams.set('token',value);return url.pathname+url.search}
function mount(){
  var nav=document.querySelector('.gg-nav');
  if(!nav||nav.querySelector('[data-gg-target-file-push="1"]'))return false;
  var blocks=[].slice.call(nav.querySelectorAll('.gg-menu-group'));
  var block=blocks.find(function(item){var title=item.querySelector('.gg-menu-group-title');return title&&title.textContent.trim()==='扩展模块'});
  if(!block)return false;
  var link=document.createElement('a');
  link.className='gg-nav-link';
  link.textContent='定向文件推送';
  link.href=withToken('/target-file-push.html');
  link.dataset.ggIcon='定';
  link.dataset.ggTargetFilePush='1';
  link.dataset.search='扩展模块 定向文件推送 蓝奏 群文件';
  if(location.pathname==='/target-file-push.html')link.classList.add('active');
  var mirror=block.querySelector('a[href*="/group-file-mirror.html"]');
  var manager=block.querySelector('a[href*="/qun-guanjia.html"]');
  if(manager)block.insertBefore(link,manager);
  else if(mirror&&mirror.nextSibling)block.insertBefore(link,mirror.nextSibling);
  else block.appendChild(link);
  return true;
}
function start(){
  if(mount())return;
  var observer=new MutationObserver(function(){if(mount())observer.disconnect()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(function(){observer.disconnect();mount()},2500);
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
})();</script>`;

function applyTargetFilePushNavigationPatch(page: string): string {
  if (page.includes('id="groupguard-target-file-push-navigation-patch"')) return page;
  if (!page.includes('</body>')) throw new Error('webui_theme_invalid_html');
  return page.replace('</body>', `${TARGET_FILE_PUSH_NAVIGATION_PATCH}</body>`);
}

export function applyWebUiTheme(page: string): string {
  const designed = applyControlPanelBrowserFixes(applyControlPanelDesign(page));
  const withTargetFilePush = applyTargetFilePushNavigationPatch(designed);
  const withConfigMaturity = applyConfigMaturityWebUiPatch(withTargetFilePush);
  return applyOutputLocaleWebUiPatch(withConfigMaturity);
}
