export type AuthMessageScene =
  | 'raw_text'
  | 'action_success'
  | 'permission_denied'
  | 'command_format_error'
  | 'not_found'
  | 'feature_disabled';

export interface AuthLicenseState {
  level: string;
  expireTime: number;
}

export interface AuthDomainMessage {
  scene: AuthMessageScene;
  message: string;
  vars?: Record<string, string | number | boolean>;
}

export type AuthDomainResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: AuthDomainMessage;
    };

export interface AuthGrantPlan {
  groupId: string;
  days: number;
  level: 'pro' | 'enterprise';
  response: AuthDomainMessage;
}

export interface AuthActivationPlan {
  days: number;
  response: AuthDomainMessage;
}

export interface AuthDomainService {
  ensurePrivateOwnerAccess(isOwner: boolean, userId: string, text: string): AuthDomainResult<{}>;
  ensureGroupActivationAccess(isAdminOrOwner: boolean): AuthDomainResult<{}>;
  validateGrantRequest(groupId: string, durationToken: string): AuthDomainResult<AuthGrantPlan>;
  buildRevokeResponse(groupId: string): AuthDomainMessage;
  buildPrivateLicenseQueryResponse(groupId: string, license: AuthLicenseState | null, now: number): AuthDomainMessage;
  buildGroupLicenseStatusResponse(groupId: string, license: AuthLicenseState | null, now: number): AuthDomainMessage;
  validateActivationKey(key: string): AuthDomainResult<AuthActivationPlan>;
}

function remainingDaysText(expireTime: number, now: number): string {
  if (expireTime <= 0) return '永久';
  return `${Math.max(0, Math.ceil((expireTime - now) / 86400000))}天`;
}

function invalidGrantDuration(): AuthDomainResult<AuthGrantPlan> {
  return {
    ok: false,
    response: {
      scene: 'command_format_error',
      message: '授权天数格式错误，只能填写正整数天数或“永久”。',
      vars: { example: '授权 123456 30' }
    }
  };
}

class DefaultAuthDomainService implements AuthDomainService {
  ensurePrivateOwnerAccess(isOwner: boolean, userId: string, text: string): AuthDomainResult<{}> {
    if (isOwner) return { ok: true, data: {} };
    return {
      ok: false,
      response: {
        scene: 'permission_denied',
        message: '权限不足：该指令仅限机器人主人使用。',
        vars: { userId, text }
      }
    };
  }

  ensureGroupActivationAccess(isAdminOrOwner: boolean): AuthDomainResult<{}> {
    if (isAdminOrOwner) return { ok: true, data: {} };
    return {
      ok: false,
      response: {
        scene: 'permission_denied',
        message: '需要管理员权限'
      }
    };
  }

  validateGrantRequest(groupId: string, durationToken: string): AuthDomainResult<AuthGrantPlan> {
    if (!/^\d+$/.test(groupId)) {
      return {
        ok: false,
        response: {
          scene: 'command_format_error',
          message: '群号格式错误',
          vars: { example: '授权 123456 30' }
        }
      };
    }

    const normalizedDuration = String(durationToken || '').trim();
    let days: number;
    if (normalizedDuration === '永久') {
      days = -1;
    } else {
      if (!/^[1-9]\d*$/.test(normalizedDuration)) return invalidGrantDuration();
      days = Number(normalizedDuration);
      if (!Number.isSafeInteger(days) || days <= 0) return invalidGrantDuration();
    }

    return {
      ok: true,
      data: {
        groupId,
        days,
        level: days === -1 ? 'enterprise' : 'pro',
        response: {
          scene: 'action_success',
          message: `已授权群 ${groupId} ${days === -1 ? '永久' : days + '天'}`,
          vars: { target: groupId, days: days === -1 ? '永久' : days }
        }
      }
    };
  }

  buildRevokeResponse(groupId: string): AuthDomainMessage {
    return {
      scene: 'action_success',
      message: `已回收群 ${groupId} 授权`,
      vars: { target: groupId }
    };
  }

  buildPrivateLicenseQueryResponse(groupId: string, license: AuthLicenseState | null, now: number): AuthDomainMessage {
    if (!license) {
      return {
        scene: 'not_found',
        message: `群 ${groupId} 未授权`,
        vars: { target: groupId }
      };
    }
    return {
      scene: 'raw_text',
      message: `群 ${groupId} (${license.level})\n剩余时间: ${remainingDaysText(license.expireTime, now)}`,
      vars: { target: groupId }
    };
  }

  buildGroupLicenseStatusResponse(groupId: string, license: AuthLicenseState | null, now: number): AuthDomainMessage {
    if (!license) {
      return {
        scene: 'feature_disabled',
        message: '⚠️ 本群当前未获得授权\n功能受限，请联系管理员获取授权。'
      };
    }
    return {
      scene: 'raw_text',
      message: `✅ 本群已授权 (${license.level === 'enterprise' ? '企业版' : '专业版'})\n📅 剩余有效期: ${remainingDaysText(license.expireTime, now)}`
    };
  }

  validateActivationKey(_key: string): AuthDomainResult<AuthActivationPlan> {
    return {
      ok: false,
      response: {
        scene: 'feature_disabled',
        message: '群内激活码功能已停用，请联系机器人主人完成授权或续费。'
      }
    };
  }
}

export const authDomainService: AuthDomainService = new DefaultAuthDomainService();
