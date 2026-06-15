import { getAllCircuitBreakerStates, getDynamicCommandHealthReport } from './command_engine';

export function isCommandHealthy(commandId: string): boolean {
  const report = getDynamicCommandHealthReport().find((item) => item.commandId === commandId);
  if (!report) return true;
  return report.status === 'healthy';
}

export function getCommandHealthReport() {
  const circuitStates = getAllCircuitBreakerStates();
  return getDynamicCommandHealthReport().map((item) => ({
    ...item,
    breakerDetails: circuitStates[item.commandId] || null
  }));
}
