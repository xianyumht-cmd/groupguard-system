import { communicationStateService } from '../../../core/state-services/communication_state_service';
import type { ISystemWriteRuntimePort } from '../../../app/use-cases/system/write/ports';

export class RuntimeAdapter implements ISystemWriteRuntimePort {
  async listGroupIds(): Promise<string[]> {
    const groups = await communicationStateService.callApi('get_group_list', {}) as any[] || [];
    return groups.map(group => String(group.group_id));
  }
}
