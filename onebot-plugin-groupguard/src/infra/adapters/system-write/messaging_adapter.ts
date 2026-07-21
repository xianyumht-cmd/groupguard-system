import { sendGroupScene, sendPrivateScene } from '../../../commands/common';
import type { ISystemWriteMessagingPort } from '../../../app/use-cases/system/write/ports';
import type { SystemWriteScene } from '../../../app/use-cases/system/write/types';

export class MessagingAdapter implements ISystemWriteMessagingPort {
  async sendGroupScene(groupId: string, scene: SystemWriteScene, message: string, vars?: Record<string, string | number | boolean>): Promise<void> {
    await sendGroupScene(groupId, scene, message, vars);
  }

  async sendPrivateScene(userId: string, scene: SystemWriteScene, message: string, vars?: Record<string, string | number | boolean>): Promise<void> {
    await sendPrivateScene(userId, scene, message, vars);
  }

  async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}
