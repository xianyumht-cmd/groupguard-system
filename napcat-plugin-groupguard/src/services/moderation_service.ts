import { authManager } from '../auth';
import { authStateService } from '../core/state-services/auth_state_service';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { configStateService } from '../core/state-services/config_state_service';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { getTarget, isAdminOrOwner, saveConfig, sendGroupScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';
import { executeManualPolicyAction } from '../risk/policy_engine';
import { enqueueMiscAction } from './action_queue_service';

export async function executeModerationCommand(input: CommandExecutionContext): Promise<boolean> {
  const { raw, text, userId, groupId, ctx, event } = input;
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;

  if (text.startsWith('警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(3).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：警告@某人', { example: '警告@某人' }); return true; }
    const count = ((await groupguardRepository.getWarning(groupId, target)) || 0) + 1;
    await groupguardRepository.setWarning(groupId, target, count);
    const settings = configStateService.resolveGroupSettings(groupId);
    const limit = settings.warningLimit || 3;
    if (count >= limit) {
      await groupguardRepository.setWarning(groupId, target, 0);
      if (settings.warningAction === 'kick') {
        const result = await executeManualPolicyAction({ type: 'kick', groupId, userId: target, reason: 'warning_limit', rejectAddRequest: false, maxRetries: 1 });
        if (result.ok) await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，已被踢出。`, { target, count, limit });
        else await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，但执行踢出失败：${result.code}`, { target, count, limit });
      } else {
        const banTime = (settings.filterBanMinutes || 10) * 60;
        const result = await executeManualPolicyAction({ type: 'ban', groupId, userId: target, durationSeconds: banTime, reason: 'warning_limit', maxRetries: 1 });
        if (result.ok) await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，禁言 ${settings.filterBanMinutes} 分钟。`, { target, count, limit });
        else await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，但执行禁言失败：${result.code}`, { target, count, limit });
      }
    } else {
      await sendGroupScene(groupId, 'raw_text', `用户 ${target} 已被警告，当前次数：${count}/${limit}`, { target, count, limit });
    }
    return true;
  }
  if (text.startsWith('清除警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '清除警告@某人' }); return true; }
    const count = await groupguardRepository.getWarning(groupId, target);
    if (count > 0) { await groupguardRepository.setWarning(groupId, target, 0); await sendGroupScene(groupId, 'action_success', `已清除用户 ${target} 的警告记录`, { target }); }
    else await sendGroupScene(groupId, 'not_found', '该用户无警告记录');
    return true;
  }
  if (text.startsWith('查看警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '查看警告@某人' }); return true; }
    await sendGroupScene(groupId, 'raw_text', `用户 ${target} 当前警告次数：${await groupguardRepository.getWarning(groupId, target)}/${configStateService.resolveGroupSettings(groupId).warningLimit || 3}`, { target });
    return true;
  }
  if (text.startsWith('踢出')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(2).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：踢出@某人 或 踢出QQ号', { example: '踢出@某人' }); return true; }
    const result = await executeManualPolicyAction({ type: 'kick', groupId, userId: target, reason: 'manual_kick', rejectAddRequest: false, maxRetries: 1 });
    if (result.ok) await sendGroupScene(groupId, 'action_success', `已踢出 ${target}`, { target });
    else await sendGroupScene(groupId, 'raw_text', `踢出失败：${result.code}`, { target });
    return true;
  }
  if (text.startsWith('禁言') && !text.startsWith('禁言列表')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：禁言@某人 分钟 或 禁言QQ号 分钟', { example: '禁言@某人 10' }); return true; }
    const durationMatch = rest.replace(/\d{5,}/, '').match(/(\d+)/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 10;
    const result = await executeManualPolicyAction({ type: 'ban', groupId, userId: target, durationSeconds: duration * 60, reason: 'manual_ban', maxRetries: 1 });
    if (result.ok) await sendGroupScene(groupId, 'action_success', `已禁言 ${target}，时长 ${duration} 分钟`, { target, duration });
    else await sendGroupScene(groupId, 'raw_text', `禁言失败：${result.code}`, { target, duration });
    return true;
  }
  if (text.startsWith('解禁')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(2).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：解禁@某人 或 解禁QQ号', { example: '解禁@某人' }); return true; }
    const result = await executeManualPolicyAction({ type: 'ban', groupId, userId: target, durationSeconds: 0, reason: 'manual_unban', ignoreTargetProtection: true, maxRetries: 1 });
    if (result.ok) await sendGroupScene(groupId, 'action_success', `已解禁 ${target}`, { target });
    else await sendGroupScene(groupId, 'raw_text', `解禁失败：${result.code}`, { target });
    return true;
  }
  if (text === '全体禁言' || text === '全体解禁') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    await enqueueMiscAction({
      groupId,
      action: 'set_group_whole_ban',
      params: { group_id: groupId, enable: text === '全体禁言' },
      reason: 'whole_ban_toggle',
      dedupKey: `${groupId}:whole_ban:${text}`,
      maxRetries: 1
    });
    await sendGroupScene(groupId, 'action_success', text === '全体禁言' ? '已开启全体禁言' : '已关闭全体禁言');
    return true;
  }
  if (text.startsWith('授予头衔') || text.startsWith('清除头衔')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要群主权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '授予头衔@某人 高管' }); return true; }
    const title = text.startsWith('清除头衔') ? '' : rest.replace(/\[CQ:[^\]]+\]/g, '').replace(/\d{5,12}/, '').trim();
    await enqueueMiscAction({
      groupId,
      action: 'set_group_special_title',
      params: { group_id: groupId, user_id: target, special_title: title },
      reason: 'special_title',
      dedupKey: `${groupId}:title:${target}`,
      maxRetries: 1
    });
    await sendGroupScene(groupId, 'action_success', text.startsWith('清除头衔') ? `已清除 ${target} 的头衔` : `已为 ${target} 设置头衔：${title || '(空)'}`, { target });
    return true;
  }
  if (text.startsWith('锁定名片') || text.startsWith('解锁名片')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(4).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '锁定名片@某人' }); return true; }
    if (text.startsWith('锁定名片')) {
      const info = await communicationStateService.callApi('get_group_member_info', { group_id: groupId, user_id: target }) as any;
      const card = info?.card || info?.nickname || '';
      configStateService.getConfig().cardLocks[`${groupId}:${target}`] = card;
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已锁定 ${target} 的名片为：${card || '(空)'}`, { target });
    } else {
      delete configStateService.getConfig().cardLocks[`${groupId}:${target}`];
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已解锁 ${target} 的名片`, { target });
    }
    return true;
  }
  if (text === '名片锁定列表') {
    const entries = Object.entries(configStateService.getConfig().cardLocks).filter(([k]) => k.startsWith(groupId + ':'));
    await sendGroupScene(groupId, entries.length ? 'raw_text' : 'list_empty', entries.length ? `名片锁定列表：\n${entries.map(([k, v]) => `${k.split(':')[1]} → ${v}`).join('\n')}` : '当前群没有锁定的名片');
    return true;
  }
  if (text === '开启防撤回' || text === '关闭防撤回' || text === '防撤回列表') {
    if (text === '防撤回列表') { const list = configStateService.getConfig().antiRecallGroups; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `防撤回已开启的群：\n${list.join('\n')}` : '没有开启防撤回的群'); return true; }
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text === '开启防撤回') {
      if (!configStateService.getConfig().antiRecallGroups.includes(groupId)) configStateService.getConfig().antiRecallGroups.push(groupId);
    } else {
      configStateService.getConfig().antiRecallGroups = configStateService.getConfig().antiRecallGroups.filter(g => g !== groupId);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启防撤回' ? '已开启防撤回' : '已关闭防撤回');
    return true;
  }
  if (text === '开启回应表情' || text === '关闭回应表情') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text === '开启回应表情') configStateService.getConfig().emojiReactGroups[groupId] = configStateService.getConfig().emojiReactGroups[groupId] || [];
    else delete configStateService.getConfig().emojiReactGroups[groupId];
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启回应表情' ? '已开启回应表情' : '已关闭回应表情');
    return true;
  }
  if (text.startsWith('针对') || text.startsWith('取消针对') || text === '针对列表' || text === '清除针对') {
    if (text === '针对列表') {
      const list = configStateService.resolveGroupSettings(groupId).targetUsers || [];
      await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `当前群针对列表：\n${list.join('\n')}` : '当前群没有针对的用户');
      return true;
    }
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const groups = configStateService.getConfig().groups;
    const cfg = groups[groupId] && !groups[groupId].useGlobal ? groups[groupId] : configStateService.getConfig().global;
    if (!cfg.targetUsers) cfg.targetUsers = [];
    if (text === '清除针对') cfg.targetUsers = [];
    else {
      const target = getTarget(raw, text.startsWith('取消针对') ? text.slice(4).trim() : text.slice(2).trim());
      if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '针对@某人' }); return true; }
      if (text.startsWith('取消针对')) cfg.targetUsers = cfg.targetUsers.filter(t => t !== target);
      else if (!cfg.targetUsers.includes(target)) cfg.targetUsers.push(target);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '针对列表已更新');
    return true;
  }
  if (text.startsWith('拉黑') || text.startsWith('取消拉黑') || text === '黑名单列表' || text.startsWith('群拉黑') || text.startsWith('群取消拉黑') || text === '群黑名单列表' || (text.startsWith('白名单') && text !== '白名单列表') || text.startsWith('取消白名单') || text === '白名单列表') {
    if (text === '黑名单列表') { const list = configStateService.getConfig().blacklist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `全局黑名单：\n${list.join('\n')}` : '黑名单为空'); return true; }
    if (text === '群黑名单列表') { const list = configStateService.resolveGroupSettings(groupId).groupBlacklist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `本群黑名单：\n${list.join('\n')}` : '本群黑名单为空'); return true; }
    if (text === '白名单列表') { const list = configStateService.getConfig().whitelist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `全局白名单：\n${list.join('\n')}` : '白名单为空'); return true; }
    const isOwnerCmd = text.startsWith('拉黑') || text.startsWith('取消拉黑') || text.startsWith('白名单') || text.startsWith('取消白名单');
    if (isOwnerCmd && !authStateService.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '需要主人权限'); return true; }
    if (!isOwnerCmd && !await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const source = text.startsWith('取消拉黑') ? text.slice(4).trim() : text.startsWith('拉黑') ? text.slice(2).trim() : text.startsWith('群取消拉黑') ? text.slice(5).trim() : text.startsWith('群拉黑') ? text.slice(3).trim() : text.startsWith('取消白名单') ? text.slice(5).trim() : text.slice(3).trim();
    const target = getTarget(raw, source);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '拉黑@某人' }); return true; }
    const config = configStateService.getConfig();
    if (text.startsWith('拉黑')) { config.blacklist = config.blacklist || []; if (!config.blacklist.includes(target)) config.blacklist.push(target); }
    if (text.startsWith('取消拉黑')) config.blacklist = (config.blacklist || []).filter(q => q !== target);
    if (text.startsWith('群拉黑')) { if (!config.groups[groupId]) config.groups[groupId] = { ...configStateService.resolveGroupSettings(groupId) }; const gs = config.groups[groupId]; gs.groupBlacklist = gs.groupBlacklist || []; if (!gs.groupBlacklist.includes(target)) gs.groupBlacklist.push(target); }
    if (text.startsWith('群取消拉黑')) { if (!config.groups[groupId]) config.groups[groupId] = { ...configStateService.resolveGroupSettings(groupId) }; const gs = config.groups[groupId]; gs.groupBlacklist = (gs.groupBlacklist || []).filter(q => q !== target); }
    if (text.startsWith('白名单') && text !== '白名单列表') { config.whitelist = config.whitelist || []; if (!config.whitelist.includes(target)) config.whitelist.push(target); }
    if (text.startsWith('取消白名单')) config.whitelist = (config.whitelist || []).filter(q => q !== target);
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '名单已更新');
    return true;
  }
  if (text.startsWith('开启自身撤回') || text === '关闭自身撤回') {
    if (!authStateService.isOwner(userId)) return true;
    if (text === '关闭自身撤回') {
      configStateService.getConfig().global.autoRecallSelf = false;
      configStateService.getConfig().global.selfRecall = {
        enabled: false,
        mode: 'fixed',
        fixedDelay: 60,
        minDelay: 45,
        maxDelay: 90,
        jitter: 0
      };
    }
    else {
      const duration = parseInt(text.slice(6).trim());
      const seconds = isNaN(duration) ? 60 : Math.min(300, Math.max(0, duration));
      configStateService.getConfig().global.autoRecallSelf = true;
      configStateService.getConfig().global.autoRecallSelfDelay = seconds;
      configStateService.getConfig().global.selfRecall = {
        enabled: true,
        mode: 'fixed',
        fixedDelay: seconds,
        minDelay: Math.max(0, seconds - 15),
        maxDelay: Math.max(seconds, seconds + 30),
        jitter: 0
      };
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '关闭自身撤回' ? '已关闭全局自身消息撤回' : `已开启全局自身消息撤回，延迟 ${configStateService.getConfig().global.autoRecallSelfDelay || 60} 秒`);
    return true;
  }

  return false;
}
