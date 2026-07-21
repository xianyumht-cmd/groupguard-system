import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_ROOT = 'D:\\snowluma\\groupguard-snowluma-service';
const ACCOUNTS = ['qq1', 'qq2', 'qq3'];
const FEATURE_DEFAULTS = {
  masterEnabled: true,
  silentMode: 'off',
  activeReplyEnabled: true,
  queryEnabled: true,
  qaEnabled: true,
  dynamicCommandEnabled: true,
};
const LOL_FEATURE_KEYS = {
  banQuery: 'query.lol_ban',
  battleQuery: 'query.lol_battle',
  hiddenQuery: 'query.lol_hidden',
};

function parseArgs(argv) {
  const result = { root: process.env.SNOWLUMA_GROUPGUARD_DIR || DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      result.root = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonWithBackup(filePath, value, backupWhenExists = true) {
  let backupPath = '';
  if (backupWhenExists && await exists(filePath)) {
    backupPath = `${filePath}.bak.${timestamp()}`;
    await fs.copyFile(filePath, backupPath);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return backupPath;
}

function ensureFeatureSwitches(settings, changes, prefix) {
  if (!settings.featureSwitches || typeof settings.featureSwitches !== 'object' || Array.isArray(settings.featureSwitches)) {
    settings.featureSwitches = {};
    changes.push(`${prefix}.featureSwitches`);
  }
  return settings.featureSwitches;
}

function setMissing(settings, key, value, changes, prefix) {
  if (settings[key] === undefined) {
    settings[key] = value;
    changes.push(`${prefix}.${key}`);
  }
}

function setSwitchMissing(settings, featureKey, value, changes, prefix) {
  const switches = ensureFeatureSwitches(settings, changes, prefix);
  if (switches[featureKey] === undefined) {
    switches[featureKey] = value;
    changes.push(`${prefix}.featureSwitches["${featureKey}"]`);
  }
}

function migrateSettings(settings, prefix) {
  const changes = [];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return changes;

  setMissing(settings, 'masterEnabled', FEATURE_DEFAULTS.masterEnabled, changes, prefix);
  setMissing(settings, 'silentMode', FEATURE_DEFAULTS.silentMode, changes, prefix);
  setMissing(settings, 'activeReplyEnabled', FEATURE_DEFAULTS.activeReplyEnabled, changes, prefix);
  setMissing(settings, 'dynamicCommandEnabled', FEATURE_DEFAULTS.dynamicCommandEnabled, changes, prefix);

  const disableQA = settings.disableQA === true;
  const disableLolQuery = settings.disableLolQuery === true;
  setMissing(settings, 'qaEnabled', disableQA ? false : FEATURE_DEFAULTS.qaEnabled, changes, prefix);
  setMissing(settings, 'queryEnabled', disableLolQuery ? false : FEATURE_DEFAULTS.queryEnabled, changes, prefix);
  ensureFeatureSwitches(settings, changes, prefix);

  if (disableQA) {
    setSwitchMissing(settings, 'qa.auto_reply', false, changes, prefix);
  }

  if (disableLolQuery) {
    for (const featureKey of Object.values(LOL_FEATURE_KEYS)) {
      setSwitchMissing(settings, featureKey, false, changes, prefix);
    }
  }

  const lolSwitch = settings.lolQueryCommandSwitch;
  if (lolSwitch && typeof lolSwitch === 'object' && !Array.isArray(lolSwitch)) {
    for (const [legacyKey, featureKey] of Object.entries(LOL_FEATURE_KEYS)) {
      if (lolSwitch[legacyKey] === false) {
        setSwitchMissing(settings, featureKey, false, changes, prefix);
      }
    }
  }

  return changes;
}

function migrateConfig(config) {
  const changes = [];
  if (!config.global || typeof config.global !== 'object' || Array.isArray(config.global)) {
    config.global = {};
    changes.push('global');
  }
  changes.push(...migrateSettings(config.global, 'global'));

  if (config.groups && typeof config.groups === 'object' && !Array.isArray(config.groups)) {
    for (const [groupId, groupSettings] of Object.entries(config.groups)) {
      changes.push(...migrateSettings(groupSettings, `groups["${groupId}"]`));
    }
  }
  return changes;
}

function getTriggerValues(command) {
  const values = [];
  if (command?.trigger && typeof command.trigger === 'object') {
    if (typeof command.trigger.value === 'string') values.push(command.trigger.value);
  }
  if (Array.isArray(command?.triggers)) {
    for (const item of command.triggers) {
      if (typeof item === 'string') values.push(item);
      if (item && typeof item === 'object' && typeof item.value === 'string') values.push(item.value);
    }
  }
  if (typeof command?.trigger === 'string') values.push(command.trigger);
  if (typeof command?.command === 'string') values.push(command.command);
  return values.map((value) => value.trim()).filter(Boolean);
}

function inferCommandFeature(command) {
  const triggers = getTriggerValues(command);
  if (triggers.some((value) => value.includes('查封号'))) {
    return { featureType: 'query', featureKey: 'query.lol_ban', reason: 'trigger:查封号' };
  }
  if (triggers.some((value) => value.includes('查战绩'))) {
    return { featureType: 'query', featureKey: 'query.lol_battle', reason: 'trigger:查战绩' };
  }
  if (triggers.some((value) => value.includes('查隐藏'))) {
    return { featureType: 'query', featureKey: 'query.lol_hidden', reason: 'trigger:查隐藏' };
  }
  return {
    featureType: 'dynamic',
    featureKey: `dynamic.${String(command?.id || 'unknown').trim() || 'unknown'}`,
    reason: 'fallback',
  };
}

function migrateCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return { command, fields: [], inference: null };
  const next = { ...command };
  const fields = [];
  const inference = inferCommandFeature(command);
  const defaults = {
    featureType: inference.featureType,
    featureKey: inference.featureKey,
    scope: 'group',
    requiresLicense: true,
    permission: 'all',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (next[key] === undefined) {
      next[key] = value;
      fields.push(key);
    }
  }
  return {
    command: next,
    fields,
    inference: {
      id: String(command.id || ''),
      triggers: getTriggerValues(command),
      featureType: next.featureType,
      featureKey: next.featureKey,
      reason: inference.reason,
      addedFields: fields,
    },
  };
}

function migrateCommandsFile(commandsConfig) {
  if (Array.isArray(commandsConfig)) {
    const migrated = commandsConfig.map(migrateCommand);
    return {
      value: migrated.map((item) => item.command),
      report: migrated.map((item) => item.inference).filter(Boolean),
    };
  }
  if (commandsConfig && typeof commandsConfig === 'object') {
    const sourceCommands = Array.isArray(commandsConfig.commands) ? commandsConfig.commands : [];
    const migrated = sourceCommands.map(migrateCommand);
    return {
      value: { ...commandsConfig, commands: migrated.map((item) => item.command) },
      report: migrated.map((item) => item.inference).filter(Boolean),
    };
  }
  return { value: { version: '1', commands: [] }, report: [] };
}

async function migrateAccount(root, account, legacyCommandsConfig, migratedCommandsConfig, commandFeatureReport) {
  const accountDir = path.join(root, 'data', account);
  const configPath = path.join(accountDir, 'config.json');
  const dynamicCommandsPath = path.join(accountDir, 'dynamic-commands', 'commands.json');
  const result = {
    account,
    configPath,
    dynamicCommandsPath,
    configExists: false,
    configChanged: false,
    configBackupPath: '',
    dynamicCommandsChanged: false,
    dynamicCommandsBackupPath: '',
    addedFields: [],
    commandFeatures: commandFeatureReport,
  };

  if (await exists(configPath)) {
    result.configExists = true;
    const config = await readJson(configPath);
    result.addedFields = migrateConfig(config);
    if (result.addedFields.length) {
      result.configBackupPath = await writeJsonWithBackup(configPath, config, true);
      result.configChanged = true;
    }
  }

  if (legacyCommandsConfig) {
    result.dynamicCommandsBackupPath = await writeJsonWithBackup(dynamicCommandsPath, migratedCommandsConfig, true);
    result.dynamicCommandsChanged = true;
  }

  return result;
}

function printReport(root, legacyCommandsPath, results, legacyCommandsFound) {
  console.log(`SnowLuma GroupGuard config migration root: ${root}`);
  console.log(`Legacy dynamic commands: ${legacyCommandsFound ? legacyCommandsPath : `${legacyCommandsPath} (not found)`}`);
  for (const item of results) {
    console.log('');
    console.log(`[${item.account}]`);
    console.log(`config.json: ${item.configPath}${item.configExists ? '' : ' (not found)'}`);
    console.log(`config changed: ${item.configChanged ? 'yes' : 'no'}`);
    console.log(`config backup: ${item.configBackupPath || 'no'}`);
    console.log(`dynamic commands written: ${item.dynamicCommandsChanged ? item.dynamicCommandsPath : 'no legacy commands source'}`);
    console.log(`dynamic commands backup: ${item.dynamicCommandsBackupPath || 'no'}`);
    console.log(`runtime dynamic commands path: ${item.dynamicCommandsChanged || legacyCommandsFound ? item.dynamicCommandsPath : 'none'}`);
    console.log(`added fields: ${item.addedFields.length ? item.addedFields.join(', ') : 'none'}`);
  }
  console.log('');
  console.log('Dynamic command feature inference:');
  const featureLines = results[0]?.commandFeatures || [];
  if (!featureLines.length) {
    console.log('none');
  } else {
    for (const command of featureLines) {
      console.log(`- ${command.id || '(no id)'} => ${command.featureType}/${command.featureKey} (${command.reason}); added: ${command.addedFields.length ? command.addedFields.join(', ') : 'none'}`);
    }
  }
}

async function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const legacyCommandsPath = path.join(root, 'config', 'dynamic-commands', 'commands.json');
  let legacyCommandsConfig = null;
  let migratedCommandsConfig = null;
  let commandFeatureReport = [];
  const legacyCommandsFound = await exists(legacyCommandsPath);
  if (legacyCommandsFound) {
    legacyCommandsConfig = await readJson(legacyCommandsPath);
    const migrated = migrateCommandsFile(legacyCommandsConfig);
    migratedCommandsConfig = migrated.value;
    commandFeatureReport = migrated.report;
  }

  const results = [];
  for (const account of ACCOUNTS) {
    results.push(await migrateAccount(root, account, legacyCommandsConfig, migratedCommandsConfig, commandFeatureReport));
  }
  printReport(root, legacyCommandsPath, results, legacyCommandsFound);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
