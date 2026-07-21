export interface DomainResponseNotice {
  message: string;
  scene?: 'raw_text' | 'action_success' | 'permission_denied' | 'command_format_error' | 'list_empty' | 'not_found';
  vars?: Record<string, string | number | boolean>;
}
