import { authDomainService } from '../../../domain/auth/auth_domain_service';
import type { AuthUseCasePorts } from './ports';
import type { AuthCommand } from './types';

async function sendResponse(
  ports: AuthUseCasePorts,
  channel: 'private' | 'group',
  targetId: string,
  response: { scene: 'raw_text' | 'action_success' | 'permission_denied' | 'command_format_error' | 'not_found' | 'feature_disabled'; message: string; vars?: Record<string, string | number | boolean>; }
): Promise<void> {
  await ports.messagePort.send({
    channel,
    targetId,
    scene: response.scene,
    message: response.message,
    vars: response.vars
  });
}

export async function executeAuthCommandUseCase(command: AuthCommand, ports: AuthUseCasePorts): Promise<boolean> {
  if (command.channel === 'private') {
    const access = authDomainService.ensurePrivateOwnerAccess(
      ports.authorizationPort.isOwner(command.actorUserId),
      command.actorUserId,
      command.originalText
    );
    if (!access.ok) {
      ports.loggingPort.warn(`非主人用户 ${command.actorUserId} 尝试执行私聊授权指令 [${command.originalText}] 被拦截`);
      await sendResponse(ports, 'private', command.actorUserId, access.response);
      return true;
    }
    if (command.action === 'grant') {
      const plan = authDomainService.validateGrantRequest(command.targetGroupId, command.durationToken);
      if (!plan.ok) {
        await sendResponse(ports, 'private', command.actorUserId, plan.response);
        return true;
      }
      ports.authLicensePort.grantLicense(plan.data.groupId, plan.data.days, plan.data.level);
      await ports.configRepository.save();
      await sendResponse(ports, 'private', command.actorUserId, plan.data.response);
      return true;
    }
    if (command.action === 'revoke') {
      ports.authLicensePort.revokeLicense(command.targetGroupId);
      await ports.configRepository.save();
      await sendResponse(ports, 'private', command.actorUserId, authDomainService.buildRevokeResponse(command.targetGroupId));
      return true;
    }
    if (command.action === 'query_private') {
      await sendResponse(
        ports,
        'private',
        command.actorUserId,
        authDomainService.buildPrivateLicenseQueryResponse(
          command.targetGroupId,
          ports.authLicensePort.getGroupLicense(command.targetGroupId),
          Date.now()
        )
      );
      return true;
    }
    return false;
  }

  if (command.action === 'query_group') {
    await sendResponse(
      ports,
      'group',
      command.groupId,
      authDomainService.buildGroupLicenseStatusResponse(
        command.groupId,
        ports.authLicensePort.getGroupLicense(command.groupId),
        Date.now()
      )
    );
    return true;
  }

  if (command.action === 'activate') {
    const access = authDomainService.ensureGroupActivationAccess(
      await ports.authorizationPort.isAdminOrOwner(command.groupId, command.actorUserId)
    );
    if (!access.ok) {
      await sendResponse(ports, 'group', command.groupId, access.response);
      return true;
    }
    const plan = authDomainService.validateActivationKey(command.activationKey);
    if (!plan.ok) {
      await sendResponse(ports, 'group', command.groupId, plan.response);
      return true;
    }
    ports.authLicensePort.grantLicense(command.groupId, plan.data.days);
    await ports.configRepository.save();
    await sendResponse(ports, 'group', command.groupId, plan.data.response);
    return true;
  }

  return false;
}
