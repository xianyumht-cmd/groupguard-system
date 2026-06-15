import { AsyncLocalStorage } from 'async_hooks';
import { communicationStateService } from '../core/state-services/communication_state_service';
import {
  assertPluginRuntimeCaptureAllowed,
  assertResponseCaptureAllowed
} from './execution_guard';

export interface CapturedCommandDelivery {
  channel: 'group' | 'private';
  targetId: string;
  scene: string;
  message?: string;
  vars?: Record<string, string | number | boolean>;
  segments?: Array<Record<string, unknown>>;
  forwardNodes?: Array<Record<string, unknown>>;
  applyTemplate?: boolean;
  force?: boolean;
}

const responseCaptureStorage = new AsyncLocalStorage<CapturedCommandDelivery[]>();

export function captureCommandResponseDeliveries<T>(operation: () => Promise<T>): Promise<{ result: T; deliveries: CapturedCommandDelivery[]; }> {
  const deliveries: CapturedCommandDelivery[] = [];
  return responseCaptureStorage.run(deliveries, async () => ({
    result: await operation(),
    deliveries
  }));
}

export function pushCapturedCommandDelivery(delivery: CapturedCommandDelivery): boolean {
  const store = responseCaptureStorage.getStore();
  if (!store) return false;
  assertPluginRuntimeCaptureAllowed({
    channel: delivery.channel,
    targetId: delivery.targetId,
    scene: delivery.scene
  });
  store.push(delivery);
  return true;
}

export async function send(delivery: CapturedCommandDelivery): Promise<void> {
  if (pushCapturedCommandDelivery(delivery)) return;
  assertResponseCaptureAllowed({
    channel: delivery.channel,
    targetId: delivery.targetId,
    scene: delivery.scene
  });
  if (delivery.channel === 'private') {
    if (delivery.segments?.length) {
      await communicationStateService.sendPrivateMsg(delivery.targetId, delivery.segments as any, {
        scene: delivery.scene,
        force: delivery.force ?? true,
        applyTemplate: delivery.applyTemplate ?? true
      } as any);
      return;
    }
    await communicationStateService.sendPrivateMsg(delivery.targetId, delivery.message || '', {
      scene: delivery.scene,
      vars: delivery.vars,
      force: delivery.force ?? true,
      applyTemplate: delivery.applyTemplate ?? true
    });
    return;
  }
  if (delivery.forwardNodes?.length) {
    await communicationStateService.callApi('send_group_forward_msg', {
      group_id: delivery.targetId,
      messages: delivery.forwardNodes
    });
    return;
  }
  if (delivery.segments?.length) {
    await communicationStateService.sendGroupMsg(delivery.targetId, delivery.segments as any, {
      force: delivery.force ?? true,
      applyTemplate: delivery.applyTemplate ?? true
    } as any);
    return;
  }
  await communicationStateService.sendGroupText(delivery.targetId, delivery.message || '', {
    scene: delivery.scene,
    vars: delivery.vars,
    force: delivery.force ?? true,
    applyTemplate: delivery.applyTemplate ?? true
  });
}
