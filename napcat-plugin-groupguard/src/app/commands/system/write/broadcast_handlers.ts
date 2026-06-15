import { broadcastLicensedGroups } from '../../../use-cases/system/write/messaging/broadcast_licensed_groups';
import type { SystemWriteCommandResult } from './types';

export async function broadcastToLicensedGroups(content: string): Promise<SystemWriteCommandResult> {
  return broadcastLicensedGroups(content);
}
