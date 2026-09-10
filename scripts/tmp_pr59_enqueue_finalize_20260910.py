from pathlib import Path

queue_path = Path('onebot-plugin-groupguard/src/services/action_queue_service.ts')
q = queue_path.read_text(encoding='utf-8')

old = """    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') resolve({ ok: false, code: mapEnqueueFailureCode(enqueueResult) });
  });
}

export async function enqueueBanAction(opts: {
"""
new = """    const enqueueResult = enqueueTask(task);
    if (enqueueResult !== 'ok') {
      const code = mapEnqueueFailureCode(enqueueResult);
      const retryableAdmissionFailure = code === 'backpressure_reject' || code === 'skip_queue_overflow';
      const retryAfter = retryableAdmissionFailure ? computeSelfRecallRetryDelayMs(1) : 0;
      void groupguardRepository.resolveSelfRecallTask(taskId, code, !retryableAdmissionFailure, retryAfter).catch((error) => {
        loggingStateService.debug(`[ActionQueue] self_recall_enqueue_result_write_failed task=${taskId} ${String(error)}`);
      });
      resolve({ ok: false, code });
    }
  });
}

export async function enqueueBanAction(opts: {
"""
if q.count(old) != 1:
    raise SystemExit(f'enqueue self-recall marker mismatch: {q.count(old)}')
q = q.replace(old, new, 1)

old_catch = """  } catch (e) {
    if (task.type === 'recall') {
      await groupguardRepository.resolveRecallTask(task.payload.taskId, 'exception', false, 0);
    }
    appendQueueLog(`${task.type} ${taskSubject(task)} exception`);
"""
new_catch = """  } catch (e) {
    if (task.type === 'recall') {
      await groupguardRepository.resolveRecallTask(task.payload.taskId, 'exception', false, 0);
    } else if (task.type === 'self_recall') {
      await groupguardRepository.resolveSelfRecallTask(task.payload.taskId, 'exception', false, computeSelfRecallRetryDelayMs(task.retries + 1));
    }
    appendQueueLog(`${task.type} ${taskSubject(task)} exception`);
"""
if q.count(old_catch) != 1:
    raise SystemExit(f'execute catch marker mismatch: {q.count(old_catch)}')
q = q.replace(old_catch, new_catch, 1)
queue_path.write_text(q, encoding='utf-8')

test_path = Path('onebot-plugin-groupguard/scripts/test_per_group_self_recall_contract.mjs')
t = test_path.read_text(encoding='utf-8')
marker = "assert.match(queue, /resolveSelfRecallTask\\(task\\.payload\\.taskId, 'skip_rate_limited', false, retryAfter\\)/, 'self-recall rate limit must persist retry state');\n"
addition = marker + "assert.match(queue, /retryableAdmissionFailure = code === 'backpressure_reject' \\|\\| code === 'skip_queue_overflow'/, 'self-recall admission pressure must persist a delayed retry');\nassert.match(queue, /self_recall_enqueue_result_write_failed/, 'self-recall admission outcome persistence must be observable');\nassert.match(queue, /task\\.type === 'self_recall'[\\s\\S]*resolveSelfRecallTask\\(task\\.payload\\.taskId, 'exception'/, 'self-recall worker exceptions must update durable state');\n"
if t.count(marker) != 1:
    raise SystemExit('test insertion marker mismatch')
t = t.replace(marker, addition, 1)
test_path.write_text(t, encoding='utf-8')

pit_path = Path('docs/PITFALLS.md')
p = pit_path.read_text(encoding='utf-8')
needle = "- Ensure dedup/rate-limit outcomes for durable tasks update their persistent row.\n"
replacement = needle + "- Admission failures before worker execution must also update durable state: transient queue pressure gets a delayed retry, while terminal admission rejection must not remain immediately due forever.\n"
if p.count(needle) != 1:
    raise SystemExit('pitfalls marker mismatch')
p = p.replace(needle, replacement, 1)
pit_path.write_text(p, encoding='utf-8')

print('durable self-recall admission patch applied')
