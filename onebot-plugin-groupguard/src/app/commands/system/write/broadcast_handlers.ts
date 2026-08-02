import type { GroupGuardRuntimeContext } from '../../../../runtime/runtime_context';
import { broadcastLicensedGroups } from '../../../use-cases/system/write/messaging/broadcast_licensed_groups';
import { createSystemWriteContext } from '../../../../infra/adapters/systemWriteAdapterFactory';
import type { SystemWriteCommandResult } from './types';

export async function broadcastToLicensedGroups(
  content: string,
  ctx: GroupGuardRuntimeContext,
  actorUserId = ''
): Promise<SystemWriteCommandResult> {
  return broadcastLicensedGroups({
    channel: 'private',
    action: 'broadcast_licensed_groups',
    actorUserId,
    originalText: content,
    content
  }, createSystemWriteContext(ctx));
}
