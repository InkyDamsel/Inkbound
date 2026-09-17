import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const functionsSource = path.join(root, 'functions', 'src');
const failures = [];
let callableCount = 0;
let nativeAuthBridgeCount = 0;

const normalizePath = (value) => value.split(path.sep).join('/');

/**
 * Return the first argument text for an onCall(...) invocation. We only need the
 * configuration argument, but declarations may span multiple lines. This scanner
 * deliberately tracks nesting and quoted strings so formatting changes do not
 * weaken the App Check release guard.
 */
function readFirstArgument(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openParenIndex + 1; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === '}' || char === ']') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      return source.slice(openParenIndex + 1, index).trim();
    }

    if (char === ',' && depth === 0) {
      return source.slice(openParenIndex + 1, index).trim();
    }
  }

  return source.slice(openParenIndex + 1).trim();
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function visit(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      return;
    }
    if (!entry.name.endsWith('.ts')) return;

    const source = fs.readFileSync(fullPath, 'utf8');
    const relativePath = normalizePath(path.relative(root, fullPath));
    const isNativeAuthBridge = relativePath === 'functions/src/nativeAuthBridge.ts';
    const matcher = /\bonCall\s*\(/g;
    let match;

    while ((match = matcher.exec(source)) !== null) {
      const lineStart = source.lastIndexOf('\n', match.index) + 1;
      const lineEnd = source.indexOf('\n', match.index);
      const invocationLine = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
      if (invocationLine.startsWith('import ')) continue;

      callableCount += 1;
      const openParenIndex = source.indexOf('(', match.index);
      const firstArgument = readFirstArgument(source, openParenIndex);
      const location = `${relativePath}:${lineNumberAt(source, match.index)}`;

      if (!/\benforceAppCheck\s*:/.test(firstArgument)) {
        failures.push(`${location} callable must explicitly configure enforceAppCheck`);
        continue;
      }

      if (isNativeAuthBridge) {
        nativeAuthBridgeCount += 1;
        if (!/\benforceAppCheck\s*:\s*false\b/.test(firstArgument)) {
          failures.push(`${location} native auth bootstrap must explicitly use enforceAppCheck: false because the pre-JS-session bridge cannot depend on Play Integrity.`);
        }
        if (!source.includes('verifyIdToken(nativeIdToken, true)') || !source.includes('createCustomToken(decoded.uid)')) {
          failures.push(`${location} native auth bootstrap must verify the native Firebase ID token with revocation checking and mint only the verified UID.`);
        }
        continue;
      }

      if (/\benforceAppCheck\s*:\s*false\b/.test(firstArgument)) {
        failures.push(`${location} is not allowed to disable App Check. Only the native auth bootstrap bridge may do so.`);
      }
    }
  });
}

visit(functionsSource);

if (callableCount === 0) {
  failures.push('No Firebase callable functions were found; security verification cannot confirm the callable boundary.');
}
if (nativeAuthBridgeCount !== 1) {
  failures.push(`Expected exactly one native auth bootstrap callable, found ${nativeAuthBridgeCount}.`);
}

if (failures.length > 0) {
  console.error('Inkbound function security verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Inkbound function security verified (${callableCount} callables; exactly one token-verified native auth bootstrap exception).`);
