import type { GroupGuardRuntimeContext } from '../../runtime/runtime_context';
import { saveConfig } from '../../commands/common';
import type { IConfigRepository } from '../../interfaces/config_repository';

class ConfigRepository implements IConfigRepository {
  constructor(private readonly ctx: GroupGuardRuntimeContext) {}

  save(): void {
    saveConfig(this.ctx);
  }
}

export function createConfigRepository(ctx: GroupGuardRuntimeContext): IConfigRepository {
  return new ConfigRepository(ctx);
}
