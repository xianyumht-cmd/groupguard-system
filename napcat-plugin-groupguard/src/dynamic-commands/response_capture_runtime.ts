import { AsyncLocalStorage } from 'async_hooks';
import { GROUPGUARD_SEND_SCENE_KEY } from '../core/send_wrapper_constants';
import { loggingStateService } from '../core/state-services/logging_state_service';
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

function cloneSegment(segment: Record<string, unknown>): Record<string, unknown> {
  const data = segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)
    ? { ...(segment.data as Record<string, unknown>) }
    : segment.data;
  return { ...segment, data };
}

function attachSceneMetaToSegments(segments: Array<Record<string, unknown>>, scene: string): Array<Record<string, unknown>> {
  const normalizedScene = String(scene || '').trim();
  const cloned = segments.map(cloneSegment);
  if (!normalizedScene || normalizedScene === 'raw_text' || !cloned.length) return cloned;

  const target = cloned.find((segment) => segment && typeof segment === 'object' && segment.type === 'text') || cloned[0];
  const data = target.data && typeof target.data === 'object' && !Array.isArray(target.data)
    ? { ...(target.data as Record<string, unknown>) }
    : {};
  data[GROUPGUARD_SEND_SCENE_KEY] = normalizedScene;
  target.data = data;
  return cloned;
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
    loggingStateService.warn(`forward_send_direct source=response_capture_runtime group=${resolvedDelivery.targetId} scene=${resolvedDelivery.scene}`);
    await communicationStateService.callApi('send_group_forward_msg', {
      group_id: resolvedDelivery.targetId,
      messages: resolvedDelivery.forwardNodes
    });
    return;
  }
  if (resolvedDelivery.segments?.length) {
    await communicationStateService.sendGroupMsg(
      resolvedDelivery.targetId,
      attachSceneMetaToSegments(resolvedDelivery.segments, resolvedDelivery.scene) as any,
      {
        scene: resolvedDelivery.scene,
        force: resolvedDelivery.force ?? true,
        applyTemplate: resolvedDelivery.applyTemplate ?? true
      } as any
    );
    return;
  }
  await communicationStateService.sendGroupMsg(
    resolvedDelivery.targetId,
    attachSceneMetaToSegments([{ type: 'text', data: { text: resolvedDelivery.message || '' } }], resolvedDelivery.scene) as any,
    {
      scene: resolvedDelivery.scene,
      vars: resolvedDelivery.vars,
      force: resolvedDelivery.force ?? true,
      applyTemplate: resolvedDelivery.applyTemplate ?? true
    } as any
  );
}
