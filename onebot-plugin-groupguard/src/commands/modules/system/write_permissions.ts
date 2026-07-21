export type SystemWritePermission = 'admin' | 'owner' | null;

export function resolvePrivateSystemWritePermission(text: string): SystemWritePermission {
  if (
    text === '队列重置' ||
    text === '/队列重置' ||
    text.startsWith('多群广播 ')
  ) {
    return 'owner';
  }
  return null;
}

export function resolveGroupSystemWritePermission(text: string): SystemWritePermission {
  if (text === '清空群配置' || text === '确认清空群配置') return 'owner';
  if (
    text === '开启入群私聊' ||
    text === '关闭入群私聊' ||
    text.startsWith('设置欢迎词 ') ||
    text.startsWith('设置入群私聊 ') ||
    text.startsWith('定时任务 ') ||
    text.startsWith('删除定时任务 ')
  ) {
    return 'admin';
  }
  return null;
}
