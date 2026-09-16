import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const googleServicesPath = path.join(root, 'android', 'app', 'google-services.json');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const mainActivityPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'MainActivity.java');
const billingPluginPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'PlayBillingPlugin.java');
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

// Google sign-in on Android is not configured by the web OAuth client alone.
// The downloaded Firebase Android config must contain an Android OAuth client
// tied to Inkbound's package/SHA-1, plus a web OAuth client used as the server
// client ID. Without these, browser Google sign-in can work perfectly while the
// installed Android app fails before Firebase JS Auth ever receives a credential.
const oauthClients = Array.isArray(matchingClient?.oauth_client) ? matchingClient.oauth_client : [];
const androidOauthClients = oauthClients.filter((client) =>
  client?.client_type === 1
  && client?.android_info?.package_name === expectedPackage
  && typeof client?.android_info?.certificate_hash === 'string'
  && client.android_info.certificate_hash.trim().length > 0,
);
const webOauthClients = oauthClients.filter((client) => client?.client_type === 3 && client?.client_id);

if (androidOauthClients.length === 0) {
  fail(`google-services.json is missing an Android Google OAuth client for ${expectedPackage}. Add the SHA-1 fingerprint for the certificate signing this build in Firebase, then download a fresh google-services.json.`);
}
if (webOauthClients.length === 0) {
  fail('google-services.json is missing the Google web OAuth client required to issue Android ID tokens. Re-download google-services.json after enabling Google sign-in in Firebase Authentication.');
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

console.log(`Inkbound Android Firebase configuration verified for ${expectedPackage} (${services.project_info.project_id}).`);
console.log(`Inkbound Android Google OAuth configuration verified (${androidOauthClients.length} Android certificate client${androidOauthClients.length === 1 ? '' : 's'}, ${webOauthClients.length} web client${webOauthClients.length === 1 ? '' : 's'}).`);
console.log('Inkbound Google Play Billing native wiring verified.');
console.log('Release checks still require the Play Console subscription product/base plans and server API access to be configured.');
