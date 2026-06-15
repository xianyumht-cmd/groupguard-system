export interface MaintenanceDomainService {
  buildGroupConfigCleanupWarning(): string;
  buildGroupConfigCleanupSuccess(): string;
  buildGroupConfigCleanupFailure(error: string): string;
}

class DefaultMaintenanceDomainService implements MaintenanceDomainService {
  buildGroupConfigCleanupWarning(): string {
    return '⚠️ 警告：此操作将清空本群所有配置和数据（包括问答、违禁词、日志等），且不可恢复！\n请发送「确认清空群配置」以执行。';
  }

  buildGroupConfigCleanupSuccess(): string {
    return '✅ 已清空本群所有配置和数据';
  }

  buildGroupConfigCleanupFailure(error: string): string {
    return `清空失败: ${error}`;
  }
}

export const maintenanceDomainService: MaintenanceDomainService = new DefaultMaintenanceDomainService();
