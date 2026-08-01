import type { ISystemWriteMessagingPort, SystemWriteRuntimeContext, SystemWriteUseCaseContext } from '../../app/use-cases/system/write/ports';
import { AuthAdapter } from './system-write/auth_adapter';
import { ConfigAdapter } from './system-write/config_adapter';
import { QueueAdapter } from './system-write/queue_adapter';
import { MessagingAdapter } from './system-write/messaging_adapter';
import { LoggingAdapter } from './system-write/logging_adapter';
import { RuntimeAdapter } from './system-write/runtime_adapter';
import { MaintenanceAdapter } from './system-write/maintenance_adapter';

export function createSystemWriteContext(ctx: SystemWriteRuntimeContext): SystemWriteUseCaseContext {
  return {
    configPort: new ConfigAdapter(ctx),
    queuePort: new QueueAdapter(),
    messagingPort: new MessagingAdapter(),
    runtimePort: new RuntimeAdapter(),
    authPort: new AuthAdapter(),
    maintenancePort: new MaintenanceAdapter(),
    loggingPort: new LoggingAdapter()
  };
}

export function createSystemWriteMessagingPort(): ISystemWriteMessagingPort {
  return new MessagingAdapter();
}
