import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.dirname(new URL(import.meta.url).pathname);
const sourcePath = path.join(dir, 'apply-project-wide-bug-fixes-20260801.mjs');
const generatedPath = path.join(dir, '.apply-project-wide-bug-fixes-20260801.generated.mjs');
let source = fs.readFileSync(sourcePath, 'utf8');

source = source.replace(
  "  if (matches.length !== 1) throw new Error(`regex target count ${matches.length}: ${label}`);",
  "  const globalReplacement = regex.flags.includes('g');\n  if ((!globalReplacement && matches.length !== 1) || (globalReplacement && matches.length === 0)) {\n    throw new Error(`regex target count ${matches.length}: ${label}`);\n  }"
);

source = source.replace(
  /replaceOnce\(\n  p\('src\/state\.ts'\),\n  `    const force = options\?\.force !== false;`,[\s\S]*?  'private force defaults false'\n\);/,
  `{
  const rel = p('src/state.ts');
  const before = '    const force = options?.force !== false;';
  const after = '    const force = options?.force === true;';
  const current = read(rel);
  if (!current.includes(before)) {
    if (!current.includes(after)) throw new Error('patch target missing: force defaults false');
  } else {
    const count = current.split(before).length - 1;
    if (count !== 3) throw new Error(\`unexpected force default count: \${count}\`);
    write(rel, current.split(before).join(after));
  }
}`
);

source = source.replace(
  /replaceOnce\(\n  p\('src\/state\.ts'\),\n  `      this\.recordBotSendEvent\(\{\\n        groupId: task\.groupId,`,[\s\S]*?  'forward fallback recall audit'\n\);/,
  `{
  const rel = p('src/state.ts');
  let current = read(rel);
  if (!current.includes('const selfRecallDueAt = this.scheduleSelfRecall(task.groupId, messageId')) {
    const methodPattern = /(private async sendGroupForwardFallback[\\s\\S]*?const messageId = this\\.extractSendMessageId\\(res\\);\\n)(      this\\.recordBotSendEvent\\(\\{[\\s\\S]*?        sentAt: Date\\.now\\(\\),\\n        status: 'sent',)/;
    const match = current.match(methodPattern);
    if (!match) throw new Error('patch target missing: forward fallback method');
    const patchedBody = match[2]
      .replace("        sentAt: Date.now(),\\n        status: 'sent',", "        sentAt,\\n        selfRecallDueAt,\\n        status: 'sent',");
    current = current.replace(methodPattern, \`\${match[1]}      const sentAt = Date.now();\\n      const selfRecallDueAt = this.scheduleSelfRecall(task.groupId, messageId, 'send_group_msg');\\n      this.markGroupSend(task.groupId);\\n\${patchedBody}\`);
    write(rel, current);
  }
}`
);

source = source.replace(
  "        if (generatedFileUploads.size >= 2000) generatedFileUploads.delete(generatedFileUploads.keys().next().value);",
  "        if (generatedFileUploads.size >= 2000) {\n          const oldestKey = generatedFileUploads.keys().next().value as string | undefined;\n          if (oldestKey) generatedFileUploads.delete(oldestKey);\n        }"
);
source = source.replace(
  "  'handleSocketFailure',\n  'socket failure helper'",
  "  'private handleSocketFailure(',\n  'socket failure helper'"
);
source = source.replace(
  "function mapEnqueueFailureCode(result: Exclude<ReturnType<typeof enqueueTask>, 'ok'>): string {",
  "function mapEnqueueFailureCode(result: Exclude<ReturnType<typeof enqueueTask>, 'ok'>): GuardResult['code'] {"
);

const finalMarker = "console.log(JSON.stringify({ ok: true, changed }, null, 2));";
source = source.replace(finalMarker, `replaceOnce(
  p('src/services/action_guard_service.ts'),
  "  code: 'ok' | 'unknown_timeout' | 'skip_bot_not_admin' | 'skip_target_protected' | 'skip_duplicate' | 'skip_rate_limited' | 'skip_risk_protect' | 'skip_replaced' | 'skip_queue_overflow' | 'queue_reset' | 'action_failed_timeout' | 'fail_api' | 'backpressure_reject';",
  "  code: 'ok' | 'unknown_timeout' | 'skip_bot_not_admin' | 'skip_target_protected' | 'skip_duplicate' | 'skip_rate_limited' | 'skip_risk_protect' | 'skip_replaced' | 'skip_queue_overflow' | 'queue_reset' | 'action_failed_timeout' | 'fail_api' | 'backpressure_reject' | 'bot_role_blocked';",
  'guard result bot role code'
);

replaceOnce(
  p('scripts/verify-core-stability.ts'),
  \`    assert.equal(globalEvicted, 1, 'force overflow must settle the evicted global task');
    state.globalSendQueue.at(-1)?.resolve();
    await globalAccepted;

    let groupEvicted = 0;\`,
  \`    assert.equal(globalEvicted, 0, 'force overflow must preserve existing global tasks');
    assert.equal(state.globalSendQueue.length, 100, 'force overflow must not grow the global queue');
    await globalAccepted;

    let groupEvicted = 0;\`,
  'global force overflow regression'
);
replaceOnce(
  p('scripts/verify-core-stability.ts'),
  \`    assert.equal(groupEvicted, 1, 'force overflow must settle the evicted group task');
    state.groupSendQueues.get('group-a')?.at(-1)?.resolve();
    await groupAccepted;

    let oldModeSettled = false;\`,
  \`    assert.equal(groupEvicted, 0, 'force overflow must preserve existing group tasks');
    assert.equal(state.groupSendQueues.get('group-a')?.length, 20, 'force overflow must not grow the group queue');
    await groupAccepted;

    let oldModeSettled = false;\`,
  'group force overflow regression'
);

${finalMarker}`);

fs.writeFileSync(generatedPath, source, 'utf8');
try {
  await import(`${pathToFileURL(generatedPath).href}?v=${Date.now()}`);
} finally {
  try { fs.unlinkSync(generatedPath); } catch { /* noop */ }
}
