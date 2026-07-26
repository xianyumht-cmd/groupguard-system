#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(repositoryRoot, 'scripts', 'integration', 'verify-lolapisevers-contracts.mjs');
const cleanEndpointEnv = {
  LOL_API_BASE_URL: '',
  LANZOU_MONITOR_BASE_URL: '',
  GROUPGUARD_ADMIN_BASE_URL: '',
  GROUPGUARD_ADMIN_TOKEN: '',
  TEST_GROUP_ID: '',
  AUTHORIZED_TEST_GROUP_ID: ''
};

function invokeRunner(args) {
  const result = spawnSync(process.execPath, [runnerPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf-8',
    env: { ...process.env, ...cleanEndpointEnv }
  });
  if (result.error) throw result.error;
  return result;
}

function parseStdout(result) {
  assert.ok(result.stdout, `runner did not emit a report: ${result.stderr || 'no stderr'}`);
  return JSON.parse(result.stdout);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groupguard-contract-runner-'));
try {
  const safeMock = invokeRunner(['--mode', 'mock']);
  assert.equal(safeMock.status, 0, safeMock.stderr);
  const safeMockReport = parseStdout(safeMock);
  assert.equal(safeMockReport.overall_gate, 'partial');
  assert.equal(safeMockReport.summary.not_run, 1);
  assert.equal(
    safeMockReport.cases.find((item) => item.id === 'callback_idempotency_delivery')?.status,
    'not_run'
  );

  const deliveryMock = invokeRunner(['--mode', 'mock', '--allow-group-send']);
  assert.equal(deliveryMock.status, 0, deliveryMock.stderr);
  const deliveryMockReport = parseStdout(deliveryMock);
  assert.equal(deliveryMockReport.overall_gate, 'pass');
  assert.equal(deliveryMockReport.summary.failed, 0);
  assert.equal(deliveryMockReport.summary.not_run, 0);

  const missingConfigReportPath = path.join(tempDir, 'missing-live-config.json');
  const missingLiveConfig = invokeRunner([
    '--mode',
    'live',
    '--output',
    missingConfigReportPath
  ]);
  assert.equal(missingLiveConfig.status, 1);
  assert.equal(fs.existsSync(missingConfigReportPath), true, 'live configuration failure must still persist its report');
  const missingConfigReport = JSON.parse(fs.readFileSync(missingConfigReportPath, 'utf-8'));
  assert.equal(missingConfigReport.overall_gate, 'fail');
  assert.equal(missingConfigReport.summary.failed, 1);
  assert.equal(missingConfigReport.cases[0]?.id, 'runner_configuration');
  assert.equal(missingConfigReport.cases[0]?.status, 'fail');
  assert.match(missingConfigReport.cases[0]?.error || '', /LOL_API_BASE_URL/);
  assert.ok(missingConfigReport.finished_at);

  console.info('cross-repo contract runner regression passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
