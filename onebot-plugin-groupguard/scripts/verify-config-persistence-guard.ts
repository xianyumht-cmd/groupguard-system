import assert from 'node:assert/strict';
import { selectGroupsForPersistence } from '../src/config_persistence_guard';

const persisted = {
  '10001': { useGlobal: false, qaList: [{ keyword: 'a', mode: 'exact', reply: 'b' }] },
  '10002': { useGlobal: false }
} as any;

const missingRuntime = selectGroupsForPersistence(undefined, persisted);
assert.equal(missingRuntime.preservedPersistedGroups, true);
assert.equal(missingRuntime.runtimeCount, 0);
assert.equal(missingRuntime.persistedCount, 2);
assert.deepEqual(missingRuntime.groups, persisted);

const emptyRuntime = selectGroupsForPersistence({}, persisted);
assert.equal(emptyRuntime.preservedPersistedGroups, true);
assert.deepEqual(emptyRuntime.groups, persisted);

const explicitRuntime = { '10003': { useGlobal: false } } as any;
const replacement = selectGroupsForPersistence(explicitRuntime, persisted);
assert.equal(replacement.preservedPersistedGroups, false);
assert.deepEqual(replacement.groups, explicitRuntime);

const bothEmpty = selectGroupsForPersistence({}, {});
assert.equal(bothEmpty.preservedPersistedGroups, false);
assert.deepEqual(bothEmpty.groups, {});

console.log('config persistence guard regression passed');
