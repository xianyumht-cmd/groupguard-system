import { adminCacheGateway } from './admin_cache_gateway';
import { cacheGateway } from './cache_gateway';
import { configGateway } from './config_gateway';
import { sessionGateway } from './session_gateway';

export class StateGateway {
  readonly config = configGateway;
  readonly sessions = sessionGateway;
  readonly cache = cacheGateway;
  readonly adminCache = adminCacheGateway;
}

export const stateGateway = new StateGateway();
