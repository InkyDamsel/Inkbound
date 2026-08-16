import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const configPath = path.join(cwd, 'capacitor.config.json');
const runtimeSubscriptionPath = path.join(cwd, 'src/platform/runtimeSubscriptionManagement.ts');
const runtimePlatformPath = path.join(cwd, 'src/platform/runtimePlatform.ts');

const fail = (message) => {
  console.error(`Inkbound Android verification failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(configPath)) fail('capacitor.config.json is missing.');
if (!fs.existsSync(runtimePlatformPath)) fail('the native runtime platform boundary is missing.');
if (!fs.existsSync(runtimeSubscriptionPath)) fail('the subscription platform boundary is missing.');

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  fail('capacitor.config.json is not valid JSON.');
}

if (config.appId !== 'com.inkydameinteractive.inkbound') {
  fail(`unexpected Android application ID: ${String(config.appId ?? '')}`);
}
if (config.appName !== 'Inkbound') fail('Capacitor appName must remain Inkbound.');
if (config.webDir !== 'dist') fail('Capacitor webDir must remain dist.');
if (config.android?.allowMixedContent !== false) fail('Android mixed-content access must remain disabled.');
if (config.android?.webContentsDebuggingEnabled !== false) {
  fail('Android WebView debugging must remain disabled in the release configuration.');
}

const subscriptionSource = fs.readFileSync(runtimeSubscriptionPath, 'utf8');
if (!subscriptionSource.includes('!isNativeRuntime() && Boolean(webBillingPortalUrl)')) {
  fail('native builds must not fall back to the web billing portal.');
}

console.log('Inkbound Android configuration verified (com.inkydameinteractive.inkbound).');
