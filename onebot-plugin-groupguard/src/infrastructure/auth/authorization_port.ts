import { isAdminOrOwner } from '../../commands/common';
import { authStateService } from '../../core/state-services/auth_state_service';
import type { IAuthorizationPort } from '../../interfaces/authorization_port';

class AuthorizationPort implements IAuthorizationPort {
  isOwner(userId: string): boolean {
    return authStateService.isOwner(userId);
  }

  async isAdminOrOwner(groupId: string, userId: string): Promise<boolean> {
    return isAdminOrOwner(groupId, userId);
  }
}

export function createAuthorizationPort(): IAuthorizationPort {
  return new AuthorizationPort();
}
