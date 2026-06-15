import type { IAuthLicensePort } from '../../../interfaces/auth_license_port';
import type { IAuthorizationPort } from '../../../interfaces/authorization_port';
import type { IConfigRepository } from '../../../interfaces/config_repository';
import type { ILoggingPort } from '../../../interfaces/logging_port';
import type { IMessagePort } from '../../../interfaces/message_port';

export interface AuthUseCasePorts {
  messagePort: IMessagePort;
  configRepository: IConfigRepository;
  authLicensePort: IAuthLicensePort;
  authorizationPort: IAuthorizationPort;
  loggingPort: ILoggingPort;
}
