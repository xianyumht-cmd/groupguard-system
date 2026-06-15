const MAX_CONCURRENT_DYNAMIC_COMMAND_REQUESTS = 10;
const MAX_WAITERS = 100;

let activeCount = 0;
const waitQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_DYNAMIC_COMMAND_REQUESTS) {
    activeCount++;
    return;
  }
  if (waitQueue.length >= MAX_WAITERS) {
    throw new Error('backpressure_reject');
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function release(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export async function runWithDynamicCommandSemaphore<T>(operation: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}
