from pathlib import Path
import re

root = Path('onebot-plugin-groupguard')

def read(rel):
    return (root/rel).read_text(encoding='utf-8')

def write(rel, text):
    (root/rel).write_text(text, encoding='utf-8', newline='\n')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1, got {count}')
    return text.replace(old, new, 1)

def sub_once(text, pattern, repl, label, flags=0):
    text2, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1, got {count}')
    return text2

rel='src/core/bot_role.ts'; t=read(rel)
for line in ["    '我要看',\n", "    '设置看视频接口',\n", "    '删除看视频接口',\n", "    '看视频接口列表',\n"]:
    if line not in t: raise RuntimeError(f'{rel}: missing {line.strip()}')
    t=t.replace(line,'',1)
t=replace_once(t, "  if (queryExact.includes(text) || startsWithAny(text, queryPrefixes) || /^视频\\s+/.test(text) || text === '视频') {", "  if (queryExact.includes(text) || startsWithAny(text, queryPrefixes)) {", rel+' classifier')
write(rel,t)

rel='src/core/feature_gate.ts'; t=read(rel)
t=replace_once(t, "    'query.peer': 'peer',\n    'query.video': 'video'", "    'query.peer': 'peer'", rel)
write(rel,t)

rel='src/commands/dispatcher.ts'; t=read(rel)
t=replace_once(t, "  '我要看',\n", '', rel)
write(rel,t)

rel='src/dynamic-commands/command_response_formatter.ts'; t=read(rel)
t=replace_once(t, "    '查战绩', '查封号', '查隐藏', '查合集', '海符榜', '我要看',", "    '查战绩', '查封号', '查隐藏', '查合集', '海符榜',", rel+' prefixes')
t=replace_once(t, "    '封号接口列表', '战绩接口状态', '战绩配置', '看视频接口列表', '骗子接口状态'", "    '封号接口列表', '战绩接口状态', '战绩配置', '骗子接口状态'", rel+' exact')
write(rel,t)

rel='src/services/query_rate_limit_service.ts'; t=read(rel)
t=replace_once(t, "  if (text.startsWith('我要看')) return 'query.video';\n", '', rel)
write(rel,t)

rel='src/types.ts'; t=read(rel)
t=replace_once(t, "  videoApiTemplates?: Record<string, string>;\n", '', rel)
write(rel,t)

rel='src/config.ts'; t=read(rel)
t=sub_once(t, r"  videoApiTemplates: \{\n    搞笑: 'https://api\.pearktrue\.cn/api/random_video/\?name=搞笑',\n    热门: 'https://api\.pearktrue\.cn/api/random_video/\?name=热门'\n  \},\n", '', rel+' defaults')
t=sub_once(t, r"  const videoTemplates = merged\.videoApiTemplates \|\| \{\};\n  merged\.videoApiTemplates = Object\.entries\(videoTemplates\)\.reduce\(\(acc, \[k, v\]\) => \{\n    const key = String\(k \|\| ''\)\.trim\(\);\n    const val = String\(v \|\| ''\)\.trim\(\);\n    if \(key && val\) acc\[key\] = val;\n    return acc;\n  \}, \{\} as Record<string, string>\);\n", '', rel+' normalization')
write(rel,t)

rel='src/services/interaction_service.ts'; t=read(rel)
for line in ["  '我要看',\n", "  '设置看视频接口',\n", "  '删除看视频接口',\n", "  '看视频接口列表',\n"]:
    if line not in t: raise RuntimeError(f'{rel}: missing {line.strip()}')
    t=t.replace(line,'',1)
t=sub_once(t, r"\nfunction getVideoApiTemplates\(\): Record<string, string> \{.*?\n\}\n\nfunction pickVideoApiByCategory\(category: string\): string \| null \{.*?\n\}\n\nfunction resolveVideoRequestUrl\(template: string, category: string\): string \{.*?\n\}\n\nfunction extractVideoUrl\(data: any\): string \{.*?\n\}\n", '\n', rel+' helpers', flags=re.S)
t=sub_once(t, r"\n  if \(text\.startsWith\('设置看视频接口'\)\) \{.*?\n  if \(text\.startsWith\('设置lolurl'\)\) \{", "\n  if (text.startsWith('设置lolurl')) {", rel+' handlers', flags=re.S)
write(rel,t)

