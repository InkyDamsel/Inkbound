import assert from 'node:assert/strict';
import {
  getRuntimePlatform,
  isAndroidRuntime,
  isNativeRuntime,
} from '../src/platform/runtimePlatform';
import {
  isFirebaseConfigured,
  missingFirebaseEnvironmentVariables,
} from '../src/lib/firebase';

// Node/tsx regression execution does not provide Vite's import.meta.env object.
// Importing browser/runtime modules must remain safe and must fail closed rather
// than crashing during module evaluation.
assert.equal(isNativeRuntime(), false);
assert.equal(isAndroidRuntime(), false);
assert.equal(getRuntimePlatform(), 'web');
assert.equal(isFirebaseConfigured, false);
assert.ok(missingFirebaseEnvironmentVariables.length > 0);

console.log('Inkbound runtime boundary regressions passed.');
