import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { loggingStateService } from '../core/state-services/logging_state_service';
import { checkFeatureGate } from '../core/feature_gate';
import { shouldBlockByBotRole } from '../core/bot_role';
import { initializeDynamicCommands, loadDynamicCommands, reloadDynamicCommandsIfChanged } from '../dynamic-commands/command_loader';
import { assertCommandPluginRegistryReady, getCommandPluginRecord, refreshCommandPluginRegistry } from '../dynamic-commands/command_plugin_registry';
import { getDynamicCommandRegistrySnapshotVersion, refreshDynamicCommandRegistry, resolveDynamicCommandCandidates } from '../dynamic-commands/command_registry';
import { executeDynamicCommand, getDynamicCommandMetric, initializeDynamicCommandMetrics } from '../dynamic-commands/command_engine';
import { runWithDispatcherExecutionScope } from '../dynamic-commands/execution_guard';
import { runBeforeMatchHooks } from '../dynamic-commands/command_plugin_interface';
import { communicationStateService } from '../core/state-services/communication_state_service';
import { checkAndConsumeQueryRate } from '../services/query_rate_limit_service';
import type { DynamicCommandMatchResult } from '../dynamic-commands/types';

// All command resolution must happen in dispatcher only. No exceptions.

const DYNAMIC_COMMAND_DEBUG = process.env.DYNAMIC_COMMAND_DEBUG === '1';
const userCommandFrequency = new Map<string, Map<string, number>>();
const MAX_USERS_TRACKED = 1000;
const MAX_COMMANDS_PER_USER = 50;

export interface CommandContext {
  rawText: string;
  cleanedText: string;
  source: 'dynamic';
  commandId: string;
  matchedAt: string;
}

interface CommandMatchResult {
  matchedAt: string;
  matchType: 'exact' | 'prefix';
  specificity: number;
  strength: number;
}

interface CommandCandidate {
  source: CommandContext['source'];
  commandId: string;
  pluginSource: 'json' | 'plugin';
  priority: number;
  match: DynamicCommandMatchResult;
  matchResult: CommandMatchResult;
  execute: (event: OB11Message, ctx: NapCatPluginContext, commandContext: CommandContext) => Promise<boolean>;
}

function preprocessMessage(event: OB11Message): { rawText: string; cleanedText: string; } {
  const rawText = event.raw_message || '';
  const cleanedText = rawText.replace(/\[CQ:[^\]]+\]/g, '').trim();
  return { rawText, cleanedText };
}

let lastReloadCheckAt = 0;
const RELOAD_CHECK_INTERVAL_MS = 5000;

async function syncDynamicCommands(): Promise<void> {
  await initializeDynamicCommands();
  refreshCommandPluginRegistry();
  assertCommandPluginRegistryReady();
  refreshDynamicCommandRegistry();
  await initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));
  const now = Date.now();
  if (now - lastReloadCheckAt < RELOAD_CHECK_INTERVAL_MS) return;
  lastReloadCheckAt = now;
  await reloadDynamicCommandsIfChanged();
  refreshCommandPluginRegistry();
  assertCommandPluginRegistryReady();
  refreshDynamicCommandRegistry();
  await initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));
}

function buildDynamicCandidate(match: DynamicCommandMatchResult): CommandCandidate {
  const configuredPriority = match.priority;
  return {
    source: 'dynamic',
    commandId: match.command.id,
    pluginSource: getCommandPluginRecord(match.command.id)?.plugin.source || 'json',
    priority: configuredPriority,
    match,
    matchResult: {
      matchedAt: match.matchedTrigger,
      matchType: match.command.trigger.type,
      specificity: match.matchedTrigger.length,
      strength: match.command.trigger.type === 'exact' ? 2 : 1
    },
    execute: (event, ctx, commandContext) => executeDynamicCommand(match, event, ctx, commandContext)
  };
}

function collectCandidates(cleanedText: string): CommandCandidate[] {
  const candidates: CommandCandidate[] = [];
  const dynamicMatches = resolveDynamicCommandCandidates(cleanedText);
  for (const dynamicMatch of dynamicMatches) {
    candidates.push(buildDynamicCandidate(dynamicMatch));
  }
  return candidates;
}