rel='src/standalone/admin/query_api.ts'; t=read(rel)
t=replace_once(t, "type QueryType = 'lol_ban' | 'lol_battle' | 'lol_hidden' | 'lol_shard' | 'lol_aram_augments' | 'scammer' | 'peer' | 'video' | 'ele_build' | 'custom';", "type QueryType = 'lol_ban' | 'lol_battle' | 'lol_hidden' | 'lol_shard' | 'lol_aram_augments' | 'scammer' | 'peer' | 'ele_build' | 'custom';", rel+' type')
t=replace_once(t, "  'scammer', 'peer', 'video', 'ele_build', 'custom'", "  'scammer', 'peer', 'ele_build', 'custom'", rel+' set')
t=replace_once(t, "  { type: 'video', name: '视频接口', trigger: '查视频/视频', featureKey: 'query.video', dataSource: 'external' },\n", '', rel+' row')
t=replace_once(t, "  if (type === 'lol_ban' || type === 'scammer' || type === 'peer' || type === 'video' || type === 'ele_build') return 'text';", "  if (type === 'lol_ban' || type === 'scammer' || type === 'peer' || type === 'ele_build') return 'text';", rel+' output')
t=sub_once(t, r"  if \(type === 'video'\) \{\n    const templates = config\.videoApiTemplates && typeof config\.videoApiTemplates === 'object' \? config\.videoApiTemplates : \{\};\n    return Object\.values\(templates\)\[0\] \? String\(Object\.values\(templates\)\[0\]\) : '';\n  \}\n", '', rel+' rowurl')
t=replace_once(t, "  if (type === 'video') return global.masterEnabled !== false && global.queryEnabled !== false && enabledSwitch(featureSwitches, 'query.video');\n", '', rel+' enable')
t=sub_once(t, r"  const templates = config\.videoApiTemplates;\n  if \(templates && \(typeof templates !== 'object' \|\| Array\.isArray\(templates\)\)\) \{\n    errors\.push\('videoApiTemplates 必须是 JSON 对象'\);\n  \} else if \(templates\) \{\n    for \(const \[key, value\] of Object\.entries\(templates\)\) \{\n      if \(!String\(key\)\.trim\(\)\) warnings\.push\('视频模板存在空名称'\);\n      warnings\.push\(\.\.\.validateUrlValue\(`视频模板 \$\{key\}`, value, false\)\);\n    \}\n  \}\n", '', rel+' validation')
t=replace_once(t, "    templateCount: item.type === 'video' && config.videoApiTemplates && typeof config.videoApiTemplates === 'object' ? Object.keys(config.videoApiTemplates).length : undefined,\n", '', rel+' count')
t=replace_once(t, "      videoApiTemplates: config.videoApiTemplates || {},\n", '', rel+' config')
t=sub_once(t, r"  if \(type === 'video'\) \{\n    const templates = config\.videoApiTemplates && typeof config\.videoApiTemplates === 'object' \? config\.videoApiTemplates : \{\};\n    const templateKey = String\(payload\?\.templateKey \|\| Object\.keys\(templates\)\[0\] \|\| ''\);\n    const template = String\(payload\?\.url \|\| templates\[templateKey\] \|\| ''\);\n    if \(!template\) throw new Error\('未配置 videoApiTemplates，也未填写测试 URL'\);\n    return replaceTemplate\(template, param, payload \|\| \{\}\);\n  \}\n", '', rel+' test URL')
t=sub_once(t, r"  if \(type === 'video'\) \{\n    const text = parsedPreview\?\.msg \|\| parsed\?\.title \|\| parsed\?\.url \|\| String\(body \|\| ''\)\.slice\(0, 120\) \|\| '接口已返回视频内容';\n    return `视频接口预览：\$\{text\}`;\n  \}\n", '', rel+' preview')
write(rel,t)

