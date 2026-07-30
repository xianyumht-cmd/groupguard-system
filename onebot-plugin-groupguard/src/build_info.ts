export interface GroupGuardBuildInfo {
  service: 'groupguard';
  version: string;
  commit_sha: string;
  build_time_utc: string;
  contract_version: string;
  config_schema_version: number;
  dirty: boolean | null;
  artifact: string;
}

declare const __GROUPGUARD_BUILD_INFO__: GroupGuardBuildInfo | undefined;

const DEVELOPMENT_BUILD_INFO: GroupGuardBuildInfo = {
  service: 'groupguard',
  version: process.env.GROUPGUARD_VERSION || '1.3.0',
  commit_sha: process.env.GROUPGUARD_COMMIT_SHA || 'unknown',
  build_time_utc: process.env.GROUPGUARD_BUILD_TIME_UTC || '',
  contract_version: 'groupguard-lol-api.v2',
  config_schema_version: 8,
  dirty: null,
  artifact: 'source'
};

export function getBuildInfo(): GroupGuardBuildInfo {
  const embedded = typeof __GROUPGUARD_BUILD_INFO__ !== 'undefined'
    ? __GROUPGUARD_BUILD_INFO__
    : DEVELOPMENT_BUILD_INFO;
  return { ...embedded };
}
