import { storageAdapter } from '../../../storage_adapter';

export function getStorageStatusText(): string {
  try {
    const status = storageAdapter.getStorageStatus();
    const tableCounts = status?.tableCounts && typeof status.tableCounts === 'object' ? status.tableCounts : {};
    const tableLines = Object.entries(tableCounts).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `SQLite 状态：\n迁移标记: ${status?.migrated ? '已完成' : '未完成'}\n数据库: ${status?.dbPath || 'unknown'}\n表计数:\n${tableLines}`;
  } catch (error) {
    return `SQLite 状态：\n读取失败: ${String(error)}`;
  }
}
