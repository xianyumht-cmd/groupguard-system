import type { DomainResponseNotice } from '../../../../domain/shared/response_notice';
import type { ScheduledTask, GroupGuardSettings } from '../../../../types';
import type { SystemWriteScene } from './types';

export interface ISystemWriteConfigPort {
  getStoredScheduledTasks(groupId: string): ScheduledTask[] | undefined;
  appendScheduledTask(groupId: string, task: ScheduledTask): void;
  replaceScheduledTasks(groupId: string, tasks: ScheduledTask[]): void;
  setWelcomeMessage(groupId: string, message: string): void;
  setJoinPrivateEnabled(groupId: string, enabled: boolean): void;
  setJoinPrivateMessage(groupId: string, message: string): void;
  removeGroupConfig(groupId: string): void;
  getGroupSettings(groupId: string): GroupGuardSettings | undefined;
  saveConfig(): void | Promise<void>;
}

export interface ISystemWriteQueuePort {
  resetRuntime(): { cleared: number; activeWorkers: number; };
}

export interface ISystemWriteMessagingPort {
  sendGroupScene(groupId: string, scene: SystemWriteScene, message: string, vars?: Record<string, string | number | boolean>): Promise<void>;
  sendPrivateScene(userId: string, scene: SystemWriteScene, message: string, vars?: Record<string, string | number | boolean>): Promise<void>;
  delay(ms: number): Promise<void>;
}

export interface ISystemWriteRuntimePort {
  listGroupIds(): Promise<string[]>;
}

export interface ISystemWriteAuthPort {
  hasGroupLicense(groupId: string): boolean;
  isOwner(userId: string): boolean;
  isAdminOrOwner(groupId: string, userId: string): Promise<boolean>;
}

export interface ISystemWriteMaintenancePort {
  clearGroupData(groupId: string): void;
}

export interface ISystemWriteLoggingPort {
  warn(message: string): void;
}

export interface SystemWriteUseCaseContext {
  configPort: ISystemWriteConfigPort;
  queuePort: ISystemWriteQueuePort;
  messagingPort: ISystemWriteMessagingPort;
  runtimePort: ISystemWriteRuntimePort;
  authPort: ISystemWriteAuthPort;
  maintenancePort: ISystemWriteMaintenancePort;
  loggingPort: ISystemWriteLoggingPort;
}

export interface SystemWriteUseCaseData {
  before?: DomainResponseNotice[];
  scene?: SystemWriteScene;
  message: string;
  vars?: Record<string, string | number | boolean>;
}
