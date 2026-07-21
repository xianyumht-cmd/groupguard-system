import type { DomainResponseNotice } from '../domain/shared/response_notice';
import type { SystemWriteScene, SystemWriteUseCaseResult } from '../app/use-cases/system/write/types';

export interface SystemWritePresentationMessage {
  scene: SystemWriteScene;
  message: string;
  vars?: Record<string, string | number | boolean>;
}

export interface SystemWritePresentation {
  notices: DomainResponseNotice[];
  response: SystemWritePresentationMessage;
}

export function presentSystemWriteResult(result: SystemWriteUseCaseResult): SystemWritePresentation {
  return {
    notices: result.data?.before || [],
    response: {
      scene: result.data?.scene || 'raw_text',
      message: result.data?.message || result.error || '',
      vars: result.data?.vars
    }
  };
}
