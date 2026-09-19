import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const androidDir = path.join(root, 'android');
const googleServicesPath = path.join(androidDir, 'app', 'google-services.json');
const gradlePath = path.join(androidDir, 'app', 'build.gradle');
const mainActivityPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'MainActivity.java');
const billingPluginPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'PlayBillingPlugin.java');
const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');
const expectedPackage = 'com.inkydameinteractive.inkbound';

const fail = (message) => {
  console.error(`Inkbound Android native readiness failed: ${message}`);
  process.exit(1);
};

const normalizeSha1 = (value) => String(value ?? '')
  .replace(/[^0-9a-f]/gi, '')
  .toUpperCase();

const formatSha1 = (value) => normalizeSha1(value).match(/.{1,2}/g)?.join(':') ?? normalizeSha1(value);

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

// Existence of an Android OAuth client is not enough: it must match the
// certificate that signs THIS local release. Gradle may render fingerprint bytes
// with whitespace around separators on some Windows/JDK combinations, so parse
// the complete SHA1 line and normalize it instead of stopping at the first space.
if (fs.existsSync(keystorePropertiesPath)) {
  const windows = process.platform === 'win32';
  const signingReport = windows
    ? spawnSync('gradlew.bat', ['signingReport'], {
        cwd: androidDir,
        encoding: 'utf8',
        shell: true,
      })
    : spawnSync('./gradlew', ['signingReport'], {
        cwd: androidDir,
        encoding: 'utf8',
      });

  if (signingReport.status !== 0) {
    const details = (signingReport.stderr || signingReport.stdout || '').trim();
    fail(`could not read the Android signing report${details ? `: ${details}` : '.'}`);
  }

  const report = signingReport.stdout ?? '';
  const releaseSectionMatch = report.match(/Variant:\s*release\b[\s\S]*?(?=\nVariant:\s|\n----------|$)/i);
  const releaseSection = releaseSectionMatch?.[0] ?? '';
  const releaseShaLineMatch = /^SHA1:\s*(.+)$/im.exec(releaseSection);
  const releaseSha1 = normalizeSha1(releaseShaLineMatch?.[1]);

  if (!releaseSha1 || releaseSha1.length !== 40) {
    const rawShaLine = releaseShaLineMatch?.[1]?.trim() || '(missing)';
    fail(`the local release signing certificate SHA-1 could not be parsed from Gradle signingReport (raw SHA1 line: ${rawShaLine}).`);
  }

  const configuredSha1s = androidOauthClients
    .map((client) => normalizeSha1(client.android_info.certificate_hash))
    .filter((value) => value.length === 40);

  if (!configuredSha1s.includes(releaseSha1)) {
    fail(`google-services.json does not contain an OAuth client for the certificate signing this local release (${formatSha1(releaseSha1)}). Firebase currently contains: ${configuredSha1s.map(formatSha1).join(', ') || '(none)'}. Add the local release SHA-1 to the Firebase Android app, download a fresh google-services.json, then rebuild.`);
  }

  console.log(`Inkbound local release signing certificate verified for Google auth (${formatSha1(releaseSha1)}).`);
} else {
  console.log('Inkbound Android signing-certificate match not checked because android/keystore.properties is not present in this environment.');
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
