import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { resetSystemQueue } from '../../../use-cases/system/write/queue/reset_system_queue';
import { createSystemWriteContext } from '../../../../infra/adapters/systemWriteAdapterFactory';
import type { SystemWriteCommandResult } from './types';

export function resetQueue(ctx: NapCatPluginContext, actorUserId = ''): SystemWriteCommandResult {
  return resetSystemQueue({
    channel: 'private', action: 'reset_queue', actorUserId, originalText: ''
  }, createSystemWriteContext(ctx));
}
