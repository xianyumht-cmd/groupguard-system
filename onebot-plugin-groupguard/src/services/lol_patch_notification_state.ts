import fs from 'node:fs';
import path from 'node:path';

const STATE_VERSION = 1;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

interface DeliveryRecord {
  eventId: string;
  groupId: string;
  sentAt: string;
}

interface PersistedState {
  version: 1;
  deliveries: Record<string, DeliveryRecord>;
}

function deliveryKey(eventId: string, groupId: string): string {
  return `${eventId}:${groupId}`;
}

function emptyState(): PersistedState {
  return { version: STATE_VERSION, deliveries: {} };
}

function isDeliveryRecord(value: unknown): value is DeliveryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    String(record.eventId || '').trim()
    && String(record.groupId || '').trim()
    && String(record.sentAt || '').trim()
  );
}

export class LolPatchNotificationStateStore {
  readonly filePath: string;
  private state: PersistedState;

  constructor(dataDir: string) {
    this.filePath = path.join(path.resolve(dataDir), 'lol-patch-notifications.json');
    this.state = this.load();
    this.prune(Date.now());
  }

  has(eventId: string, groupId: string): boolean {
    return Boolean(this.state.deliveries[deliveryKey(eventId, groupId)]);
  }

  mark(eventId: string, groupId: string, sentAt: string): void {
    const normalizedEventId = String(eventId || '').trim();
    const normalizedGroupId = String(groupId || '').trim();
    const normalizedSentAt = String(sentAt || '').trim();
    if (!normalizedEventId || !normalizedGroupId || !normalizedSentAt) {
      throw new Error('lol_patch_notification_state_invalid_delivery');
    }
    this.state.deliveries[deliveryKey(normalizedEventId, normalizedGroupId)] = {
      eventId: normalizedEventId,
      groupId: normalizedGroupId,
      sentAt: normalizedSentAt,
    };
    this.prune(Date.now());
    this.persist();
  }

  private load(): PersistedState {
    if (!fs.existsSync(this.filePath)) return emptyState();
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new Error('lol_patch_notification_state_corrupt', { cause: error });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('lol_patch_notification_state_corrupt');
    }
    const raw = parsed as Record<string, unknown>;
    if (raw.version !== STATE_VERSION || !raw.deliveries || typeof raw.deliveries !== 'object' || Array.isArray(raw.deliveries)) {
      throw new Error('lol_patch_notification_state_corrupt');
    }
    const deliveries: Record<string, DeliveryRecord> = {};
    for (const [key, value] of Object.entries(raw.deliveries as Record<string, unknown>)) {
      if (!isDeliveryRecord(value)) throw new Error('lol_patch_notification_state_corrupt');
      deliveries[key] = {
        eventId: String(value.eventId),
        groupId: String(value.groupId),
        sentAt: String(value.sentAt),
      };
    }
    return { version: STATE_VERSION, deliveries };
  }

  private prune(nowMs: number): void {
    for (const [key, record] of Object.entries(this.state.deliveries)) {
      const timestamp = Date.parse(record.sentAt);
      if (!Number.isFinite(timestamp) || nowMs - timestamp > RETENTION_MS) {
        delete this.state.deliveries[key];
      }
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
      throw new Error('lol_patch_notification_state_persist_failed', { cause: error });
    }
  }
}
