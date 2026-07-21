import { authStateService } from '../state-services/auth_state_service';

export class AuthGateway {
  isOwner(userId: string): boolean {
    return authStateService.isOwner(userId);
  }

  isBotAdmin(groupId: string): Promise<boolean> {
    return authStateService.isBotAdmin(groupId);
  }

  isBlacklisted(userId: string): boolean {
    return authStateService.isBlacklisted(userId);
  }

  isWhitelisted(userId: string): boolean {
    return authStateService.isWhitelisted(userId);
  }
}

export const authGateway = new AuthGateway();
