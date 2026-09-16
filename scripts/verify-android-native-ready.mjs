import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const googleServicesPath = path.join(root, 'android', 'app', 'google-services.json');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const mainActivityPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'MainActivity.java');
const billingPluginPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'PlayBillingPlugin.java');
const runtimeReadinessPath = path.join(root, 'src', 'platform', 'runtimeNativeReadiness.ts');
const expectedPackage = 'com.inkydameinteractive.inkbound';

const fail = (message) => {
  console.error(`Inkbound Android native readiness failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(googleServicesPath)) {
  fail('android/app/google-services.json is missing. Add the Firebase Android app configuration before native Firebase testing or release builds.');
}

let services;
try {
  services = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8'));
} catch {
  fail('android/app/google-services.json is not valid JSON.');
}

const clients = Array.isArray(services.client) ? services.client : [];
const matchingClient = clients.find((client) =>
  client?.client_info?.android_client_info?.package_name === expectedPackage,
);

if (!matchingClient) {
  fail(`google-services.json does not contain the Inkbound Android package ${expectedPackage}.`);
}

if (!services.project_info?.project_number || !services.project_info?.project_id) {
  fail('google-services.json is missing Firebase project metadata.');
}

if (!fs.existsSync(gradlePath) || !fs.readFileSync(gradlePath, 'utf8').includes('com.android.billingclient:billing:9.1.0')) {
  fail('Google Play Billing Library 9.1.0 is not wired into the Android app.');
}
if (!fs.existsSync(billingPluginPath)) {
  fail('PlayBillingPlugin.java is missing. Android cannot purchase or restore Premium.');
}
const billingPlugin = fs.readFileSync(billingPluginPath, 'utf8');
for (const required of ['queryProductDetailsAsync', 'launchBillingFlow', 'queryPurchasesAsync', 'acknowledgePurchase', 'setObfuscatedAccountId']) {
  if (!billingPlugin.includes(required)) fail(`PlayBillingPlugin.java is missing ${required}.`);
}
if (!fs.existsSync(mainActivityPath) || !fs.readFileSync(mainActivityPath, 'utf8').includes('registerPlugin(PlayBillingPlugin.class)')) {
  fail('MainActivity does not register PlayBillingPlugin.');
}

if (!fs.existsSync(runtimeReadinessPath)) {
  fail('runtimeNativeReadiness.ts is missing. Android startup cannot verify its native-service boundary.');
}
const runtimeReadiness = fs.readFileSync(runtimeReadinessPath, 'utf8');
if (!runtimeReadiness.includes('NATIVE_RUNTIME_FAIL_OPEN_MS')) {
  fail('Android native startup has no fail-open watchdog and could strand the app on the opening screen.');
}
if (!/markNativeRuntimeFailed[\s\S]*nativeRuntimeReady\s*=\s*true/.test(runtimeReadiness)) {
  fail('Android native startup failures do not release the application UI.');
}

console.log(`Inkbound Android Firebase configuration verified for ${expectedPackage} (${services.project_info.project_id}).`);
console.log('Inkbound Google Play Billing native wiring verified.');
console.log('Inkbound Android startup fail-open watchdog verified.');
console.log('Release checks still require the Play Console subscription product/base plans and server API access to be configured.');
