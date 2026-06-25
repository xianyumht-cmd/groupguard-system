import type { ReplyPersona, ReplySceneTemplateMap } from './types';

export const PERSONA_LIST: ReplyPersona[] = ['formal', 'friendly', 'strict', 'humor', 'professional', 'gentle'];

export const PERSONA_LABELS: Record<ReplyPersona, string> = {
  formal: '正式',
  friendly: '友好',
  strict: '严格',
  humor: '轻松',
  professional: '专业',
  gentle: '温和'
};

const RAW_ONLY = ['{raw}'];

function templates(prefixes: string[], suffixes: string[] = ['']): string[] {
  const set = new Set<string>();
  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      set.add(`${prefix}{raw}${suffix}`);
    }
  }
  return Array.from(set);
}

function neutralPersonaTemplates(): Record<ReplyPersona, string[]> {
  return {
    formal: templates(['', '提示：', '通知：']),
    friendly: templates(['', '小提示：', '提醒一下：']),
    strict: templates(['', '校验结果：', '操作反馈：']),
    humor: templates(['', '提示：', '这边提示：']),
    professional: templates(['', '系统提示：', '处理结果：']),
    gentle: templates(['', '温馨提示：', '轻轻提醒：'])
  };
}

const neutral = neutralPersonaTemplates();

export const BUILTIN_REPLY_SCENE_TEMPLATES: ReplySceneTemplateMap = {
  permission_denied: { personaTemplates: neutral },
  command_format_error: { personaTemplates: neutral },
  list_empty: { personaTemplates: neutral },
  not_found: { personaTemplates: neutral },
  feature_disabled: { personaTemplates: neutral },
  invalid_range: { personaTemplates: neutral },
  raw_text: {
    personaTemplates: {
      formal: RAW_ONLY,
      friendly: RAW_ONLY,
      strict: RAW_ONLY,
      humor: RAW_ONLY,
      professional: RAW_ONLY,
      gentle: RAW_ONLY
    }
  }
};

export function getBuiltinReplySceneTemplates(): ReplySceneTemplateMap {
  return BUILTIN_REPLY_SCENE_TEMPLATES;
}