async function isCandidateAllowed(candidate: CommandCandidate, event: OB11Message, cleanedText: string): Promise<{ allowed: boolean; roleBlocked: boolean; }> {
  const command = candidate.match.command;
  const record = getCommandPluginRecord(command.id);
  if (record && !record.enabled) {
    loggingStateService.debug(`[CommandDispatcher] filtered=${candidate.commandId} reason=plugin_runtime_disabled`);
    return { allowed: false, roleBlocked: false };
  }
  const roleBlock = shouldBlockByBotRole({
    source: candidate.commandId.startsWith('legacy.') ? 'legacy' : 'dynamic_command',
    rawMessage: cleanedText,
    featureType: command.featureType || 'dynamic',
    featureKey: command.featureKey || `dynamic.${command.id}`,
    commandId: candidate.commandId,
    legacyDomain: candidate.commandId.startsWith('legacy.') ? candidate.commandId.split('.')[1] : undefined
  });
  if (roleBlock.blocked) {
    loggingStateService.info(roleBlock.logLine || `[CommandDispatcher] filtered=${candidate.commandId} reason=${roleBlock.reason}`);
    return { allowed: false, roleBlocked: true };
  }
  const groupId = event.group_id ? String(event.group_id) : undefined;
  const userId = String(event.user_id || '');
  const gate = await checkFeatureGate({
    featureType: command.featureType || 'dynamic',
    featureKey: command.featureKey || `dynamic.${command.id}`,
    groupId,
    userId,
    messageType: event.message_type === 'private' ? 'private' : 'group',
    source: candidate.pluginSource,
    scope: command.scope || 'group',
    allowedGroups: command.allowedGroups || [],
    blockedGroups: command.blockedGroups || [],
    requiresLicense: command.requiresLicense !== false,
    permission: command.permission || 'all',
    passiveReply: false,
    botSend: true,
    ownerBypass: command.featureType === 'system' || candidate.pluginSource === 'plugin'
  });
  if (!gate.allowed) {
    loggingStateService.debug(`[CommandDispatcher] filtered=${candidate.commandId} reason=${gate.reason}`);
  }
  return { allowed: gate.allowed, roleBlocked: false };
}

function compareCandidates(left: CommandCandidate, right: CommandCandidate): number {
  const priorityDiff = right.priority - left.priority;
  if (priorityDiff !== 0) return priorityDiff;
  const strengthDiff = right.matchResult.strength - left.matchResult.strength;
  if (strengthDiff !== 0) return strengthDiff;
  const specificityDiff = right.matchResult.specificity - left.matchResult.specificity;
  if (specificityDiff !== 0) return specificityDiff;
  return left.commandId.localeCompare(right.commandId);
}

function getUserCommandFrequencyScore(userId: string, commandId: string): number {
  const commandMap = userCommandFrequency.get(userId);
  if (!commandMap) return 0;
  return Math.min(commandMap.get(commandId) || 0, 3);
}

function recordUserCommandFrequency(userId: string, commandId: string): void {
  if (!userCommandFrequency.has(userId)) {
    userCommandFrequency.set(userId, new Map<string, number>());
  }
  const commandMap = userCommandFrequency.get(userId)!;
  commandMap.set(commandId, (commandMap.get(commandId) || 0) + 1);
  if (commandMap.size > MAX_COMMANDS_PER_USER) {
    const keys = Array.from(commandMap.keys());
    for (let i = 0; i < keys.length - MAX_COMMANDS_PER_USER; i += 1) {
      commandMap.delete(keys[i]);
    }
  }
  if (userCommandFrequency.size > MAX_USERS_TRACKED) {
    const keys = Array.from(userCommandFrequency.keys());
    for (let i = 0; i < keys.length - MAX_USERS_TRACKED; i += 1) {
      userCommandFrequency.delete(keys[i]);
    }
  }
}

function getCandidateContextScore(candidate: CommandCandidate, event: OB11Message): number {
  let score = 0;
  const userId = String(event.user_id || '');
  score += getUserCommandFrequencyScore(userId, candidate.commandId);

  const metric = getDynamicCommandMetric(candidate.commandId);
  if (!metric) return score;

  const currentMessageType = event.message_type === 'private' ? 'private' : 'group';
  const alternateMessageType = currentMessageType === 'private' ? 'group' : 'private';
  if (metric.messageTypeStats[currentMessageType] > metric.messageTypeStats[alternateMessageType]) {
    score += 1;
  }
  if (metric.averageLatencyMs >= 3000) score -= 2;
  else if (metric.averageLatencyMs >= 1500) score -= 1;

  return score;
}

function shouldApplyQueryRateLimit(candidate: CommandCandidate): boolean {
  const command = candidate.match.command;
  const featureType = String(command.featureType || '');
  const featureKey = String(command.featureKey || '');
  const providerType = String((command.provider as any)?.type || '');
  return featureType === 'query' || featureKey.startsWith('query.') || providerType === 'http';
}

