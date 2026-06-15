import type { ScheduledTask } from '../../types';

export type ConfigRuleStatus = 'success' | 'command_format_error' | 'list_empty' | 'not_found';

export type ConfigRuleResult<T> =
  | {
      ok: true;
      status: 'success';
      data: T;
    }
  | {
      ok: false;
      status: Exclude<ConfigRuleStatus, 'success'>;
      message: string;
      vars?: Record<string, string | number | boolean>;
    };

export interface ConfigDomainService {
  planScheduledTaskCreation(input: { time: string; content: string; now: number; }): ConfigRuleResult<{ task: ScheduledTask; successMessage: string; }>;
  planWelcomeMessageUpdate(message: string): ConfigRuleResult<{ message: string; successMessage: string; }>;
  planJoinPrivateEnabled(enabled: boolean): ConfigRuleResult<{ enabled: boolean; successMessage: string; }>;
  planJoinPrivateMessageUpdate(message: string): ConfigRuleResult<{ message: string; successMessage: string; }>;
  planScheduledTaskDeletion(tasks: ScheduledTask[] | undefined, id: string): ConfigRuleResult<{ tasks: ScheduledTask[]; successMessage: string; }>;
}

class DefaultConfigDomainService implements ConfigDomainService {
  planScheduledTaskCreation(input: { time: string; content: string; now: number; }): ConfigRuleResult<{ task: ScheduledTask; successMessage: string; }> {
    if (!input.time || !input.content) {
      return {
        ok: false,
        status: 'command_format_error',
        message: '格式：定时任务 08:00 内容',
        vars: { example: '定时任务 08:00 早安' }
      };
    }
    if (!/^\d{2}:\d{2}$/.test(input.time)) {
      return {
        ok: false,
        status: 'command_format_error',
        message: '时间格式错误，应为 HH:mm',
        vars: { example: '08:00' }
      };
    }
    const id = input.now.toString(36);
    return {
      ok: true,
      status: 'success',
      data: {
        task: { id, cron: input.time, type: 'text', content: input.content },
        successMessage: `已添加定时任务 (ID:${id})：每天 ${input.time} 发送 "${input.content}"`
      }
    };
  }

  planWelcomeMessageUpdate(message: string): ConfigRuleResult<{ message: string; successMessage: string; }> {
    if (!message) {
      return {
        ok: false,
        status: 'command_format_error',
        message: '欢迎词不能为空',
        vars: { example: '设置欢迎词 欢迎{user}加入{group}' }
      };
    }
    return {
      ok: true,
      status: 'success',
      data: {
        message,
        successMessage: '欢迎词已更新'
      }
    };
  }

  planJoinPrivateEnabled(enabled: boolean): ConfigRuleResult<{ enabled: boolean; successMessage: string; }> {
    return {
      ok: true,
      status: 'success',
      data: {
        enabled,
        successMessage: enabled ? '已开启入群私聊' : '已关闭入群私聊'
      }
    };
  }

  planJoinPrivateMessageUpdate(message: string): ConfigRuleResult<{ message: string; successMessage: string; }> {
    if (!message) {
      return {
        ok: false,
        status: 'command_format_error',
        message: '私聊内容不能为空',
        vars: { example: '设置入群私聊 欢迎加入，请先看群公告' }
      };
    }
    return {
      ok: true,
      status: 'success',
      data: {
        message,
        successMessage: '入群私聊内容已更新'
      }
    };
  }

  planScheduledTaskDeletion(tasks: ScheduledTask[] | undefined, id: string): ConfigRuleResult<{ tasks: ScheduledTask[]; successMessage: string; }> {
    if (!tasks) {
      return {
        ok: false,
        status: 'list_empty',
        message: '本群无定时任务'
      };
    }
    const nextTasks = tasks.filter(task => task.id !== id);
    if (nextTasks.length === tasks.length) {
      return {
        ok: false,
        status: 'not_found',
        message: '未找到该ID的任务'
      };
    }
    return {
      ok: true,
      status: 'success',
      data: {
        tasks: nextTasks,
        successMessage: '已删除定时任务'
      }
    };
  }
}

export const configDomainService: ConfigDomainService = new DefaultConfigDomainService();
