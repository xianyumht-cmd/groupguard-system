import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function absolute(relative) {
  return path.join(root, relative);
}

function read(relative) {
  return fs.readFileSync(absolute(relative), 'utf8');
}

function write(relative, content) {
  const target = absolute(relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.replace(/\r\n/g, '\n'), 'utf8');
}

function replaceExact(relative, oldText, newText) {
  const content = read(relative);
  if (!content.includes(oldText)) {
    throw new Error(`expected block missing in ${relative}: ${JSON.stringify(oldText.slice(0, 120))}`);
  }
  write(relative, content.replace(oldText, newText));
}

function appendOnce(relative, marker, section) {
  const content = read(relative);
  if (content.includes(marker)) return;
  write(relative, `${content.trimEnd()}\n\n${section.trim()}\n`);
}

function removeLinesContaining(relative, needles) {
  const content = read(relative);
  const filtered = content
    .split(/\r?\n/)
    .filter((line) => !needles.some((needle) => line.includes(needle)));
  write(relative, `${filtered.join('\n').trimEnd()}\n`);
}

// 1. Remove the formal built-in video plugin registration.
replaceExact(
  'src/commands.ts',
  "import { registerIntranetVideoCommandPlugins } from './dynamic-commands/intranet_video_runtime_plugin';\n",
  ''
);
replaceExact('src/commands.ts', '  registerIntranetVideoCommandPlugins();\n', '');

const runtimePath = absolute('src/dynamic-commands/intranet_video_runtime_plugin.ts');
if (!fs.existsSync(runtimePath)) throw new Error('expected intranet video runtime plugin is missing');
fs.unlinkSync(runtimePath);

// 2. Replace the old positive video verifier with an explicit retirement gate.
const oldVerifier = absolute('scripts/verify-intranet-video-command.ts');
if (!fs.existsSync(oldVerifier)) throw new Error('expected old video verifier is missing');
fs.unlinkSync(oldVerifier);
write(
  'scripts/verify-video-retired.ts',
  [
    "import assert from 'node:assert/strict';",
    "import { access, readFile } from 'node:fs/promises';",
    "import { constants } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { INTERACTION_EXACT, INTERACTION_PREFIXES } from '../src/commands/modules/interaction.ts';",
    '',
    "const commandsPath = fileURLToPath(new URL('../src/commands.ts', import.meta.url));",
    "const runtimePath = fileURLToPath(new URL('../src/dynamic-commands/intranet_video_runtime_plugin.ts', import.meta.url));",
    "const dynamicConfigPath = fileURLToPath(new URL('../config/dynamic-commands/commands.json', import.meta.url));",
    '',
    "const commandsSource = await readFile(commandsPath, 'utf8');",
    'assert.doesNotMatch(commandsSource, /registerIntranetVideoCommandPlugins/);',
    'assert.doesNotMatch(commandsSource, /intranet_video_runtime_plugin/);',
    '',
    "await assert.rejects(access(runtimePath, constants.F_OK), 'retired video runtime file must not exist');",
    '',
    "for (const command of ['我要看', '设置看视频接口', '删除看视频接口']) {",
    "  assert.equal(INTERACTION_PREFIXES.includes(command), false, `legacy route still claims ${command}`);",
    "  assert.equal(INTERACTION_EXACT.includes(command), false, `legacy exact route still claims ${command}`);",
    '}',
    "assert.equal(INTERACTION_EXACT.includes('看视频接口列表'), false);",
    '',
    "const dynamicConfig = JSON.parse(await readFile(dynamicConfigPath, 'utf8'));",
    "assert.equal(dynamicConfig.commands.some((command: any) => command.id === 'video.info'), false);",
    "assert.equal(dynamicConfig.commands.some((command: any) => String(command?.trigger?.value || '').startsWith('视频')), false);",
    '',
    "console.log('retired video command verification passed');",
    ''
  ].join('\n')
);

// 3. Remove the default dynamic video command too.
const dynamicConfigPath = absolute('config/dynamic-commands/commands.json');
const dynamicConfig = JSON.parse(fs.readFileSync(dynamicConfigPath, 'utf8'));
if (!Array.isArray(dynamicConfig.commands)) throw new Error('dynamic command config is invalid');
const videoCommands = dynamicConfig.commands.filter((item) => item?.id === 'video.info');
if (videoCommands.length !== 1) throw new Error(`expected one video.info command, got ${videoCommands.length}`);
dynamicConfig.commands = dynamicConfig.commands.filter((item) => item?.id !== 'video.info');
fs.writeFileSync(dynamicConfigPath, `${JSON.stringify(dynamicConfig, null, 2)}\n`, 'utf8');

// 4. Update package scripts so every test/build path runs the retirement gate.
const packagePath = absolute('package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  if (typeof command !== 'string') continue;
  pkg.scripts[name] = command.replaceAll('verify:intranet-video-command', 'verify:video-retired');
}
delete pkg.scripts['verify:intranet-video-command'];
pkg.scripts['verify:video-retired'] = 'node --experimental-strip-types --import ./scripts/register-ts-loader.mjs scripts/verify-video-retired.ts';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

