import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { saveConfig } from '../../commands/common';
import type { IConfigRepository } from '../../interfaces/config_repository';

class ConfigRepository implements IConfigRepository {
  constructor(private readonly ctx: NapCatPluginContext) {}

  save(): void {
    saveConfig(this.ctx);
  }
}

export function createConfigRepository(ctx: NapCatPluginContext): IConfigRepository {
  return new ConfigRepository(ctx);
}
