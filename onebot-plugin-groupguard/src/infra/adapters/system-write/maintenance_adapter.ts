import fs from 'fs';
import path from 'path';
import { contextStateService } from '../../../core/state-services/context_state_service';
import type { ISystemWriteMaintenancePort } from '../../../app/use-cases/system/write/ports';

export class MaintenanceAdapter implements ISystemWriteMaintenancePort {
  clearGroupData(groupId: string): void {
    const groupDataDir = path.join(contextStateService.getConfigDir(), 'data', groupId);
    if (fs.existsSync(groupDataDir)) {
      fs.rmSync(groupDataDir, { recursive: true, force: true });
      fs.mkdirSync(groupDataDir, { recursive: true });
    }
  }
}
