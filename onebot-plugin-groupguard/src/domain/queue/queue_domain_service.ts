export interface QueueDomainService {
  buildResetSummary(input: { cleared: number; activeWorkers: number; }): string;
}

class DefaultQueueDomainService implements QueueDomainService {
  buildResetSummary(input: { cleared: number; activeWorkers: number; }): string {
    return `队列已重置，清理待执行任务 ${input.cleared} 条，当前执行中 ${input.activeWorkers} 条`;
  }
}

export const queueDomainService: QueueDomainService = new DefaultQueueDomainService();
