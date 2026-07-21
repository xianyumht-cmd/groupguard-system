import type { VerifySession } from '../types';
import { sessionStateService } from '../core/state-services/session_state_service';

export class SessionGateway {
  getSessions(): Map<string, VerifySession> {
    return sessionStateService.getSessions();
  }

  getSession(key: string): VerifySession | undefined {
    return sessionStateService.getSession(key);
  }

  setSession(key: string, session: VerifySession): void {
    sessionStateService.setSession(key, session);
  }

  hasSession(key: string): boolean {
    return sessionStateService.hasSession(key);
  }

  deleteSession(key: string): boolean {
    return sessionStateService.deleteSession(key);
  }

  clearSessions(): void {
    sessionStateService.clearSessions();
  }

  entries(): IterableIterator<[string, VerifySession]> {
    return sessionStateService.entries();
  }

  values(): IterableIterator<VerifySession> {
    return sessionStateService.values();
  }

  getPendingComments(): Map<string, string> {
    return sessionStateService.getPendingComments();
  }

  getPendingComment(key: string): string | undefined {
    return sessionStateService.getPendingComment(key);
  }

  setPendingComment(key: string, comment: string): void {
    sessionStateService.setPendingComment(key, comment);
  }

  hasPendingComment(key: string): boolean {
    return sessionStateService.hasPendingComment(key);
  }

  deletePendingComment(key: string): boolean {
    return sessionStateService.deletePendingComment(key);
  }

  clearPendingComments(): void {
    sessionStateService.clearPendingComments();
  }

  pendingCommentEntries(): IterableIterator<[string, string]> {
    return sessionStateService.pendingCommentEntries();
  }
}

export const sessionGateway = new SessionGateway();
