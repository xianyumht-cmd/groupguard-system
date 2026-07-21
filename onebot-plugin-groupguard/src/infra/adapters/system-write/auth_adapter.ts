import { authManager } from '../../../auth';
import { isAdminOrOwner } from '../../../commands/common';
import { authStateService } from '../../../core/state-services/auth_state_service';
import type { ISystemWriteAuthPort } from '../../../app/use-cases/system/write/ports';

export class AuthAdapter implements ISystemWriteAuthPort {
  hasGroupLicense(groupId: string): boolean {
    return Boolean(authManager.getGroupLicense(groupId));
  }

  isOwner(userId: string): boolean {
    return authStateService.isOwner(userId);
  }

  async isAdminOrOwner(groupId: string, userId: string): Promise<boolean> {
    return isAdminOrOwner(groupId, userId);
  }
}