rel='src/standalone/admin/query_page.ts'; t=read(rel)
t=replace_once(t, '<section class="card"><h2>接口地址</h2><div id="urlForm" class="grid"></div><label><span>视频接口模板 JSON</span><textarea id="videoTemplates"></textarea></label><label><span>骗子查询 URL 列表，一行一个</span><textarea id="scammerUrls"></textarea></label><p class="hint">同行查询不在这里配置 URL，它走本地数据库。</p><button id="saveUrl">保存接口配置</button></section>', '<section class="card"><h2>接口地址</h2><div id="urlForm" class="grid"></div><label><span>骗子查询 URL 列表，一行一个</span><textarea id="scammerUrls"></textarea></label><p class="hint">同行查询不在这里配置 URL，它走本地数据库。</p><button id="saveUrl">保存接口配置</button></section>', rel+' html config')
t=replace_once(t, '<option value="peer">同行查询（本地库）</option><option value="video">视频接口</option><option value="ele_build">ELE下载</option>', '<option value="peer">同行查询（本地库）</option><option value="ele_build">ELE下载</option>', rel+' test option')
t=replace_once(t, '<label><span>视频模板 key / 合集数据类型</span><input id="k"></label>', '<label><span>合集数据类型</span><input id="k"></label>', rel+' key label')
t=replace_once(t, "var types=['lol_ban','lol_battle','lol_hidden','lol_shard','lol_aram_augments','scammer','peer','video','ele_build'];", "var types=['lol_ban','lol_battle','lol_hidden','lol_shard','lol_aram_augments','scammer','peer','ele_build'];", rel+' types')
t=replace_once(t, "var names={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'骗子查询',peer:'同行查询',video:'视频接口',ele_build:'ELE下载'};", "var names={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'骗子查询',peer:'同行查询',ele_build:'ELE下载'};", rel+' names')
t=replace_once(t, "var triggers={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'查骗子',peer:'查同行',video:'查视频/视频',ele_build:'ELE下载'};", "var triggers={lol_ban:'查封号',lol_battle:'查战绩',lol_hidden:'查隐藏',lol_shard:'查合集',lol_aram_augments:'海符榜',scammer:'查骗子',peer:'查同行',ele_build:'ELE下载'};", rel+' triggers')
t=replace_once(t, "var sources={lol_ban:'local-api',lol_battle:'local-api',lol_hidden:'local-api',lol_shard:'remote-json',lol_aram_augments:'local-api',scammer:'external',peer:'local-db',video:'external',ele_build:'external'};", "var sources={lol_ban:'local-api',lol_battle:'local-api',lol_hidden:'local-api',lol_shard:'remote-json',lol_aram_augments:'local-api',scammer:'external',peer:'local-db',ele_build:'external'};", rel+' sources')
t=t.replace("||type==='video'", "")
t=t.replace("if(type==='video')return s.masterEnabled!==false&&s.queryEnabled!==false&&enabledSwitch(fs,'query.video');", "")
t=t.replace("+sw('视频接口','global.featureSwitches.query.video',fs['query.video']!==false)", "")
t=t.replace("+gsw('视频接口','featureSwitches.query.video',gs['query.video']!==undefined?gs['query.video']:es['query.video']!==false)", "")
t=t.replace(";E('videoTemplates').value=JSON.stringify(c.videoApiTemplates||{},null,2)", "")
t=t.replace("p.videoApiTemplates=JSON.parse(E('videoTemplates').value||'{}');", "")
write(rel,t)

rel='src/standalone/admin/static_page.ts'; t=read(rel)
for old in [
"  'global.featureSwitches.query.video':['视频接口','控制视频查询入口。','查询功能'],\n",
"    + switchHtml('视频接口','global.featureSwitches.query.video',get(config,'global.featureSwitches.query.video',true),{meta:fieldMeta['global.featureSwitches.query.video']})\n",
"    + switchHtml('视频接口','featureSwitches.query.video',get(groupSrc,'featureSwitches.query.video',true))\n",
]:
    if old not in t: raise RuntimeError(f'{rel}: missing {old.strip()}')
    t=t.replace(old,'',1)
write(rel,t)

