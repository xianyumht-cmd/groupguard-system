import type { DynamicCommandDefinition, DynamicCommandErrorType } from './types';

export interface DynamicCommandValidationError {
  code: Extract<DynamicCommandErrorType, 'validation_error'>;
  message: string;
}

function isSafeDotPath(dotPath: string | undefined): boolean {
  if (!dotPath) return true;
  if (/[()]/.test(dotPath)) return false;
  if (!/^[a-zA-Z0-9_.\[\]]+$/.test(dotPath)) return false;
  if (/\[[^\d\]]/.test(dotPath)) return false;
  return true;
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

  if (!isSafeDotPath(command.response.textPath)) {
    errors.push({
      code: 'validation_error',
      message: `invalid_dot_path:${command.id}`
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
