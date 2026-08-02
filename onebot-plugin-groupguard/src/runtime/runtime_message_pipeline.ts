import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import type { OneBotMessageEvent } from '../protocol/onebot11/types';
import { authManager } from '../auth';
import { isQaOnlyBotRole, isQueryOnlyBotRole, shouldBlockByBotRole } from '../core/bot_role';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { runtimeControlService } from '../core/state-services/runtime_control_service';
import {
  handleCommand, handleAntiRecall, cacheMessage, handleEmojiReact,
  handleCardLockCheck, handleCardLockOnMessage, handleAutoRecall,
  handleBlacklist, handleFilterKeywords, handleSpamDetect,
  handleMsgTypeFilter, handleQA, recordActivity
} from '../commands';
import { handleVerifyAnswer } from '../verify';
import { runWithForcedResponseScene } from '../dynamic-commands/response_capture_runtime';
import { shouldBypassGroupFileMirrorGlobalRecall } from '../services/group_file_mirror_message_adapter';

export async function handlePluginMessage(ctx: GroupGuardRuntimeContext, event: OneBotMessageEvent): Promise<void> {
  if (event.post_type !== 'message' && event.post_type !== 'message_sent') return;

  const userId = String(event.user_id);
  const raw = event.raw_message || '';
  const messageId = String(event.message_id);
  const selfId = String((event as any).self_id || '');
  const messageSegments = (event as any).message || [];

  if (event.message_type === 'private') {
    await handleCommand(event, ctx);
    return;
  }

  if (event.message_type === 'group') {
    const groupId = String(event.group_id);
    const license = authManager.getGroupLicense(groupId);
    if (!license) {
      return;
    }

    if (userId === selfId) {
      // Native files uploaded by GroupFileMirror own their whole lifecycle.
      // They bypass the existing global risk/self-recall scheduler and are
      // cleaned only by the mirror's direct delete_msg + delete_group_file path.
      if (shouldBypassGroupFileMirrorGlobalRecall(event)) {
        loggingStateService.debug(
          `[GroupFileMirror] 原生群文件消息已绕过全局风控撤回 group=${groupId} message=${messageId}`,
        );
        return;
      }

      if (isQueryOnlyBotRole()) {
        const block = shouldBlockByBotRole({ source: 'runtime_message_pipeline', rawMessage: raw, intent: 'self_recall_like', actionType: 'self_recall' });
        if (block.blocked) loggingStateService.info(block.logLine || `bot_role_blocked role=query intent=self_recall_like rawMessage=${raw} source=runtime_message_pipeline`);
        return;
      }
      runtimeControlService.scheduleSelfRecall(groupId, messageId, 'message_event');
      return;
    }

    const isWhite = authStateService.isWhitelisted(userId);
    const settings = configStateService.resolveGroupSettings(groupId);
    const precheck = settings.blacklistCheckBeforeCommand !== false;

    if (!isWhite && precheck && !authStateService.isOwner(userId)) {
      const blacklisted = await handleBlacklist(groupId, userId, messageId);
      if (blacklisted) return;
    }

    const handled = await handleCommand(event, ctx);
    if (handled) return;

    if (!isWhite && !precheck && !authStateService.isOwner(userId)) {
      const blacklisted = await handleBlacklist(groupId, userId, messageId);
      if (blacklisted) return;
    }

    if (!isWhite) {
      const filtered = await handleFilterKeywords(groupId, userId, messageId, raw, ctx);
      if (filtered) return;
    }

    if (!isWhite) {
      const typeFiltered = await handleMsgTypeFilter(groupId, userId, messageId, raw, messageSegments, ctx);
      if (typeFiltered) return;
    }

    if (!isWhite) {
      const spammed = await handleSpamDetect(groupId, userId, raw);
      if (spammed) return;
    }

    if (!isWhite) {
      const recalled = await handleAutoRecall(groupId, userId, messageId);
      if (recalled) return;
    }

    const qaHandled = await runWithForcedResponseScene('qa_reply', () => handleQA(groupId, userId, raw));
    if (qaHandled) {
      await recordActivity(groupId, userId);
      cacheMessage(messageId, userId, groupId, raw, messageSegments);
      return;
    }

    if (isQueryOnlyBotRole() || isQaOnlyBotRole()) {
      return;
    }

    await recordActivity(groupId, userId);
    cacheMessage(messageId, userId, groupId, raw, messageSegments);
    await handleEmojiReact(groupId, userId, messageId, selfId);

    if (settings.enableVerify) {
      await handleVerifyAnswer(groupId, userId, raw, messageId);
    }

    await handleCardLockCheck(groupId, userId);
    const senderCard = String((event as any)?.sender?.card || '');
    await handleCardLockOnMessage(groupId, userId, senderCard);
  }
}
