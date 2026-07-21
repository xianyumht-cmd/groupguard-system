export type MessageScene =
  | 'raw_text'
  | 'action_success'
  | 'permission_denied'
  | 'command_format_error'
  | 'not_found'
  | 'feature_disabled';

export interface MessageCommand {
  channel: 'private' | 'group';
  targetId: string;
  scene: MessageScene;
  message: string;
  vars?: Record<string, string | number | boolean>;
}

export interface IMessagePort {
  send(command: MessageCommand): Promise<void>;
}
