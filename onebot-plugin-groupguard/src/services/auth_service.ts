import type { GroupGuardRuntimeContext } from '../runtime/runtime_context';
import { executeAuthCommandUseCase } from '../app/use-cases/auth/execute_auth_command';
import type { AuthCommand } from '../app/use-cases/auth/types';
import { createAuthLicensePort } from '../infrastructure/auth/auth_license_port';
import { createAuthorizationPort } from '../infrastructure/auth/authorization_port';
import { createConfigRepository } from '../infrastructure/config/config_repository';
import { createLoggingPort } from '../infrastructure/logging/logging_port';
import { createSceneMessagePort } from '../infrastructure/messaging/scene_message_port';

export async function executeAuthCommand(command: AuthCommand, ctx: GroupGuardRuntimeContext): Promise<boolean> {
  return executeAuthCommandUseCase(command, {
    messagePort: createSceneMessagePort(),
    configRepository: createConfigRepository(ctx),
    authLicensePort: createAuthLicensePort(),
    authorizationPort: createAuthorizationPort(),
    loggingPort: createLoggingPort()
  });
}