rel='scripts/system_stress_test.ts'; t=read(rel)
t=replace_once(t, "for (const pluginId of ['quote.daily', 'music.search', 'video.info']) {", "for (const pluginId of ['quote.daily', 'music.search']) {", rel)
write(rel,t)

rel='scripts/verify-video-retired.ts'
write(rel, """import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = path.join(root, 'src');
const commandsPath = path.join(srcRoot, 'commands.ts');
const runtimePath = path.join(srcRoot, 'dynamic-commands', 'intranet_video_runtime_plugin.ts');
const dynamicConfigPath = path.join(root, 'config', 'dynamic-commands', 'commands.json');

async function collectSourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectSourceFiles(absolute));
    else if (/\.(?:ts|js|mjs|json)$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}

const commandsSource = await readFile(commandsPath, 'utf8');
assert.doesNotMatch(commandsSource, /registerIntranetVideoCommandPlugins/);
assert.doesNotMatch(commandsSource, /intranet_video_runtime_plugin/);
await assert.rejects(access(runtimePath, constants.F_OK), 'retired video runtime file must not exist');

for (const command of ['我要看', '设置看视频接口', '删除看视频接口']) {
  assert.equal(INTERACTION_PREFIXES.includes(command), false, `legacy route still claims ${command}`);
  assert.equal(INTERACTION_EXACT.includes(command), false, `legacy exact route still claims ${command}`);
}
assert.equal(INTERACTION_EXACT.includes('看视频接口列表'), false);

const dynamicConfig = JSON.parse(await readFile(dynamicConfigPath, 'utf8'));
assert.equal(dynamicConfig.commands.some((command: any) => command.id === 'video.info'), false);
assert.equal(dynamicConfig.commands.some((command: any) => String(command?.trigger?.value || '').startsWith('视频')), false);

const forbiddenRuntimeMarkers = [
  '我要看',
  '设置看视频接口',
  '删除看视频接口',
  '看视频接口列表',
  'videoApiTemplates',
  'query.video',
  'video.info',
  'intranet_video_runtime_plugin',
  'registerIntranetVideoCommandPlugins'
];
for (const file of await collectSourceFiles(srcRoot)) {
  const source = await readFile(file, 'utf8');
  for (const marker of forbiddenRuntimeMarkers) {
    assert.equal(source.includes(marker), false, `retired video query marker ${marker} remains in ${path.relative(root, file)}`);
  }
}

console.log('retired video command verification passed');
""")

rel='scripts/verify-all-query-client-boundary.ts'; t=read(rel)
t=replace_once(t, "  '查隐藏',\n  '我要看',\n  '查骗子',", "  '查隐藏',\n  '查骗子',", rel+' migrated')
t=replace_once(t, "  '删除封号备用接口',\n  '设置看视频接口',\n  '删除看视频接口',\n  '设置lolurl',", "  '删除封号备用接口',\n  '设置lolurl',", rel+' config commands')
t=replace_once(t, "for (const command of ['封号接口列表', '看视频接口列表', '骗子接口状态']) {", "for (const command of ['封号接口列表', '骗子接口状态']) {", rel+' exact list')
insert = """
const retiredVideoMarkers = [
  '我要看',
  '设置看视频接口',
  '删除看视频接口',
  '看视频接口列表',
  'videoApiTemplates',
  'query.video',
  'video.info',
  'intranet_video_runtime_plugin',
  'registerIntranetVideoCommandPlugins'
];
async function collectRuntimeSourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectRuntimeSourceFiles(absolute));
    else if (/\.(?:ts|js|mjs|json)$/i.test(entry.name)) result.push(absolute);
  }
  return result;
}
for (const file of await collectRuntimeSourceFiles(srcRoot)) {
  const source = await readFile(file, 'utf8');
  for (const marker of retiredVideoMarkers) {
    assert.equal(source.includes(marker), false, `retired video query marker ${marker} remains in ${path.relative(root, file)}`);
  }
}
"""
anchor="const commandsSource = await text('src/commands.ts');\n"
t=replace_once(t, anchor, insert+'\n'+anchor, rel+' insert')
write(rel,t)

print('patched')
