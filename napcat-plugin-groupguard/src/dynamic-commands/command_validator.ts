import type { DynamicCommandDefinition, DynamicCommandErrorType } from './types';

export interface DynamicCommandValidationError {
  code: Extract<DynamicCommandErrorType, 'validation_error'>;
  message: string;
}

function isSafeDotPath(dotPath: string | undefined): boolean {
  if (!dotPath) return true;
  if (/[()]/.test(dotPath)) return false;
  if (!/^[a-zA-Z0-9_.$\[\]]+$/.test(dotPath)) return false;
  if (/\[[^\d\]]/.test(dotPath)) return false;
  if (/(^|\.)(?:__proto__|constructor|prototype)(\.|\[|$)/.test(dotPath)) return false;
  return true;
}

function looksLikeDotPath(candidate: string): boolean {
  return /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\[\d+\])*$/.test(candidate.trim());
}

function isSafeResponseSelector(selector: string | undefined): boolean {
  if (!selector) return true;
  if (selector.length > 2000) return false;
  if (!/[{}]/.test(selector)) return isSafeDotPath(selector);

  const matches = selector.matchAll(/\{([^{}]+)\}/g);
  let foundPlaceholder = false;
  for (const match of matches) {
    foundPlaceholder = true;
    const expression = String(match[1] || '').trim();
    if (!expression || expression.length > 300) return false;
    const choices = expression.split('|').map((item) => item.trim()).filter(Boolean);
    if (!choices.length) return false;
    for (const choice of choices) {
      if (/[(){}]/.test(choice)) return false;
      if (looksLikeDotPath(choice) && !isSafeDotPath(choice)) return false;
    }
  }
  return foundPlaceholder;
}

function hasValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateDynamicCommandDefinition(command: DynamicCommandDefinition): DynamicCommandValidationError[] {
  const errors: DynamicCommandValidationError[] = [];

  if (command.provider.type === 'http') {
    if (!hasValidHttpUrl(command.provider.url)) {
      errors.push({
        code: 'validation_error',
        message: `invalid_url:${command.id}`
      });
    }

    if (command.provider.timeoutMs !== undefined) {
      const timeout = Number(command.provider.timeoutMs);
      if (!Number.isFinite(timeout) || timeout < 100 || timeout > 10000) {
        errors.push({
          code: 'validation_error',
          message: `invalid_timeout:${command.id}`
        });
      }
    }
  }

  const responseSelector = command.response.template || command.response.textPath;
  if (!isSafeResponseSelector(responseSelector)) {
    errors.push({
      code: 'validation_error',
      message: `invalid_response_selector:${command.id}`
    });
  }

  const schemaNames = new Set([
    ...command.parameterSchema.required,
    ...command.parameterSchema.optional
  ]);

  for (const requiredName of command.parameterSchema.required) {
    if (!command.parameters?.[requiredName]) {
      errors.push({
        code: 'validation_error',
        message: `missing_required_parameter_mapping:${command.id}:${requiredName}`
      });
    }
  }

  for (const parameterName of Object.keys(command.parameters || {})) {
    if (!schemaNames.has(parameterName)) {
      errors.push({
        code: 'validation_error',
        message: `parameter_not_in_schema:${command.id}:${parameterName}`
      });
    }
  }

  return errors;
}
