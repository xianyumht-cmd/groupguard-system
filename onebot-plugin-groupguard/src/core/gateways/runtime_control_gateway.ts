import { runtimeControlService } from '../state-services/runtime_control_service';

export class RuntimeControlGateway {
  clearLogs(): void {
    runtimeControlService.clearLogs();
  }

  scheduleSelfRecall(groupId: string, messageId: string, source: 'send_group_msg' | 'message_event' = 'send_group_msg'): void {
    runtimeControlService.scheduleSelfRecall(groupId, messageId, source);
  }
}

export const runtimeControlGateway = new RuntimeControlGateway();