// 5. Update dynamic and all-query gates.
replaceExact(
  'scripts/verify-intranet-dynamic-command.ts',
  "assert.deepEqual(defaultConfig.commands.map((command: any) => command.id), [\n  'quote.daily',\n  'music.search',\n  'video.info'\n]);",
  "assert.deepEqual(defaultConfig.commands.map((command: any) => command.id), [\n  'quote.daily',\n  'music.search'\n]);"
);
replaceExact(
  'scripts/verify-all-query-client-boundary.ts',
  "  'registerIntranetHiddenCommandPlugins()',\n  'registerIntranetVideoCommandPlugins()',\n  'registerIntranetRiskCommandPlugins()'",
  "  'registerIntranetHiddenCommandPlugins()',\n  'registerIntranetRiskCommandPlugins()'"
);
replaceExact(
  'scripts/verify-all-query-client-boundary.ts',
  "assert.ok(activeRuntimeFiles.length >= 6, 'expected all intranet query runtime modules');",
  "assert.ok(activeRuntimeFiles.length >= 5, 'expected all retained intranet query runtime modules');\nassert.equal(activeRuntimeFiles.includes('intranet_video_runtime_plugin.ts'), false, 'retired video runtime must not exist');\nassert.doesNotMatch(commandsSource, /registerIntranetVideoCommandPlugins|intranet_video_runtime_plugin/);"
);
replaceExact(
  'scripts/verify-all-query-client-boundary.ts',
  "assert.ok(Array.isArray(dynamicConfig.commands) && dynamicConfig.commands.length > 0);",
  "assert.ok(Array.isArray(dynamicConfig.commands) && dynamicConfig.commands.length > 0);\nassert.equal(dynamicConfig.commands.some((command: any) => command.id === 'video.info'), false);\nassert.equal(dynamicConfig.commands.some((command: any) => String(command?.trigger?.value || '').startsWith('视频')), false);"
);

// 6. Update machine-readable plan.
const planPath = absolute('docs/plans/ALL_QUERY_INTRANET_CLIENT_20260729.json');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
plan.status = 'video_retirement_code_verified_waiting_for_video_free_service_deploy';
plan.product_decisions = {
  ...(plan.product_decisions || {}),
  video_query: {
    decision: 'retired',
    decided_at_local: '2026-07-30T03:38:00+08:00',
    reason: 'User cancelled the entire 我要看 category video feature after provider diagnosis.',
    old_dist_commit: '029118346adaa9232aeceeb283f5d243a407dc95',
    old_dist_status: 'revoked_do_not_deploy'
  }
};
plan.inventory = (plan.inventory || []).filter((item) => item?.feature !== 'video');
for (const item of plan.inventory || []) {
  if (item?.feature === 'dynamic' && typeof item.command === 'string') {
    item.command = item.command.replace('/视频', '').replace('视频及', '及');
  }
}
for (const step of plan.steps || []) {
  if (step?.id === 'GG-AQ-VIDEO-001') {
    step.status = 'cancelled_by_product_decision';
    step.replacement = 'GG-AQ-VIDEO-RETIRE-001';
  }
}
plan.steps = [
  ...(plan.steps || []),
  {
    id: 'GG-AQ-VIDEO-RETIRE-001',
    status: 'code_verified_waiting_for_video_free_service_deploy',
    removed_commands: ['我要看', '视频 '],
    removed_features: ['video', 'video.info']
  }
];
plan.release_candidate = {
  ...(plan.release_candidate || {}),
  previous_groupguard_head_with_video: plan.release_candidate?.groupguard_head,
  previous_dist_artifact_id: plan.release_candidate?.dist_artifact_id,
  previous_dist_status: 'revoked_do_not_deploy',
  groupguard_head: 'pending_video_free_client_commit',
  dist_artifact_id: null,
  dist_only_zip_sha256: null,
  dist_delivery_blocked_until_service_acceptance: true
};
plan.next_action = {
  repository: 'xianyumht-cmd/lolapisevers',
  step_id: 'AQ-VIDEO-RETIRE-DEPLOY-001',
  summary: 'Deploy and accept the video-free Windows service before packaging or deploying the new GroupGuard dist.'
};
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

// 7. Keep current human docs from advertising retired video scope.
for (const relative of [
  'docs/plans/ALL_QUERY_INTRANET_CLIENT_20260729.md',
  'docs/architecture/CHANNEL_NEUTRAL_QUERY_CLIENT_BOUNDARY.md'
]) {
  removeLinesContaining(relative, ['`video`', '我要看', 'video.info']);
}

appendOnce(
  'docs/checkpoints/ALL_QUERY_RELEASE_VERIFICATION_20260730.md',
  '## 视频功能取消后的重新验证',
  [
    '## 视频功能取消后的重新验证',
    '',
    '- “我要看”内网运行插件和注册已删除；',
    '- 默认动态“视频 ”命令及 `video.info` 已删除；',
    '- 所有 test/build 路径改为运行 `verify:video-retired`；',
    '- 全查询边界门禁确认正式客户端不再存在 video 运行模块或触发器；',
    '- 旧封存 dist `029118346adaa9232aeceeb283f5d243a407dc95` 已作废，禁止部署。',
    '',
    '新无视频 dist 只能在 Windows 无视频 API 小版本部署并通过直接协议验收后重新构建。'
  ].join('\n')
);
appendOnce(
  'docs/checkpoints/ALL_QUERY_NEXT_CHAT_HANDOFF_20260730.md',
  '## 2026-07-30 GroupGuard 视频移除代码阶段完成',
  [
    '## 2026-07-30 GroupGuard 视频移除代码阶段完成',
    '',
    '已完成并由一次性工作流全量验证后提交：',
    '',
    '- 删除 `registerIntranetVideoCommandPlugins`；',
    '- 删除 `intranet_video_runtime_plugin.ts`；',
    '- 删除“我要看”及默认动态“视频 ”正式入口；',
    '- 原视频正向门禁改为 `verify:video-retired`；',
    '- npm test、SnowLuma build 和全查询边界门禁均要求视频入口不存在；',
    '- 旧含视频 dist 继续保持作废。',
    '',
    '下一步必须先完成 Windows 无视频 API 部署与验收，再封存新的无视频 dist。'
  ].join('\n')
);

console.log('retired GroupGuard video feature removal prepared successfully');
