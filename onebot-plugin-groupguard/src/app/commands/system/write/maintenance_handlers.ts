import type { GroupGuardRuntimeContext } from '../../../../runtime/runtime_context';
import { buildGroupConfigCleanupWarningUseCase } from '../../../use-cases/system/write/maintenance/build_group_config_cleanup_warning';
import { clearGroupConfigUseCase } from '../../../use-cases/system/write/maintenance/clear_group_config';
import { createSystemWriteContext } from '../../../../infra/adapters/systemWriteAdapterFactory';
import type { SystemWriteCommandResult } from './types';

export function buildGroupConfigCleanupWarning(groupId = '', actorUserId = ''): SystemWriteCommandResult {
  return buildGroupConfigCleanupWarningUseCase({
    channel: 'group', action: 'build_group_config_cleanup_warning', actorUserId, originalText: '', groupId
  });
}

export function clearGroupConfig(groupId: string, userId: string, ctx: GroupGuardRuntimeContext): SystemWriteCommandResult {
  return clearGroupConfigUseCase({
    channel: 'group', action: 'clear_group_config', actorUserId: userId, originalText: '', groupId
  }, createSystemWriteContext(ctx));
}
