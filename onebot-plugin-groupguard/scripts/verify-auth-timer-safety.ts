import assert from 'node:assert/strict';
import { authManager } from '../src/auth';
import { loggingStateService } from '../src/core/state-services/logging_state_service';

const manager = authManager as unknown as {
  init: () => void;
  cleanup: () => void;
  checkLicenses: () => Promise<void>;
};

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalCheckLicenses = manager.checkLicenses;
const originalError = loggingStateService.error;

let scheduledCallback: (() => void) | null = null;
let scheduledDelay = 0;
let clearedHandle: unknown = null;
const fakeHandle = { kind: 'auth-timer-regression' };
const loggedErrors: string[] = [];
const unhandledRejections: unknown[] = [];
const onUnhandledRejection = (reason: unknown) => {
  unhandledRejections.push(reason);
};

try {
  (globalThis as any).setInterval = (callback: () => void, delay: number) => {
    scheduledCallback = callback;
    scheduledDelay = delay;
    return fakeHandle;
  };
  (globalThis as any).clearInterval = (handle: unknown) => {
    clearedHandle = handle;
  };
  manager.checkLicenses = async () => {
    throw new Error('auth_timer_regression_failure');
  };
  loggingStateService.error = (message: string) => {
    loggedErrors.push(message);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  manager.init();
  assert.equal(scheduledDelay, 3_600_000, 'auth check interval must remain hourly');
  assert.ok(scheduledCallback, 'auth init must schedule a license check callback');

  scheduledCallback();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(unhandledRejections, [], 'auth timer rejection must be consumed locally');
  assert.ok(
    loggedErrors.some((message) => message.includes('授权定时检查失败') && message.includes('auth_timer_regression_failure')),
    'auth timer rejection must be logged for diagnosis'
  );

  manager.cleanup();
  assert.equal(clearedHandle, fakeHandle, 'auth cleanup must clear the active interval');
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
  try { manager.cleanup(); } catch { /* best effort */ }
  manager.checkLicenses = originalCheckLicenses;
  loggingStateService.error = originalError;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

console.log('auth timer rejection safety verified');
