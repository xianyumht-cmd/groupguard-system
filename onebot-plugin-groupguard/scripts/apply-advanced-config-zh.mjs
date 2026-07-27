import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'src', 'standalone', 'admin', 'static_page.ts');
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (text.includes(after)) return;
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one source marker, found ${count}`);
  text = text.replace(before, after);
}

replaceOnce(
  '.section-title{grid-column:1/-1;border-bottom:1px solid #263349;padding:12px 0 4px;margin-top:4px;color:#bfdbfe;font-weight:700}',
  '.section-title{grid-column:1/-1;border-bottom:1px solid #263349;padding:12px 0 4px;margin-top:4px;color:#bfdbfe;font-weight:700}\n#advancedForm .field-path{display:none}',
  'hide advanced English paths',
);

replaceOnce(
  '这里保留全部 config.json 字段，但显示为中文名称、英文路径和说明。搜索支持中文名、英文路径和说明。',
  '这里保留全部配置能力，但前端只显示中文名称和中文说明。底层配置字段与保存结构保持不变。',
  'advanced hint',
);

replaceOnce(
  'placeholder="例如 战绩、签到、selfRecall、contentRisk"',
  'placeholder="例如：战绩、签到、自动撤回、内容风险"',
  'advanced search placeholder',
);

const localizationBlock = String.raw`var configFieldPhraseZh = {
  enabled:'启用', disabled:'禁用', masterEnabled:'总开关', activeReplyEnabled:'主动回复开关', dynamicCommandEnabled:'动态命令开关', queryEnabled:'查询总开关', qaEnabled:'问答总开关',
  cooldownSeconds:'冷却秒数', cooldownMinutes:'冷却分钟数', cooldownMs:'冷却毫秒数', timeoutMs:'超时毫秒数', delayMinMs:'最小延迟毫秒数', delayMaxMs:'最大延迟毫秒数',
  minDelay:'最小延迟', maxDelay:'最大延迟', fixedDelay:'固定延迟', retryCount:'重试次数', retryDelayMs:'重试间隔毫秒数', messageLookupAttempts:'消息查找次数', messageLookupDelayMs:'消息查找间隔毫秒数',
  maxFileSizeMb:'最大文件大小（MB）', maxBytes:'最大字节数', maxPerMinute:'每分钟上限', maxQueueSize:'队列容量上限', maxQueueSizeGlobal:'全局队列容量上限', maxQueueSizePerGroup:'单群队列容量上限',
  sourceGroupId:'来源群号', targetGroupId:'接收群号', sourceUploaderIds:'上传者 QQ 列表', targetFolderId:'接收群文件夹', fileNamePattern:'文件名匹配规则',
  keepLatestOnly:'仅保留最新内容', deletePreviousTargetFile:'删除上一份接收群文件', recallPreviousTargetMessage:'撤回上一份接收群消息', syncSourceRecall:'同步来源群撤回',
  baseUrl:'接口根地址', apiBaseUrl:'接口根地址', primaryUrl:'主接口地址', queryUrl:'查询接口地址', queryUrls:'查询接口地址列表', dataUrl:'数据地址', imageUrl:'图片地址', imageUrlTemplate:'图片地址模板', heroListUrl:'英雄列表地址',
  authKey:'接口授权密钥', licenseKey:'授权密钥', accessToken:'访问令牌', commandPrefix:'命令前缀', commandAliases:'命令别名', textTemplates:'文本模板', noticeText:'提示文本', reason:'处理原因',
  outputFormat:'输出格式', resultMode:'结果模式', queueMode:'队列模式', resourceMode:'资源发送模式', suffixMode:'随机后缀模式', wrapperMode:'发送包装模式', urlMode:'网址处理模式', riskPresetLevel:'风险推荐档位',
  probability:'触发概率', replyProbability:'回复概率', successRate:'成功率', exchangeRate:'兑换比例', taxRate:'税率', concurrency:'并发数', threshold:'触发阈值', interval:'执行间隔',
  protectAdminActions:'保护管理员操作', protectOwnerActions:'保护群主操作', allowRecallAdminMessage:'允许处理管理员消息', allowRecallOwnerMessage:'允许处理群主消息', blacklistCheckBeforeCommand:'命令前黑名单检测',
  wrapInCodeBlock:'使用代码块包装', applyToPrivate:'应用于私聊', applyToForward:'应用于合并转发', logOnly:'仅记录不处理', notifyGroup:'在群内通知',
  urlAllowlist:'网址白名单', urlBlocklist:'网址黑名单', qrDetectTimeoutMs:'二维码检测超时毫秒数', qrDetectMaxBytes:'二维码检测最大字节数', qrDetectConcurrency:'二维码检测并发数', qrCacheSeconds:'二维码缓存秒数',
  groupInviteDetectUrl:'检测群邀请网址', groupInviteDetectCard:'检测群邀请卡片', groupInviteDetectForward:'检测群邀请合并转发',
  dailyWelfareGold:'每日福利黄金', initialGold:'初始黄金', initialRacingCoins:'初始赛车币', initialFuel:'初始汽油', maxFuel:'汽油上限', duelCostFuel:'对决消耗汽油', raceCostFuel:'比赛消耗汽油',
  carCoinExchangeRate:'赛车币兑换比例', fuelExchangeRate:'汽油兑换比例', pkCooldownSeconds:'对战冷却秒数', escapeSuccessRate:'逃跑成功率', snatchSuccessRate:'抢夺成功率', contractTaxRate:'契约税率', rankLimit:'排行显示数量'
};
var configFieldTokenZh = {
  global:'全局', group:'群', groups:'群', user:'用户', users:'用户', owner:'主人', owners:'主人', admin:'管理员', bot:'机器人', self:'自身', master:'总',
  enabled:'启用', disabled:'禁用', enable:'启用', disable:'禁用', active:'主动', silent:'静默', debug:'调试', use:'使用', default:'默认', custom:'自定义',
  qa:'问答', query:'查询', command:'命令', commands:'命令', dynamic:'动态', reply:'回复', message:'消息', messages:'消息', text:'文本', notice:'提示', welcome:'欢迎', verify:'验证', approve:'同意',
  feature:'功能', features:'功能', switch:'开关', switches:'开关', mode:'模式', format:'格式', output:'输出', result:'结果', level:'等级', preset:'推荐档位',
  lol:'英雄联盟', battle:'战绩', ban:'封号', hidden:'隐藏', shard:'合集', hero:'英雄', scammer:'骗子', peer:'同行', video:'视频', image:'图片', card:'卡片',
  url:'网址', urls:'网址列表', api:'接口', base:'根', primary:'主', auth:'授权', key:'密钥', token:'令牌', host:'主机', port:'端口', endpoint:'接口', callback:'回调',
  data:'数据', file:'文件', files:'文件', name:'名称', pattern:'匹配规则', folder:'文件夹', path:'路径', resource:'资源', resources:'资源', build:'构建',
  source:'来源', target:'接收', uploader:'上传者', latest:'最新', previous:'上一份', keep:'保留', delete:'删除', recall:'撤回', sync:'同步', lookup:'查找', history:'历史',
  max:'最大', min:'最小', size:'大小', bytes:'字节', mb:'兆字节', count:'数量', limit:'上限', threshold:'阈值', probability:'概率', rate:'比例', concurrency:'并发数',
  timeout:'超时', delay:'延迟', retry:'重试', attempts:'次数', interval:'间隔', seconds:'秒数', second:'秒', minutes:'分钟', minute:'分钟', hours:'小时', days:'天数', ms:'毫秒',
  queue:'队列', globalMax:'全局上限', fuse:'熔断', cooldown:'冷却', random:'随机', fixed:'固定', jitter:'额外抖动', auto:'自动', before:'前置', after:'后置',
  risk:'风险', content:'内容', outgoing:'发送内容', action:'处理动作', actions:'处理动作', protect:'保护', allow:'允许', apply:'应用', private:'私聊', forward:'合并转发', wrapper:'包装', suffix:'后缀', scene:'场景', policies:'策略',
  blacklist:'黑名单', whitelist:'白名单', allowlist:'白名单', blocklist:'黑名单', spam:'刷屏', repeat:'复读', invite:'邀请', contact:'名片', record:'语音', qr:'二维码', detect:'检测', cache:'缓存',
  signin:'签到', lottery:'抽奖', activity:'活跃', emoji:'表情', anti:'防护', report:'举报', join:'入群',
  sub:'娱乐玩法', gameplay:'玩法', light:'轻量', entertainment:'娱乐', racing:'赛车', servant:'仆从', contract:'契约', gold:'黄金', fuel:'汽油', coin:'币', exchange:'兑换', tax:'税率', rank:'排行', template:'模板', aliases:'别名', initial:'初始', daily:'每日', welfare:'福利', cost:'消耗', duel:'对决', race:'比赛', escape:'逃跑', snatch:'抢夺', success:'成功',
  normal:'普通', off:'关闭', on:'开启', none:'无', mixed:'混合', punctuation:'标点', low:'低', medium:'中', high:'高', strict:'严格', autoApprove:'自动同意'
};
function splitConfigFieldWords(name){
  return String(name||'')
    .replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
    .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
    .replace(/[_.\-]+/g,' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}
function translateConfigFieldName(name){
  var raw=String(name||'').trim();
  if(!raw) return '其他设置';
  if(configFieldPhraseZh[raw]) return configFieldPhraseZh[raw];
  var words=splitConfigFieldWords(raw);
  var translated=words.map(function(word){
    var lower=word.toLowerCase();
    return configFieldTokenZh[lower] || configFieldPhraseZh[word] || '参数';
  }).join('');
  translated=translated.replace(/参数参数+/g,'其他参数');
  return translated || '其他设置';
}
`;

replaceOnce(
  'var fieldMeta = {',
  `${localizationBlock}\nvar fieldMeta = {`,
  'insert localization dictionary',
);

const exactReplacements = new Map([
  ["lolApiBaseUrl:['LOL API Base','本地 LOL 查询服务根地址。','接口地址']", "lolApiBaseUrl:['英雄联盟接口根地址','本地英雄联盟查询服务的根地址。','接口地址']"],
  ["lolQueryUrl:['自定义战绩查询 URL','旧自定义战绩接口地址。','接口地址']", "lolQueryUrl:['自定义战绩查询地址','旧版自定义战绩查询接口地址。','接口地址']"],
  ["lolAuthKey:['战绩授权 Key','旧自定义战绩接口授权码。','接口地址']", "lolAuthKey:['战绩接口授权密钥','旧版自定义战绩接口的授权密钥。','接口地址']"],
  ["lolBanPrimaryUrl:['查封号主接口','查封号主查询接口。','接口地址']", "lolBanPrimaryUrl:['查封号主接口地址','查封号功能优先使用的查询接口。','接口地址']"],
  ["eleBuildApiBaseUrl:['ELE API Base','ELE 构建/下载接口根地址。','接口地址']", "eleBuildApiBaseUrl:['构建工具接口根地址','构建和下载功能使用的接口根地址。','接口地址']"],
  ["shardDataUrl:['合集数据 URL','英雄合集数据 JSON 地址。','接口地址']", "shardDataUrl:['合集数据地址','英雄合集数据文件地址。','接口地址']"],
  ["shardHeroListUrl:['英雄列表 URL','LOL 英雄列表数据地址。','接口地址']", "shardHeroListUrl:['英雄列表地址','英雄联盟英雄列表数据地址。','接口地址']"],
  ["shardImageUrlTemplate:['合集图片模板','查合集图片输出接口模板。','接口地址']", "shardImageUrlTemplate:['合集图片地址模板','查合集图片输出接口的地址模板。','接口地址']"],
  ["scammerQueryUrls:['骗子查询接口列表','骗子查询 URL 列表。','接口地址']", "scammerQueryUrls:['骗子查询接口列表','骗子查询使用的接口地址列表。','接口地址']"],
  ["else if(key.indexOf('subGameplay')>=0) group='SUB玩法';", "else if(key.indexOf('subGameplay')>=0) group='娱乐玩法';"],
  ["return [last, '', group];", "return [translateConfigFieldName(last), '', group];"],
  ["'内容风险','SUB玩法','接口地址','其他'", "'内容风险','娱乐玩法','接口地址','其他'"],
]);

for (const [before, after] of exactReplacements) {
  replaceOnce(before, after, `replace ${before.slice(0, 35)}`);
}

fs.writeFileSync(file, text, 'utf8');
console.log(`advanced config Chinese localization applied: ${file}`);
