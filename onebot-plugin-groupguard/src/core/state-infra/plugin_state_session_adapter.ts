import type { VerifySession } from '../../types';
import { pluginState } from '../../state';

export class PluginStateSessionAdapter {
  getSessions(): Map<string, VerifySession> {
    return pluginState.sessions;
  }

  getSession(key: string): VerifySession | undefined {
    return pluginState.sessions.get(key);
  }

  setSession(key: string, session: VerifySession): void {
    pluginState.sessions.set(key, session);
  }

  hasSession(key: string): boolean {
    return pluginState.sessions.has(key);
  }

  deleteSession(key: string): boolean {
    return pluginState.sessions.delete(key);
  }

  clearSessions(): void {
    pluginState.sessions.clear();
  }

  entries(): IterableIterator<[string, VerifySession]> {
    return pluginState.sessions.entries();
  }

  values(): IterableIterator<VerifySession> {
    return pluginState.sessions.values();
  }

  getPendingComments(): Map<string, string> {
    return pluginState.pendingComments;
  }

  getPendingComment(key: string): string | undefined {
    return pluginState.pendingComments.get(key);
  }

  setPendingComment(key: string, comment: string): void {
    pluginState.pendingComments.set(key, comment);
  }

  hasPendingComment(key: string): boolean {
    return pluginState.pendingComments.has(key);
  }

  deletePendingComment(key: string): boolean {
    return pluginState.pendingComments.delete(key);
  }

  clearPendingComments(): void {
    pluginState.pendingComments.clear();
  }

  pendingCommentEntries(): IterableIterator<[string, string]> {
    return pluginState.pendingComments.entries();
  }
}

export const pluginStateSessionAdapter = new PluginStateSessionAdapter();
