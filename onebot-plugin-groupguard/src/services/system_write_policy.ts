import type { SystemWriteCommand, SystemWriteScene } from '../app/use-cases/system/write/types';

export type SystemWritePermission = 'admin' | 'owner' | null;

export interface SystemWritePolicyContext {
  isOwner: boolean;
  isAdminOrOwner: boolean;
}

export interface SystemWritePolicyDecision {
  allowed: boolean;
  response?: {
    scene: SystemWriteScene;
    message: string;
  };
}

const ACTION_PERMISSIONS: Record<SystemWriteCommand['action'], SystemWritePermission> = {
  reset_queue: 'owner',
  broadcast_licensed_groups: 'owner',
  create_scheduled_task: 'admin',
  update_welcome_message: 'admin',
  set_join_private_enabled: 'admin',
  update_join_private_message: 'admin',
  delete_scheduled_task: 'admin',
  build_group_config_cleanup_warning: 'owner',
  clear_group_config: 'owner'
};

export function evaluateSystemWritePolicy(command: SystemWriteCommand, context: SystemWritePolicyContext): SystemWritePolicyDecision {
  const permission = ACTION_PERMISSIONS[command.action];
  if (permission === 'owner' && !context.isOwner) {
    return {
      allowed: false,
      response: {
        scene: 'permission_denied',
        message: command.channel === 'group' ? '此操作仅限机器人主人执行' : '权限不足：该指令仅限机器人主人使用。'
      }
    };
  }
  if (permission === 'admin' && !context.isAdminOrOwner) {
    return {
      allowed: false,
      response: {
        scene: 'permission_denied',
        message: '需要管理员权限'
      }
    };
  }
  return { allowed: true };
}
