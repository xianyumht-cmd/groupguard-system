import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'src', 'standalone', 'admin', 'static_page.ts');
const text = fs.readFileSync(file, 'utf8');

assert.match(text, /#advancedForm \.field-path\{display:none\}/, '全量配置应隐藏英文配置路径');
assert.match(text, /前端只显示中文名称和中文说明/, '全量配置应说明仅显示中文');
assert.match(text, /placeholder="例如：战绩、签到、自动撤回、内容风险"/, '搜索框示例应为中文');
assert.match(text, /function translateConfigFieldName\(name\)/, '应存在通用字段中文翻译函数');
assert.match(text, /return \[translateConfigFieldName\(last\), '', group\];/, '未登记字段应使用中文翻译结果');
assert.match(text, /lolApiBaseUrl:\['英雄联盟接口根地址'/, '英雄联盟接口字段应为中文');
assert.match(text, /eleBuildApiBaseUrl:\['构建工具接口根地址'/, '构建接口字段应为中文');
assert.match(text, /shardDataUrl:\['合集数据地址'/, '合集数据字段应为中文');
assert.match(text, /shardHeroListUrl:\['英雄列表地址'/, '英雄列表字段应为中文');

// 只检查全量配置字段元数据。其他独立页面可以继续使用其现有业务名称，
// 不能因为“构建工具”页面中仍有 API Base 文案而误判全量配置中文化失败。
assert.doesNotMatch(text, /lolApiBaseUrl:\['LOL API Base'/, '全量配置不应使用 LOL API Base 标题');
assert.doesNotMatch(text, /eleBuildApiBaseUrl:\['ELE API Base'/, '全量配置不应使用 ELE API Base 标题');
assert.doesNotMatch(text, /shardDataUrl:\['合集数据 URL'/, '全量配置不应使用带 URL 的英文标题');
assert.doesNotMatch(text, /shardHeroListUrl:\['英雄列表 URL'/, '全量配置不应使用带 URL 的英文标题');

const match = text.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
assert.ok(match, '应能提取控制台内嵌脚本');
assert.doesNotThrow(() => new Function(match[1]), '控制台内嵌脚本语法应有效');

console.log('advanced config Chinese localization verification passed');
