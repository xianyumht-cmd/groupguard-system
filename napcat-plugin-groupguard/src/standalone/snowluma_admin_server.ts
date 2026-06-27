import crypto from 'crypto';
import fs from 'fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'http';
import path from 'path';
import { URL } from 'node:url';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { normalizePluginConfig } from '../config';
import { configStateService } from '../core/state-services/config_state_service';
import { contextStateService } from '../core/state-services/context_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { getFeatureGateSnapshot } from '../core/feature_gate';
import { forceReloadDynamicCommands, loadDynamicCommands } from '../dynamic-commands/command_loader';

export interface SnowLumaAdminServerOptions {
  ctx: NapCatPluginContext;
  workDir: string;
  dataDir: string;
  configPath: string;
  backupDir: string;
  dynamicCommandsConfigPath: string;
  wsUrl: string;
  host?: string;
  port?: number;
  token?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface SnowLumaAdminServerRuntime {
  close: () => Promise<void>;
  host: string;
  port: number;
  token: string;
  url: string;
}

type JsonRecord = Record<string, any>;

const DEFAULT_DYNAMIC_COMMANDS = { version: '1', commands: [] };

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readJsonFile(filePath: string, fallback: any = {}): any {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function ensureObjectConfig(value: any): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config.json 必须是 JSON 对象，不能是数组或空值');
  }
  return value;
}

function ensureDynamicCommandsConfig(value: any): JsonRecord {
  if (Array.isArray(value)) return { version: '1', commands: value };
  if (!value || typeof value !== 'object') return { ...DEFAULT_DYNAMIC_COMMANDS };
  if (!Array.isArray(value.commands)) value.commands = [];
  if (typeof value.version !== 'string') value.version = '1';
  return value;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function backupFile(sourcePath: string, backupDir: string, label: string): string {
  ensureDir(backupDir);
  const dir = path.join(backupDir, `webui-${timestamp()}`);
  ensureDir(dir);
  const target = path.join(dir, label);
  if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, target);
  return target;
}

