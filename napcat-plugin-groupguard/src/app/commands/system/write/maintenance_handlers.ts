import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { buildGroupConfigCleanupWarningUseCase } from '../../../use-cases/system/write/maintenance/build_group_config_cleanup_warning';
import { clearGroupConfigUseCase } from '../../../use-cases/system/write/maintenance/clear_group_config';
import type { SystemWriteCommandResult } from './types';

export function buildGroupConfigCleanupWarning(): SystemWriteCommandResult {
  return buildGroupConfigCleanupWarningUseCase();
}

export function clearGroupConfig(groupId: string, userId: string, ctx: NapCatPluginContext): SystemWriteCommandResult {
  return clearGroupConfigUseCase(groupId, userId, ctx);
}
