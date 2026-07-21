import { authManager } from '../../auth';
import type { AuthLicenseRecord, IAuthLicensePort } from '../../interfaces/auth_license_port';

class AuthLicensePort implements IAuthLicensePort {
  grantLicense(groupId: string, days: number, level?: 'pro' | 'enterprise'): void {
    authManager.grantLicense(groupId, days, level);
  }

  revokeLicense(groupId: string): void {
    authManager.revokeLicense(groupId);
  }

  getGroupLicense(groupId: string): AuthLicenseRecord | null {
    const license = authManager.getGroupLicense(groupId);
    if (!license) return null;
    return {
      level: license.level,
      expireTime: license.expireTime
    };
  }
}

export function createAuthLicensePort(): IAuthLicensePort {
  return new AuthLicensePort();
}
