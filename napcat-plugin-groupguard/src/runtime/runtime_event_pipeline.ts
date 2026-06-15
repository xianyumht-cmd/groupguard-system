import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { authManager } from '../auth';
import { authStateService } from '../core/state-services/auth_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { identityStateService } from '../core/state-services/identity_state_service';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { sessionStateService } from '../core/state-services/session_state_service';
import { storageAdapter } from '../storage_adapter';
import { createVerifySession } from '../verify';
import { createRiskSignal } from '../risk/signals';
import { processRiskSignal } from '../risk/policy_engine';
import { flushInviteService, recordInviteRelation } from '../services/invite_service';
import { GroupJoinVerifier } from '../join_verifier';
import { handleAntiRecall, handleCardLockCheck, saveConfig, sendWelcomeMessage } from '../commands';

export async function handlePluginEvent(ctx: NapCatPluginContext, event: unknown): Promise<void> {
  const e = event as {
    post_type?: string; request_type?: string; notice_type?: string; sub_type?: string;
    group_id?: number | string; user_id?: number | string; operator_id?: number | string;
    message_id?: number | string; card_new?: string; flag?: string; comment?: string;
  };

  const groupId = String(e.group_id);
  const license = authManager.getGroupLicense(groupId);
  if (!license && groupId !== 'undefined') return;

  if (e.post_type === 'request' && e.request_type === 'group' && e.sub_type === 'add') {
    const handled = await GroupJoinVerifier.handleJoinRequest(ctx, {
      group_id: groupId,
      user_id: String(e.user_id),
      comment: e.comment,
      flag: e.flag || '',
      sub_type: e.sub_type
    });

    if (handled) return;
    return;
  }

  if (e.post_type === 'notice' && e.notice_type === 'group_increase') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    const operatorId = String(e.operator_id || '');
    const settings = configStateService.resolveGroupSettings(groupId);

    if (operatorId && operatorId !== userId && operatorId !== identityStateService.getBotId()) {
      if (!settings.disableInvite) {
        const relation = await recordInviteRelation({ groupId, inviterQQ: operatorId, invitedQQ: userId, joinTime: Date.now() });
        let firstInvite = false;
        storageAdapter.runInTransaction(() => {
          const inviteeRecord = storageAdapter.getInvite(groupId, userId) || { inviteCount: 0, inviterId: '', invitedUsers: [] };
          if (relation.created && !inviteeRecord.inviterId) {
            firstInvite = true;
            inviteeRecord.inviterId = operatorId;
            storageAdapter.setInvite(groupId, userId, inviteeRecord);
            let inviterRecord = storageAdapter.getInvite(groupId, operatorId) || { inviteCount: 0, inviterId: '', invitedUsers: [] };
            inviterRecord.inviteCount = Number(inviterRecord.inviteCount || 0) + 1;
            inviterRecord.invitedUsers = Array.from(new Set([...(inviterRecord.invitedUsers || []), userId]));
            storageAdapter.setInvite(groupId, operatorId, inviterRecord);
            if (settings.invitePoints && settings.invitePoints > 0) {
              let inviterSignin = storageAdapter.getSignin(groupId, operatorId) || { lastSignin: 0, days: 0, points: 0 };
              inviterSignin.points = Number(inviterSignin.points || 0) + settings.invitePoints;
              storageAdapter.setSignin(groupId, operatorId, inviterSignin);
            }
          }
        });
        if (firstInvite && settings.invitePoints && settings.invitePoints > 0) {
          loggingStateService.info(`邀请奖励: 用户 ${operatorId} 邀请 ${userId} 进群，获得 ${settings.invitePoints} 积分`);
        }
      }
    }

    if (userId === identityStateService.getBotId()) {
      loggingStateService.info(`机器人自身加入群 ${groupId}，跳过验证`);
      return;
    }

    const isAdmin = await authStateService.isBotAdmin(groupId);
    if (!isAdmin) {
      loggingStateService.debug(`机器人在群 ${groupId} 不是管理员，跳过验证`);
      return;
    }

    const blacklisted = authStateService.isBlacklisted(userId) || (settings.groupBlacklist || []).includes(userId);
    if (blacklisted) {
      await processRiskSignal(createRiskSignal({
        kind: 'blacklist_join',
        groupId,
        userId,
        reason: 'blacklist_join',
        severity: 'critical',
        evidence: {
          global: authStateService.isBlacklisted(userId),
          group: (settings.groupBlacklist || []).includes(userId)
        }
      }));
      loggingStateService.info(`入群黑名单拦截: 用户 ${userId} 加入群 ${groupId} 后触发踢出`);
      return;
    }

    if (!settings.enableVerify) {
      if (!settings.disableWelcome) {
        await sendWelcomeMessage(groupId, userId);
      }
      return;
    }

    const commentKey = `${groupId}:${userId}`;
    const comment = sessionStateService.getPendingComment(commentKey);
    sessionStateService.deletePendingComment(commentKey);
    const tpl = !settings.disableWelcome && settings.welcomeMessage !== undefined && settings.welcomeMessage !== ''
      ? settings.welcomeMessage
      : (!settings.disableWelcome ? (configStateService.getConfig().welcomeMessage || '') : '');
    const welcomeText = tpl ? tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId) : '';
    loggingStateService.info(`新成员进群: 用户 ${userId} 加入群 ${groupId}，发起验证`);
    createVerifySession(groupId, userId, comment, welcomeText);
    return;
  }

  if (e.post_type === 'notice' && e.notice_type === 'group_recall') {
    const groupId = String(e.group_id);
    const messageId = String(e.message_id);
    const userId = String(e.user_id);
    await handleAntiRecall(groupId, messageId, userId);
    return;
  }

  if (e.post_type === 'notice' && e.notice_type === 'group_card') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    await handleCardLockCheck(groupId, userId);
    return;
  }

  if (e.post_type === 'notice' && e.notice_type === 'group_decrease' && e.sub_type === 'leave') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    const settings = configStateService.resolveGroupSettings(groupId);
    const config = configStateService.getConfig();
    const globalLeave = config.leaveBlacklist;
    const groupLeave = settings.leaveBlacklist;
    if (!globalLeave && !groupLeave) return;

    if (!config.blacklist) config.blacklist = [];
    if (!config.blacklist.includes(userId)) {
      config.blacklist.push(userId);
      loggingStateService.info(`退群拉黑: 用户 ${userId} 退出群 ${groupId}，已加入黑名单（${globalLeave ? '全局' : '群独立'}设置）`);
      saveConfig(ctx);
    }
    return;
  }
}
