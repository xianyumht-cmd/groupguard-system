import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { loggingStateService } from './core/state-services/logging_state_service';
import { initializeDynamicCommands, loadDynamicCommands } from './dynamic-commands/command_loader';
import { assertCommandPluginRegistryReady, refreshCommandPluginRegistry } from './dynamic-commands/command_plugin_registry';
import { refreshDynamicCommandRegistry } from './dynamic-commands/command_registry';
import { initializeDynamicCommandMetrics } from './dynamic-commands/command_engine';
import { registerEleBuildCommandPlugins } from './dynamic-commands/ele_build_runtime_plugin';
import { registerIntranetBattleCommandPlugins } from './dynamic-commands/intranet_battle_runtime_plugin';
import { registerIntranetHiddenCommandPlugins } from './dynamic-commands/intranet_hidden_runtime_plugin';
import { registerIntranetQueryCommandPlugins } from './dynamic-commands/intranet_query_runtime_plugin';
import { registerIntranetRiskCommandPlugins } from './dynamic-commands/intranet_risk_runtime_plugin';
import { registerLegacyRuntimePlugins } from './dynamic-commands/legacy_runtime_plugins';
import { registerSendWrapperCommandPlugins } from './dynamic-commands/send_wrapper_runtime_plugins';
import { registerSubGameplayCommandPlugins } from './dynamic-commands/sub_gameplay_runtime_plugin';
import { commandDispatcher } from './commands/dispatcher';
export { saveConfig } from './commands/common';
export {
  handleAntiRecall,
  cacheMessage,
  handleEmojiReact,
  handleCardLockCheck,
  handleCardLockOnMessage,
  handleAutoRecall,
  sendWelcomeMessage,
  handleMsgTypeFilter,
  handleBlacklist,
  handleFilterKeywords,
  handleSpamDetect,
  handleQA,
  recordActivity
} from './commands/passive';
let commandValidationRan = false;

export function initCommandValidation(): void {
  if (commandValidationRan) return;
  commandValidationRan = true;
  registerIntranetQueryCommandPlugins();
  registerIntranetBattleCommandPlugins();
  registerIntranetHiddenCommandPlugins();
  registerIntranetRiskCommandPlugins();
  registerLegacyRuntimePlugins();
  registerSendWrapperCommandPlugins();
  registerEleBuildCommandPlugins();
  registerSubGameplayCommandPlugins();
  void initializeDynamicCommands().then(() => {
    refreshCommandPluginRegistry();
    assertCommandPluginRegistryReady();
    refreshDynamicCommandRegistry();
    return initializeDynamicCommandMetrics(loadDynamicCommands().map((command) => command.id));
  });
}

export async function handleCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  initCommandValidation();
  try {
    return await commandDispatcher.handle(event, ctx);
  } catch (error) {
    loggingStateService.error(`统一命令调度异常: ${error}`);
    return false;
  }
}
