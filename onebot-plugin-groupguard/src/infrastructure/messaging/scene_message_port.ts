import { sendGroupScene, sendPrivateScene } from '../../commands/common';
import type { IMessagePort, MessageCommand } from '../../interfaces/message_port';

class SceneMessagePort implements IMessagePort {
  async send(command: MessageCommand): Promise<void> {
    if (command.channel === 'private') {
      await sendPrivateScene(command.targetId, command.scene, command.message, command.vars);
      return;
    }
    await sendGroupScene(command.targetId, command.scene, command.message, command.vars);
  }
}

export function createSceneMessagePort(): IMessagePort {
  return new SceneMessagePort();
}
