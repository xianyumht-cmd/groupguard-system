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
const forcedResponseSceneStorage = new AsyncLocalStorage<string>();

function resolveScene(scene: string): string {
  const forced = forcedResponseSceneStorage.getStore();
  if (forced && (!scene || scene === 'raw_text')) return forced;
  return scene || forced || 'raw_text';
}

export function runWithForcedResponseScene<T>(scene: string, operation: () => Promise<T>): Promise<T> {
  return forcedResponseSceneStorage.run(scene, operation);
}

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
  const resolvedDelivery = { ...delivery, scene: resolveScene(delivery.scene) };
  assertPluginRuntimeCaptureAllowed({
    channel: resolvedDelivery.channel,
    targetId: resolvedDelivery.targetId,
    scene: resolvedDelivery.scene
  });
  store.push(resolvedDelivery);
  return true;
}

export async function send(delivery: CapturedCommandDelivery): Promise<void> {
  const resolvedDelivery = { ...delivery, scene: resolveScene(delivery.scene) };
  if (pushCapturedCommandDelivery(resolvedDelivery)) return;
  assertResponseCaptureAllowed({
    channel: resolvedDelivery.channel,
    targetId: resolvedDelivery.targetId,
    scene: resolvedDelivery.scene
  });
  if (resolvedDelivery.channel === 'private') {
    if (resolvedDelivery.segments?.length) {
      await communicationStateService.sendPrivateMsg(resolvedDelivery.targetId, resolvedDelivery.segments as any, {
        scene: resolvedDelivery.scene,
        force: resolvedDelivery.force ?? true,
        applyTemplate: resolvedDelivery.applyTemplate ?? true
      } as any);
      return;
    }
    await communicationStateService.sendPrivateMsg(resolvedDelivery.targetId, resolvedDelivery.message || '', {
      scene: resolvedDelivery.scene,
      vars: resolvedDelivery.vars,
      force: resolvedDelivery.force ?? true,
      applyTemplate: resolvedDelivery.applyTemplate ?? true
    });
    return;
  }
  if (resolvedDelivery.forwardNodes?.length) {
    await communicationStateService.callApi('send_group_forward_msg', {
      group_id: resolvedDelivery.targetId,
      messages: resolvedDelivery.forwardNodes
    });
    return;
  }
  if (resolvedDelivery.segments?.length) {
    await communicationStateService.sendGroupMsg(resolvedDelivery.targetId, resolvedDelivery.segments as any, {
      scene: resolvedDelivery.scene,
      force: resolvedDelivery.force ?? true,
      applyTemplate: resolvedDelivery.applyTemplate ?? true
    } as any);
    return;
  }
  await communicationStateService.sendGroupText(resolvedDelivery.targetId, resolvedDelivery.message || '', {
    scene: resolvedDelivery.scene,
    vars: resolvedDelivery.vars,
    force: resolvedDelivery.force ?? true,
    applyTemplate: resolvedDelivery.applyTemplate ?? true
  });
}