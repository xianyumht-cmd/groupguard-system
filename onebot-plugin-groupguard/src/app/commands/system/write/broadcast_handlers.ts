import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { broadcastLicensedGroups } from '../../../use-cases/system/write/messaging/broadcast_licensed_groups';
import { createSystemWriteContext } from '../../../../infra/adapters/systemWriteAdapterFactory';
import type { SystemWriteCommandResult } from './types';

export async function broadcastToLicensedGroups(
  content: string,
  ctx: NapCatPluginContext,
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
