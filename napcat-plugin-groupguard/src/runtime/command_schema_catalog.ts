import { getCommandRuntimeSchema } from '../dynamic-commands/command_observability';
import type { CommandRuntimeSchemaModule } from '../dynamic-commands/types';

export async function getRuntimeSchemaCatalog(): Promise<CommandRuntimeSchemaModule[]> {
  return getCommandRuntimeSchema();
}
