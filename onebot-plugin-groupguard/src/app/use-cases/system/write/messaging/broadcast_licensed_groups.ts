import { messagingDomainService } from '../../../../../domain/messaging/messaging_domain_service';
import type { SystemWriteCommand, SystemWriteUseCaseResult } from '../types';
import type { SystemWriteUseCaseContext } from '../ports';

export async function broadcastLicensedGroups(
  command: Extract<SystemWriteCommand, { action: 'broadcast_licensed_groups'; }>,
  context: SystemWriteUseCaseContext
): Promise<SystemWriteUseCaseResult> {
  const validation = messagingDomainService.validateBroadcastContent(command.content);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.message,
      data: {
        message: validation.message,
        scene: 'command_format_error',
        vars: validation.vars
      }
    };
  }

  let groupIds: string[] = [];
  try {
    groupIds = await context.runtimePort.listGroupIds();
  } catch (e) {
    return {
      success: false,
      error: messagingDomainService.buildBroadcastFetchFailureMessage(String(e)),
      data: {
        message: messagingDomainService.buildBroadcastFetchFailureMessage(String(e)),
        scene: 'raw_text'
      }
    };
  }

  let success = 0;
  let fail = 0;
  for (const groupId of groupIds) {
    if (!messagingDomainService.shouldBroadcastToGroup({ hasLicense: context.authPort.hasGroupLicense(groupId) })) continue;
    try {
      await context.messagingPort.sendGroupScene(groupId, 'raw_text', messagingDomainService.buildBroadcastPayload(validation.data.content));
      success++;
      await context.messagingPort.delay(1500);
    } catch {
      fail++;
    }
  }

  return {
    success: true,
    data: {
      message: messagingDomainService.buildBroadcastCompletionMessage({ success, fail }),
      before: [messagingDomainService.buildBroadcastStartNotice()],
      scene: 'raw_text'
    }
  };
}
