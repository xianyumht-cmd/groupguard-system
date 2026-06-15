import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { authManager } from '../auth';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { runtimeControlService } from '../core/state-services/runtime_control_service';
import {
  handleCommand, handleAntiRecall, cacheMessage, handleEmojiReact,
  handleCardLockCheck, handleCardLockOnMessage, handleAutoRecall,
  handleBlacklist, handleFilterKeywords, handleSpamDetect,
  handleMsgTypeFilter, handleQA, recordActivity
} from '../commands';
import { handleVerifyAnswer } from '../verify';

export async function handlePluginMessage(ctx: NapCatPluginContext, event: OB11Message): Promise<void> {
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

    const qaHandled = await handleQA(groupId, userId, raw);
    if (qaHandled) {
      await recordActivity(groupId, userId);
      cacheMessage(messageId, userId, groupId, raw, messageSegments);
      return;
    }

    if (!isWhite) {
      const recalled = await handleAutoRecall(groupId, userId, messageId);
      if (recalled) return;
    }

    if (!isWhite) {
      const filtered = await handleFilterKeywords(groupId, userId, messageId, raw, ctx);
      if (filtered) return;
    }

    if (!isWhite) {
      const typeFiltered = await handleMsgTypeFilter(groupId, userId, messageId, raw, messageSegments);
      if (typeFiltered) return;
    }

    if (!isWhite) {
      await handleSpamDetect(groupId, userId, raw);
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