function writeJsonFile(filePath: string, value: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function parseAuthToken(req: IncomingMessage, url: URL): string {
  const queryToken = url.searchParams.get('token') || '';
  const headerToken = getHeaderValue(req.headers['x-groupguard-token']);
  const auth = getHeaderValue(req.headers.authorization);
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return headerToken || queryToken;
}

function isTokenMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided || '');
  const right = Buffer.from(expected || '');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: any): void {
  send(res, status, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += String(chunk);
      if (body.length > 5 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function splitPath(key: string): string[] {
  const text = String(key || '').trim();
  if (text.startsWith('global.featureSwitches.query.')) {
    return ['global', 'featureSwitches', `query.${text.slice('global.featureSwitches.query.'.length)}`];
  }
  if (text.startsWith('global.featureSwitches.builtin.')) {
    return ['global', 'featureSwitches', `builtin.${text.slice('global.featureSwitches.builtin.'.length)}`];
  }
  return text.split('.').map(item => item.trim()).filter(Boolean);
}

function setByPath(target: JsonRecord, key: string, value: any): void {
  const parts = splitPath(key);
  if (!parts.length) return;
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function parsePatchValue(value: any): any {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return JSON.parse(trimmed);
  }
  return value;
}

function applyPatch(config: JsonRecord, patch: JsonRecord): JsonRecord {
  const next = JSON.parse(JSON.stringify(config));
  for (const [key, value] of Object.entries(patch || {})) {
    if (!key || key === '__proto__' || key.includes('__proto__')) continue;
    setByPath(next, key, parsePatchValue(value));
  }
  return next;
}

function getStatus(options: SnowLumaAdminServerOptions) {
  const sqlitePath = path.join(options.dataDir, 'groupguard.db');
  const dynamicCommands = loadDynamicCommands();
  return {
    workDir: options.workDir,
    processCwd: process.cwd(),
    configPath: options.configPath,
    dataDir: options.dataDir,
    sqlitePath,
    backupDir: options.backupDir,
    dynamicCommandsPath: options.dynamicCommandsConfigPath,
    wsUrl: options.wsUrl,
    botId: identityStateService.getBotId() || '',
    adapterName: contextStateService.getAdapterName() || '',
    dynamicCommandsCount: dynamicCommands.length,
    feature: getFeatureGateSnapshot(),
    exists: {
      config: fs.existsSync(options.configPath),
      sqlite: fs.existsSync(sqlitePath),
      dynamicCommands: fs.existsSync(options.dynamicCommandsConfigPath),
      backupDir: fs.existsSync(options.backupDir)
    }
  };
}

function renderHomePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GroupGuard SnowLuma WebUI</title>
<style>
:root{color-scheme:dark light}body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101827;color:#e5e7eb}.wrap{max-width:1180px;margin:0 auto;padding:22px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.card{background:#172033;border:1px solid #2f3d56;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 12px 28px rgba(0,0,0,.18)}h1{font-size:22px;margin:0}h2{font-size:17px;margin:0 0 12px}button{background:#2563eb;color:white;border:0;border-radius:10px;padding:9px 13px;cursor:pointer;font-weight:600}button.secondary{background:#334155}input,select,textarea{box-sizing:border-box;width:100%;border:1px solid #40506b;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:9px;font-family:inherit}textarea{min-height:420px;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.45}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}label{display:block;margin-bottom:10px}label span{display:block;font-size:13px;color:#9ca3af;margin-bottom:5px}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#0f172a;border:1px solid #263349;border-radius:10px;padding:10px}.switch-row input{width:auto}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.tab{background:#1f2937}.tab.active{background:#2563eb}.hidden{display:none}.status-grid{display:grid;grid-template-columns:190px 1fr;gap:8px 12px;font-size:13px}.k{color:#9ca3af}.v{word-break:break-all}.hint{color:#93c5fd;font-size:13px}.error{color:#fca5a5}.ok{color:#86efac}.footer{font-size:12px;color:#94a3b8;margin-top:18px}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>GroupGuard SnowLuma WebUI</h1><div class="hint">用于修改 SnowLuma 独立版群管配置。保存前会自动备份。</div></div><button onclick="reloadAll()">刷新</button></div>
  <div class="tabs">
    <button class="tab active" data-tab="status">状态</button>
    <button class="tab" data-tab="switches">全局开关</button>
    <button class="tab" data-tab="query">查询配置</button>
    <button class="tab" data-tab="send">发送/风控</button>
    <button class="tab" data-tab="raw">config.json</button>
    <button class="tab" data-tab="commands">动态命令</button>
  </div>
  <div id="notice" class="card hidden"></div>
  <section id="tab-status" class="card"><h2>运行状态</h2><div id="statusBox" class="status-grid"></div></section>
  <section id="tab-switches" class="card hidden"><h2>全局开关</h2><div id="switchForm" class="grid"></div><button onclick="savePatch('switchForm')">保存全局开关</button></section>
  <section id="tab-query" class="card hidden"><h2>查询配置</h2><div id="queryForm" class="grid"></div><button onclick="savePatch('queryForm')">保存查询配置</button><p class="hint">查合集当前通常由 shardQueryOutputFormat 控制；查战绩是否真正支持图片，还取决于查询链路是否实现 image 输出。</p></section>
  <section id="tab-send" class="card hidden"><h2>发送/风控配置</h2><div id="sendForm" class="grid"></div><button onclick="savePatch('sendForm')">保存发送/风控配置</button></section>
  <section id="tab-raw" class="card hidden"><h2>原始 config.json</h2><textarea id="configEditor"></textarea><div style="margin-top:10px"><button onclick="saveRawConfig()">保存 config.json</button> <button class="secondary" onclick="loadConfig()">重新加载</button></div></section>
  <section id="tab-commands" class="card hidden"><h2>动态命令 commands.json</h2><textarea id="commandsEditor"></textarea><div style="margin-top:10px"><button onclick="saveCommands()">保存动态命令</button> <button class="secondary" onclick="loadCommands()">重新加载</button></div></section>
  <div class="footer">默认仅建议在本机或内网使用。若暴露公网，请设置强 token 并限制访问来源。</div>
</div>
<script>
let token = new URL(location.href).searchParams.get('token') || localStorage.getItem('GROUPGUARD_WEBUI_TOKEN') || '';
if (!token) token = prompt('请输入 GROUPGUARD_WEBUI_TOKEN / 启动日志里的临时 token') || '';
localStorage.setItem('GROUPGUARD_WEBUI_TOKEN', token);
let config = {};
function api(path, options){ options = options || {}; return fetch(path, { method: options.method || 'GET', body: options.body, headers: Object.assign({ 'content-type': 'application/json', 'x-groupguard-token': token }, options.headers || {}) }).then(async function(r){ var text = await r.text(); var data; try { data = JSON.parse(text); } catch(e) { data = { ok:false, error:text }; } if(!r.ok) throw new Error(data.error || text || r.statusText); return data; }); }
function show(msg, ok){ var n=document.getElementById('notice'); n.className='card ' + (ok === false ? 'error' : 'ok'); n.textContent=msg; }
function get(obj, p, fallback){ var cur=obj; var parts=p.split('.'); for(var i=0;i<parts.length;i++){ if(!cur || cur[parts[i]]===undefined) return fallback; cur=cur[parts[i]]; } return cur; }
function htmlEscape(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function inputHtml(label,key,value,type){ return '<label><span>'+label+'</span><input data-config-key="'+key+'" type="'+(type||'text')+'" value="'+htmlEscape(value)+'"></label>'; }
function selectHtml(label,key,value,opts){ var s='<label><span>'+label+'</span><select data-config-key="'+key+'">'; for(var i=0;i<opts.length;i++){ var o=opts[i]; s+='<option value="'+o+'" '+(String(value)===o?'selected':'')+'>'+o+'</option>'; } return s+'</select></label>'; }
function switchHtml(label,key,value){ return '<label class="switch-row"><span>'+label+'</span><input data-config-key="'+key+'" type="checkbox" '+(value?'checked':'')+'></label>'; }
document.querySelectorAll('.tab').forEach(function(btn){ btn.onclick=function(){ document.querySelectorAll('.tab').forEach(function(b){b.classList.remove('active')}); btn.classList.add('active'); document.querySelectorAll('section[id^="tab-"]').forEach(function(s){s.classList.add('hidden')}); document.getElementById('tab-'+btn.dataset.tab).classList.remove('hidden'); }; });
function fieldValue(input){ if(input.type==='checkbox') return input.checked; var v=input.value.trim(); if(v==='true')return true;if(v==='false')return false;if(v==='null')return null;if(/^-?\\d+(\\.\\d+)?$/.test(v))return Number(v); if((v.startsWith('[')&&v.endsWith(']'))||(v.startsWith('{')&&v.endsWith('}'))) return JSON.parse(v); return input.value; }
function collectPatch(formId){ var patch={}; document.querySelectorAll('#'+formId+' [data-config-key]').forEach(function(i){ patch[i.dataset.configKey]=fieldValue(i); }); return patch; }
function renderStatus(status){ var box=document.getElementById('statusBox'); box.innerHTML=''; Object.entries(status).forEach(function(entry){ var a=document.createElement('div'); a.className='k'; a.textContent=entry[0]; var b=document.createElement('div'); b.className='v'; b.textContent=typeof entry[1]==='object'?JSON.stringify(entry[1]):String(entry[1]); box.append(a,b); }); }
function renderForms(){
  document.getElementById('switchForm').innerHTML = ''+
    switchHtml('总开关 masterEnabled','global.masterEnabled',get(config,'global.masterEnabled',true))+
    selectHtml('静默模式 silentMode','global.silentMode',get(config,'global.silentMode','off'),['off','noPassiveReply','noBotSend'])+
    switchHtml('主动发送 activeReplyEnabled','global.activeReplyEnabled',get(config,'global.activeReplyEnabled',true))+
    switchHtml('查询总开关 queryEnabled','global.queryEnabled',get(config,'global.queryEnabled',true))+
    switchHtml('问答总开关 qaEnabled','global.qaEnabled',get(config,'global.qaEnabled',true))+
    switchHtml('动态命令 dynamicCommandEnabled','global.dynamicCommandEnabled',get(config,'global.dynamicCommandEnabled',true))+
    switchHtml('旧问答禁用 disableQA','global.disableQA',get(config,'global.disableQA',false))+
    switchHtml('旧LOL查询禁用 disableLolQuery','global.disableLolQuery',get(config,'global.disableLolQuery',false))+
    switchHtml('查封号 query.lol_ban','global.featureSwitches.query.lol_ban',get(config,'global.featureSwitches.query.lol_ban',true))+
    switchHtml('查战绩 query.lol_battle','global.featureSwitches.query.lol_battle',get(config,'global.featureSwitches.query.lol_battle',true))+
    switchHtml('查隐藏 query.lol_hidden','global.featureSwitches.query.lol_hidden',get(config,'global.featureSwitches.query.lol_hidden',true))+
    switchHtml('查合集 query.lol_shard','global.featureSwitches.query.lol_shard',get(config,'global.featureSwitches.query.lol_shard',true));
  document.getElementById('queryForm').innerHTML = ''+
    inputHtml('LOL API Base','lolApiBaseUrl',get(config,'lolApiBaseUrl',''))+
    inputHtml('查封号主接口','lolBanPrimaryUrl',get(config,'lolBanPrimaryUrl',''))+
    inputHtml('战绩查询接口','lolQueryUrl',get(config,'lolQueryUrl',''))+
    inputHtml('战绩授权 key','lolAuthKey',get(config,'lolAuthKey',''))+
    selectHtml('战绩输出格式','global.lolQueryOutputFormat',get(config,'global.lolQueryOutputFormat','forward'),['forward','text','image','card'])+
    inputHtml('查询超时秒','global.lolQueryRequestTimeoutSeconds',get(config,'global.lolQueryRequestTimeoutSeconds',20),'number')+
    inputHtml('全局查询间隔秒','global.lolQueryGlobalMinIntervalSeconds',get(config,'global.lolQueryGlobalMinIntervalSeconds',1),'number')+
    inputHtml('群查询间隔秒','global.lolQueryGroupMinIntervalSeconds',get(config,'global.lolQueryGroupMinIntervalSeconds',2),'number')+
    selectHtml('合集输出格式','shardQueryOutputFormat',get(config,'shardQueryOutputFormat','image'),['image','text','forward','card'])+
    inputHtml('合集数据 URL','shardDataUrl',get(config,'shardDataUrl',''))+
    inputHtml('英雄列表 URL','shardHeroListUrl',get(config,'shardHeroListUrl',''));
  document.getElementById('sendForm').innerHTML = ''+
    switchHtml('发送包装 botSendWrapperEnabled','global.botSendWrapperEnabled',get(config,'global.botSendWrapperEnabled',false))+
    selectHtml('包装模式','global.botSendWrapperMode',get(config,'global.botSendWrapperMode','normal'),['normal','forward'])+
    switchHtml('问答包装','global.botSendWrapperQaEnabled',get(config,'global.botSendWrapperQaEnabled',false))+
    switchHtml('查询包装','global.botSendWrapperQueryEnabled',get(config,'global.botSendWrapperQueryEnabled',false))+
    switchHtml('全局包装','global.botSendWrapperAllEnabled',get(config,'global.botSendWrapperAllEnabled',false))+
    selectHtml('随机后缀模式','global.botAntiRiskSuffixMode',get(config,'global.botAntiRiskSuffixMode','mixed'),['mixed','punctuation','none','global'])+
    inputHtml('最小随机延迟 ms','global.randomDelayMin',get(config,'global.randomDelayMin',500),'number')+
    inputHtml('最大随机延迟 ms','global.randomDelayMax',get(config,'global.randomDelayMax',1500),'number')+
    inputHtml('全局每分钟上限','global.globalMaxPerMinute',get(config,'global.globalMaxPerMinute',60),'number')+
    inputHtml('每分钟撤回上限','global.maxRecallPerMinute',get(config,'global.maxRecallPerMinute',60),'number')+
    inputHtml('群熔断阈值','global.groupFuseThreshold',get(config,'global.groupFuseThreshold',45),'number')+
    inputHtml('群熔断冷却秒','global.groupFuseCooldownSeconds',get(config,'global.groupFuseCooldownSeconds',90),'number');
}
async function loadStatus(){ renderStatus(await api('/api/status')); }
async function loadConfig(){ var data=await api('/api/config'); config=data.config; document.getElementById('configEditor').value=JSON.stringify(config,null,2); renderForms(); }
async function loadCommands(){ var data=await api('/api/dynamic-commands'); document.getElementById('commandsEditor').value=JSON.stringify(data.config,null,2); }
async function savePatch(formId){ try{ var res=await api('/api/config/patch',{method:'POST',body:JSON.stringify({patch:collectPatch(formId)})}); show(res.message||'保存成功'); await loadConfig(); await loadStatus(); }catch(e){show(e.message,false);} }
async function saveRawConfig(){ try{ var parsed=JSON.parse(document.getElementById('configEditor').value); var res=await api('/api/config',{method:'POST',body:JSON.stringify({config:parsed})}); show(res.message||'保存成功'); await loadConfig(); await loadStatus(); }catch(e){show(e.message,false);} }
async function saveCommands(){ try{ var parsed=JSON.parse(document.getElementById('commandsEditor').value); var res=await api('/api/dynamic-commands',{method:'POST',body:JSON.stringify({config:parsed})}); show(res.message||'保存成功'); await loadCommands(); await loadStatus(); }catch(e){show(e.message,false);} }
async function reloadAll(){ try{ await loadStatus(); await loadConfig(); await loadCommands(); show('已刷新'); }catch(e){show(e.message,false);} }
reloadAll();
</script>
</body>
</html>`;
}

export function startSnowLumaAdminServer(options: SnowLumaAdminServerOptions): SnowLumaAdminServerRuntime {
  const logger = options.logger || console;
  const host = options.host || process.env.GROUPGUARD_WEBUI_HOST || '127.0.0.1';
  const parsedPort = options.port || Number(process.env.GROUPGUARD_WEBUI_PORT || 6108);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 6108;
  const token = options.token || process.env.GROUPGUARD_WEBUI_TOKEN || crypto.randomBytes(18).toString('hex');
  const tokenFromEnv = Boolean(options.token || process.env.GROUPGUARD_WEBUI_TOKEN);

  const requireAuth = (req: IncomingMessage, res: ServerResponse, url: URL): boolean => {
    const provided = parseAuthToken(req, url);
    if (isTokenMatch(provided, token)) return true;
    sendJson(res, 401, { ok: false, error: 'unauthorized: missing or invalid token' });
    return false;
  };

  const saveConfig = (nextConfig: any) => {
    const configObject = ensureObjectConfig(nextConfig);
    backupFile(options.configPath, options.backupDir, 'config.json');
    writeJsonFile(options.configPath, configObject);
    configStateService.setConfig(normalizePluginConfig(configObject as any));
  };

  const server: Server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        send(res, 200, renderHomePage(), 'text/html; charset=utf-8');
        return;
      }

      if (!requireAuth(req, res, url)) return;

      if (req.method === 'GET' && url.pathname === '/api/status') {
        sendJson(res, 200, getStatus(options));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        const config = readJsonFile(options.configPath, {});
        sendJson(res, 200, { ok: true, config });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config') {
        const payload = JSON.parse(await readBody(req) || '{}');
        saveConfig(payload.config ?? payload);
        sendJson(res, 200, { ok: true, message: 'config.json 已保存并已刷新运行时配置。部分连接/路径类配置仍需重启服务完全生效。' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config/patch') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const current = ensureObjectConfig(readJsonFile(options.configPath, {}));
        const next = applyPatch(current, payload.patch || {});
        saveConfig(next);
        sendJson(res, 200, { ok: true, message: '配置字段已保存并已刷新运行时配置。' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/dynamic-commands') {
        const config = ensureDynamicCommandsConfig(readJsonFile(options.dynamicCommandsConfigPath, { ...DEFAULT_DYNAMIC_COMMANDS }));
        sendJson(res, 200, { ok: true, config });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/dynamic-commands') {
        const payload = JSON.parse(await readBody(req) || '{}');
        const next = ensureDynamicCommandsConfig(payload.config ?? payload);
        backupFile(options.dynamicCommandsConfigPath, options.backupDir, 'commands.json');
        writeJsonFile(options.dynamicCommandsConfigPath, next);
        const commands = await forceReloadDynamicCommands();
        sendJson(res, 200, { ok: true, message: `动态命令已保存并重载，当前启用 ${commands.length} 条。`, count: commands.length });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error as Error)?.message || error) });
    }
  });

  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    logger.info(`[GroupGuard:SnowLumaWebUI] listening http://${host}:${port}`);
    logger.info(`[GroupGuard:SnowLumaWebUI] open http://${displayHost}:${port}/?token=${token}`);
    if (!tokenFromEnv) logger.warn(`[GroupGuard:SnowLumaWebUI] GROUPGUARD_WEBUI_TOKEN 未设置，已生成临时 token=${token}`);
  });

  return {
    host,
    port,
    token,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
