import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import type { OneBotMessageEvent } from '../protocol/onebot11/types';

export interface CommandExecutionContext {
  event: OneBotMessageEvent;
  ctx: GroupGuardRuntimeContext;
  raw: string;
  text: string;
  userId: string;
  groupId: string;
}