async function notifyRateLimited(event: OB11Message, reason: string): Promise<void> {
  if (event.message_type === 'private') {
    await communicationStateService.sendPrivateMsg(String(event.user_id || ''), reason, {
      scene: 'external_query',
      force: true,
      applyTemplate: true
    });
    return;
  }
  await communicationStateService.sendGroupText(String(event.group_id || ''), reason, {
    scene: 'external_query',
    force: true,
    applyTemplate: true
  });
}

export class CommandDispatcher {
  async handle(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
    await syncDynamicCommands();
    const preprocessed = preprocessMessage(event);
    if (!preprocessed.cleanedText) return false;
    await runBeforeMatchHooks(preprocessed.cleanedText);

    const rawRoleBlock = shouldBlockByBotRole({
      source: 'dynamic_command',
      rawMessage: preprocessed.cleanedText,
      featureType: 'dynamic'
    });
    if (rawRoleBlock.blocked) {
      loggingStateService.info(rawRoleBlock.logLine || `[CommandDispatcher] role_blocked raw=${preprocessed.cleanedText}`);
      return true;
    }

    const collectedCandidates = collectCandidates(preprocessed.cleanedText);
    const candidates: CommandCandidate[] = [];
    let blockedByRole = false;
    for (const candidate of collectedCandidates) {
      const allowed = await isCandidateAllowed(candidate, event, preprocessed.cleanedText);
      if (allowed.allowed) candidates.push(candidate);
      if (allowed.roleBlocked) blockedByRole = true;
    }
    if (!candidates.length) return blockedByRole;

    const rankedCandidates = [...candidates]
      .map((candidate) => ({
        candidate,
        effectivePriority: candidate.priority + getCandidateContextScore(candidate, event)
      }))
      .sort((left, right) => {
        const effectivePriorityDiff = right.effectivePriority - left.effectivePriority;
        if (effectivePriorityDiff !== 0) return effectivePriorityDiff;
        return compareCandidates(left.candidate, right.candidate);
      });
    const selectedCandidate = rankedCandidates[0].candidate;
    if (DYNAMIC_COMMAND_DEBUG) {
      loggingStateService.debug(JSON.stringify({
        stage: 'dispatcher_ranking',
        cleanedText: preprocessed.cleanedText,
        registrySnapshotVersion: getDynamicCommandRegistrySnapshotVersion(),
        candidates: rankedCandidates.map(({ candidate, effectivePriority }) => ({
          commandId: candidate.commandId,
          source: candidate.source,
          priority: candidate.priority,
          effectivePriority,
          matchType: candidate.matchResult.matchType,
          specificity: candidate.matchResult.specificity,
          strength: candidate.matchResult.strength,
          matchedAt: candidate.matchResult.matchedAt
        }))
      }));
    }
    loggingStateService.debug(`[CommandDispatcher] selected=${selectedCandidate.commandId} source=${selectedCandidate.source} priority=${selectedCandidate.priority}`);
    const commandContext: CommandContext = {
      rawText: preprocessed.rawText,
      cleanedText: preprocessed.cleanedText,
      source: selectedCandidate.source,
      commandId: selectedCandidate.commandId,
      matchedAt: selectedCandidate.matchResult.matchedAt
    };

    try {
      if (shouldApplyQueryRateLimit(selectedCandidate)) {
        const groupId = event.message_type === 'private' ? '' : String(event.group_id || '');
        const label = selectedCandidate.match.command.trigger.value || '查询';
        const rateCheck = checkAndConsumeQueryRate(groupId, label);
        if (!rateCheck.ok) {
          await notifyRateLimited(event, rateCheck.reason);
          return true;
        }
      }
      const handled = await runWithDispatcherExecutionScope({
        commandId: selectedCandidate.commandId,
        rawText: preprocessed.rawText
      }, async () => selectedCandidate.execute(event, ctx, commandContext));
      if (handled) {
        recordUserCommandFrequency(String(event.user_id || ''), selectedCandidate.commandId);
        loggingStateService.debug(`统一调度命中: ${commandContext.commandId} (${commandContext.source}) -> ${commandContext.cleanedText}`);
      }
      return handled;
    } catch (error) {
      loggingStateService.error(`统一调度执行失败: ${selectedCandidate.commandId} ${error}`);
      return false;
    }
  }
}

export const commandDispatcher = new CommandDispatcher();
