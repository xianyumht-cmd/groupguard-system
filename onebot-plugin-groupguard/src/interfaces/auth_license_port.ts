export interface AuthLicenseRecord {
  level: string;
  expireTime: number;
}

export interface IAuthLicensePort {
  grantLicense(groupId: string, days: number, level?: 'pro' | 'enterprise'): void;
  revokeLicense(groupId: string): void;
  getGroupLicense(groupId: string): AuthLicenseRecord | null;
}
