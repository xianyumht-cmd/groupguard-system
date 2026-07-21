import { identityStateService } from '../state-services/identity_state_service';

export class BotContextGateway {
  getBotId(): string {
    return identityStateService.getBotId();
  }

  getVersion(): string {
    return identityStateService.getVersion();
  }
}

export const botContextGateway = new BotContextGateway();
