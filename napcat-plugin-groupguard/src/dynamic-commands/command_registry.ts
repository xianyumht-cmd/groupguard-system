import { loggingStateService } from '../core/state-services/logging_state_service';
import { listCommandPluginDefinitions } from './command_plugin_registry';
import type { DynamicCommandDefinition, DynamicCommandMatchResult } from './types';
import { buildDynamicCommandParameters } from './command_runtime';

const DYNAMIC_COMMAND_DEBUG = process.env.DYNAMIC_COMMAND_DEBUG === '1';

interface DynamicCommandRegistrySnapshot {
  commandsRef: DynamicCommandDefinition[];
  exactMatchMap: Map<string, DynamicCommandDefinition[]>;
  prefixMatchMap: Map<string, DynamicCommandDefinition[]>;
  version: number;
}

let registryRefreshVersion = 0;

let registrySnapshot: DynamicCommandRegistrySnapshot = {
  commandsRef: [],
  exactMatchMap: new Map<string, DynamicCommandDefinition[]>(),
  prefixMatchMap: new Map<string, DynamicCommandDefinition[]>(),
  version: 0
};

function buildSnapshot(commands: DynamicCommandDefinition[], previousVersion: number): DynamicCommandRegistrySnapshot {
  const nextExactMatchMap = new Map<string, DynamicCommandDefinition[]>();
  const nextPrefixMatchMap = new Map<string, DynamicCommandDefinition[]>();
  for (const command of commands) {
    if (command.trigger.type === 'exact') {
      const list = nextExactMatchMap.get(command.trigger.value) || [];
      list.push(command);
      nextExactMatchMap.set(command.trigger.value, list);
      continue;
    }
    const bucketKey = command.trigger.value.charAt(0);
    if (!nextPrefixMatchMap.has(bucketKey)) {
      nextPrefixMatchMap.set(bucketKey, []);
    }
    nextPrefixMatchMap.get(bucketKey)!.push(command);
  }
  return {
    commandsRef: commands,
    exactMatchMap: nextExactMatchMap,
    prefixMatchMap: nextPrefixMatchMap,
    version: previousVersion + 1
  };
}

export function refreshDynamicCommandRegistry(): void {
  const commands = listCommandPluginDefinitions();
  if (registrySnapshot.commandsRef === commands) return;
  registryRefreshVersion++;
  registrySnapshot = buildSnapshot(commands, registrySnapshot.version);
  if (DYNAMIC_COMMAND_DEBUG) {
    loggingStateService.debug(`[DynamicCommandRegistry] snapshot_version=${registrySnapshot.version} refresh_version=${registryRefreshVersion} command_count=${commands.length}`);
  }
}

export function getDynamicCommandRegistrySnapshotVersion(): number {
  return registrySnapshot.version;
}

export function isDynamicCommandSnapshotCurrent(version: number): boolean {
  return registrySnapshot.version === version;
}

function matchCommand(command: DynamicCommandDefinition, text: string): DynamicCommandMatchResult | null {
  if (command.trigger.type === 'exact') {
    if (text !== command.trigger.value) return null;
    return {
      command,
      registryVersion: registrySnapshot.version,
      priority: command.priority || 0,
      matchedTrigger: command.trigger.value,
      rawArgument: '',
      mappedParameters: buildDynamicCommandParameters(command, '')
    };
  }

  if (!text.startsWith(command.trigger.value)) return null;
  const rawArgument = text.slice(command.trigger.value.length).trim();
  return {
    command,
    registryVersion: registrySnapshot.version,
    priority: command.priority || 0,
    matchedTrigger: command.trigger.value,
    rawArgument,
    mappedParameters: buildDynamicCommandParameters(command, rawArgument)
  };
}

export function resolveDynamicCommand(text: string): DynamicCommandMatchResult | null {
  return resolveDynamicCommandCandidates(text)[0] || null;
}

export function resolveDynamicCommandCandidates(text: string): DynamicCommandMatchResult[] {
  const commands = listCommandPluginDefinitions();
  if (registrySnapshot.commandsRef !== commands) {
    registrySnapshot = buildSnapshot(commands, registrySnapshot.version);
  }
  const snapshot = registrySnapshot;
  const matches: DynamicCommandMatchResult[] = [];

  const exactCommands = snapshot.exactMatchMap.get(text) || [];
  for (const exactCommand of exactCommands) {
    const matched = matchCommand(exactCommand, text);
    if (matched) {
      if (DYNAMIC_COMMAND_DEBUG) {
        loggingStateService.debug(`[DynamicCommandRegistry] exact match found: ${matched.command.id} snapshot=${snapshot.version}`);
      }
      matches.push(matched);
    }
  }

  const candidates = snapshot.prefixMatchMap.get(text.charAt(0)) || [];
  for (const command of candidates) {
    const matched = matchCommand(command, text);
    if (matched) {
      if (DYNAMIC_COMMAND_DEBUG) {
        loggingStateService.debug(`[DynamicCommandRegistry] prefix match found: ${matched.command.id} snapshot=${snapshot.version}`);
      }
      matches.push(matched);
    }
  }
  return matches;
}
