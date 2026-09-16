import { saveConfig } from '../../../commands/common';
import { configStateService } from '../../../core/state-services/config_state_service';
import type { ISystemWriteConfigPort, SystemWriteRuntimeContext } from '../../../app/use-cases/system/write/ports';
import type { ScheduledTask, GroupSettingsOverride } from '../../../types';

function ensureGroupSettings(groupId: string): GroupSettingsOverride {
  const config = configStateService.getConfig();
  if (!config.groups[groupId]) {
    config.groups[groupId] = { useGlobal: false };
  }
  return config.groups[groupId];
}

function isScheduledTask(task: NonNullable<GroupSettingsOverride['scheduledTasks']>[number]): task is ScheduledTask {
  return typeof task?.id === 'string'
    && typeof task.cron === 'string'
    && (task.type === 'text' || task.type === 'image')
    && typeof task.content === 'string'
    && (task.lastRun === undefined || typeof task.lastRun === 'number');
}

export class ConfigAdapter implements ISystemWriteConfigPort {
  constructor(private readonly ctx: SystemWriteRuntimeContext) {}

  getStoredScheduledTasks(groupId: string): ScheduledTask[] | undefined {
    const tasks = configStateService.getGroupSettings(groupId)?.scheduledTasks;
    if (!tasks) return undefined;
    return tasks.every(isScheduledTask) ? tasks : undefined;
  }

  appendScheduledTask(groupId: string, task: ScheduledTask): void {
    const settings = ensureGroupSettings(groupId);
    if (!settings.scheduledTasks) settings.scheduledTasks = [];
    settings.scheduledTasks.push(task);
  }

  replaceScheduledTasks(groupId: string, tasks: ScheduledTask[]): void {
    ensureGroupSettings(groupId).scheduledTasks = tasks;
  }

  setWelcomeMessage(groupId: string, message: string): void {
    ensureGroupSettings(groupId).welcomeMessage = message;
  }

  setJoinPrivateEnabled(groupId: string, enabled: boolean): void {
    ensureGroupSettings(groupId).joinPrivateEnabled = enabled;
  }

  setJoinPrivateMessage(groupId: string, message: string): void {
    ensureGroupSettings(groupId).joinPrivateMessage = message;
  }

  removeGroupConfig(groupId: string): void {
    configStateService.deleteGroupSettings(groupId);
  }

  getGroupSettings(groupId: string): GroupSettingsOverride | undefined {
    return configStateService.getGroupSettings(groupId);
  }

  saveConfig(): void {
    saveConfig(this.ctx);
  }
}
