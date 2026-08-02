import { NormalizingOneBotActionClient } from '../protocol/onebot11/action_client';
import type { OneBotWsClient } from './onebot_ws_client';

export class OneBotActionCaller extends NormalizingOneBotActionClient {
  constructor(client: OneBotWsClient) {
    super((action, params) => client.call(action, params));
  }
}
