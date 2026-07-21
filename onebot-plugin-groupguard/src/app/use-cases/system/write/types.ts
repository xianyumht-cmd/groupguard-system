import type { DomainResponseNotice } from '../../../../domain/shared/response_notice';

export type SystemWriteScene = 'raw_text' | 'action_success' | 'permission_denied' | 'command_format_error' | 'list_empty' | 'not_found';

export type SystemWriteCommand =
  | {
      channel: 'private';
      action: 'reset_queue';
      actorUserId: string;
      originalText: string;
    }
  | {
      channel: 'private';
      action: 'broadcast_licensed_groups';
      actorUserId: string;
      originalText: string;
      content: string;
    }
  | {
      channel: 'group';
      action: 'create_scheduled_task';
      actorUserId: string;
      originalText: string;
      groupId: string;
      time: string;
      content: string;
    }
  | {
      channel: 'group';
      action: 'update_welcome_message';
      actorUserId: string;
      originalText: string;
      groupId: string;
      message: string;
    }
  | {
      channel: 'group';
      action: 'set_join_private_enabled';
      actorUserId: string;
      originalText: string;
      groupId: string;
      enabled: boolean;
    }
  | {
      channel: 'group';
      action: 'update_join_private_message';
      actorUserId: string;
      originalText: string;
      groupId: string;
      message: string;
    }
  | {
      channel: 'group';
      action: 'delete_scheduled_task';
      actorUserId: string;
      originalText: string;
      groupId: string;
      taskId: string;
    }
  | {
      channel: 'group';
      action: 'build_group_config_cleanup_warning';
      actorUserId: string;
      originalText: string;
      groupId: string;
    }
  | {
      channel: 'group';
      action: 'clear_group_config';
      actorUserId: string;
      originalText: string;
      groupId: string;
    };

export interface SystemWriteExecutionData {
  before?: DomainResponseNotice[];
  scene?: SystemWriteScene;
  message: string;
  vars?: Record<string, string | number | boolean>;
}

export interface SystemWriteUseCaseResult {
  success: boolean;
  data?: SystemWriteExecutionData;
  error?: string;
}
