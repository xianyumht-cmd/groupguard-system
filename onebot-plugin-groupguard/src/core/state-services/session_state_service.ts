import type { VerifySession } from '../../types';
import { pluginStateSessionAdapter } from '../state-infra/plugin_state_session_adapter';

export class SessionStateService {
  getSessions(): Map<string, VerifySession> {
    return pluginStateSessionAdapter.getSessions();
  }

  getSession(key: string): VerifySession | undefined {
    return pluginStateSessionAdapter.getSession(key);
  }

  setSession(key: string, session: VerifySession): void {
    pluginStateSessionAdapter.setSession(key, session);
  }

  hasSession(key: string): boolean {
    return pluginStateSessionAdapter.hasSession(key);
  }

  deleteSession(key: string): boolean {
    return pluginStateSessionAdapter.deleteSession(key);
  }

  clearSessions(): void {
    pluginStateSessionAdapter.clearSessions();
  }

  entries(): IterableIterator<[string, VerifySession]> {
    return pluginStateSessionAdapter.entries();
  }

  values(): IterableIterator<VerifySession> {
    return pluginStateSessionAdapter.values();
  }

  getPendingComments(): Map<string, string> {
    return pluginStateSessionAdapter.getPendingComments();
  }

  getPendingComment(key: string): string | undefined {
    return pluginStateSessionAdapter.getPendingComment(key);
  }

  setPendingComment(key: string, comment: string): void {
    pluginStateSessionAdapter.setPendingComment(key, comment);
  }

  hasPendingComment(key: string): boolean {
    return pluginStateSessionAdapter.hasPendingComment(key);
  }

  deletePendingComment(key: string): boolean {
    return pluginStateSessionAdapter.deletePendingComment(key);
  }

  clearPendingComments(): void {
    pluginStateSessionAdapter.clearPendingComments();
  }

  pendingCommentEntries(): IterableIterator<[string, string]> {
    return pluginStateSessionAdapter.pendingCommentEntries();
  }
}

export const sessionStateService = new SessionStateService();
