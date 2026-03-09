import type { GroupGuardSettings, ReplyPersona, ReplySceneTemplateMap } from './types';
import { PERSONA_LIST } from './reply_templates';

export type TemplateAuditSeverity = 'high' | 'medium' | 'low';

export interface TemplateAuditIssue {
  severity: TemplateAuditSeverity;
  type: string;
  scope: 'builtin' | 'custom' | 'merge' | 'mapping';
  scene?: string;
  persona?: string;
  message: string;
  detail?: Record<string, any>;
}

export interface TemplateAuditReport {
  issueCount: { high: number; medium: number; low: number; total: number; };
  issues: TemplateAuditIssue[];
}

const PERSONA_SET = new Set<string>(PERSONA_LIST);

function normalizeTemplateText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9{}]+/g, '')
    .trim();
}

function pushIssue(issues: TemplateAuditIssue[], item: TemplateAuditIssue): void {
  issues.push(item);
}

function analyzeMap(
  map: ReplySceneTemplateMap | undefined,
  scope: 'builtin' | 'custom',
  issues: TemplateAuditIssue[]
): void {
  if (!map || typeof map !== 'object') return;
  for (const [scene, entry] of Object.entries(map)) {
    const personaTemplates = (entry as any)?.personaTemplates;
    if (!personaTemplates || typeof personaTemplates !== 'object') {
      pushIssue(issues, {
        severity: 'medium',
        type: 'missing_persona_templates',
        scope,
        scene,
        message: 'scene 缺少 personaTemplates 对象'
      });
      continue;
    }

    const sceneTemplateOwners = new Map<string, string[]>();
    const sceneNormalizedOwners = new Map<string, string[]>();

    for (const [persona, list] of Object.entries(personaTemplates as Record<string, unknown>)) {
      if (!PERSONA_SET.has(persona)) {
        pushIssue(issues, {
          severity: 'high',
          type: 'invalid_persona_key',
          scope,
          scene,
          persona,
          message: '存在未定义的人格 key',
          detail: { validPersonas: PERSONA_LIST }
        });
      }
      if (!Array.isArray(list)) {
        pushIssue(issues, {
          severity: 'high',
          type: 'invalid_template_list',
          scope,
          scene,
          persona,
          message: 'personaTemplates 必须是字符串数组'
        });
        continue;
      }
      const exactMap = new Map<string, number>();
      const normMap = new Map<string, number>();
      for (const raw of list) {
        const text = String(raw ?? '');
        exactMap.set(text, (exactMap.get(text) || 0) + 1);
        const norm = normalizeTemplateText(text);
        if (norm) normMap.set(norm, (normMap.get(norm) || 0) + 1);

        if (text) {
          const owners = sceneTemplateOwners.get(text) || [];
          owners.push(persona);
          sceneTemplateOwners.set(text, owners);
        }
        if (norm) {
          const owners = sceneNormalizedOwners.get(norm) || [];
          owners.push(persona);
          sceneNormalizedOwners.set(norm, owners);
        }
      }

      const exactDup = Array.from(exactMap.entries()).filter(([, c]) => c > 1);
      if (exactDup.length) {
        pushIssue(issues, {
          severity: 'medium',
          type: 'duplicate_templates_exact',
          scope,
          scene,
          persona,
          message: '同一 persona 下存在完全重复模板',
          detail: { duplicates: exactDup.slice(0, 8) }
        });
      }
      const normDup = Array.from(normMap.entries()).filter(([, c]) => c > 1);
      if (normDup.length) {
        pushIssue(issues, {
          severity: 'low',
          type: 'duplicate_templates_normalized',
          scope,
          scene,
          persona,
          message: '同一 persona 下存在语义近似重复模板',
          detail: { duplicates: normDup.slice(0, 8) }
        });
      }
    }

    const crossExact = Array.from(sceneTemplateOwners.entries())
      .filter(([, owners]) => new Set(owners).size >= 2)
      .slice(0, 8);
    if (crossExact.length) {
      pushIssue(issues, {
        severity: 'low',
        type: 'cross_persona_same_template',
        scope,
        scene,
        message: '同一 scene 不同 persona 存在完全相同模板',
        detail: { templates: crossExact.map(([tpl, owners]) => ({ template: tpl, personas: Array.from(new Set(owners)) })) }
      });
    }

    const crossNorm = Array.from(sceneNormalizedOwners.entries())
      .filter(([, owners]) => new Set(owners).size >= 2)
      .slice(0, 8);
    if (crossNorm.length) {
      pushIssue(issues, {
        severity: 'low',
        type: 'cross_persona_similar_template',
        scope,
        scene,
        message: '同一 scene 不同 persona 存在语义近似模板',
        detail: { items: crossNorm.map(([norm, owners]) => ({ norm, personas: Array.from(new Set(owners)) })) }
      });
    }
  }
}

export function auditReplyTemplates(
  builtinTemplates: ReplySceneTemplateMap,
  settings?: GroupGuardSettings
): TemplateAuditReport {
  const issues: TemplateAuditIssue[] = [];
  const custom = settings?.replySceneTemplates || {};

  analyzeMap(builtinTemplates, 'builtin', issues);
  analyzeMap(custom, 'custom', issues);

  for (const [scene, customEntry] of Object.entries(custom)) {
    if (!builtinTemplates[scene]) continue;
    const customPersonas = Object.keys((customEntry as any)?.personaTemplates || {});
    if (!customPersonas.includes('formal') || customPersonas.length < PERSONA_LIST.length) {
      pushIssue(issues, {
        severity: 'high',
        type: 'scene_override_coverage_risk',
        scope: 'merge',
        scene,
        message: '自定义 scene 覆盖内置 scene 时人格集合不完整，存在兜底退化风险',
        detail: { customPersonas, expected: PERSONA_LIST }
      });
    }
  }

  const personaByScene = settings?.replyPersonaByScene || {};
  for (const [scene, persona] of Object.entries(personaByScene)) {
    if (!PERSONA_SET.has(String(persona))) {
      pushIssue(issues, {
        severity: 'high',
        type: 'invalid_persona_mapping',
        scope: 'mapping',
        scene,
        persona: String(persona),
        message: 'replyPersonaByScene 指向未定义人格'
      });
    }
  }

  const issueCount = issues.reduce((acc, it) => {
    acc.total += 1;
    if (it.severity === 'high') acc.high += 1;
    if (it.severity === 'medium') acc.medium += 1;
    if (it.severity === 'low') acc.low += 1;
    return acc;
  }, { high: 0, medium: 0, low: 0, total: 0 });

  return { issueCount, issues };
}
