import fs from 'node:fs';
import { atomicWriteTargetFilePushJson } from './target_file_push_config';

export type TargetFilePushCompletedEvent = {
  eventId: string;
  fingerprint: string;
  fileName: string;
  fileId: string;
  uploadedAt: number;
};

export type TargetFilePushCurrentEvent = {
  eventId: string;
  fingerprint: string;
  fileName: string;
  localPath: string;
  state: 'downloading' | 'downloaded' | 'uploading' | 'failed' | 'cleanup_pending';
  startedAt: number;
  updatedAt: number;
  lastError: string;
};

export type TargetFilePushState = {
  version: 1;
  current: TargetFilePushCurrentEvent | null;
  completed: Record<string, TargetFilePushCompletedEvent>;
  lastSuccessAt: number;
  lastErrorAt: number;
  lastError: string;
};

const MAX_COMPLETED_EVENTS = 200;

export function emptyTargetFilePushState(): TargetFilePushState {
  return {
    version: 1,
    current: null,
    completed: {},
    lastSuccessAt: 0,
    lastErrorAt: 0,
    lastError: '',
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadTargetFilePushState(filePath: string): TargetFilePushState {
  if (!fs.existsSync(filePath)) return emptyTargetFilePushState();
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.completed)) throw new Error('target_file_push_state_invalid');
  return {
    ...emptyTargetFilePushState(),
    ...raw,
    current: isRecord(raw.current) ? raw.current as TargetFilePushCurrentEvent : null,
    completed: raw.completed as Record<string, TargetFilePushCompletedEvent>,
  };
}

export function saveTargetFilePushState(filePath: string, state: TargetFilePushState): void {
  const retained = Object.values(state.completed)
    .sort((a, b) => Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0))
    .slice(0, MAX_COMPLETED_EVENTS);
  state.completed = Object.fromEntries(retained.map(item => [item.eventId, item]));
  atomicWriteTargetFilePushJson(filePath, state);
}
