import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const androidDir = path.join(root, 'android');
const googleServicesPath = path.join(androidDir, 'app', 'google-services.json');
const gradlePath = path.join(androidDir, 'app', 'build.gradle');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const mainActivityPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'MainActivity.java');
const billingPluginPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'PlayBillingPlugin.java');
const barcodePluginPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'InkboundBarcodeScannerPlugin.java');
const readingWidgetPluginPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'ReadingWidgetPlugin.java');
const loanReminderPluginPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'LoanReminderPlugin.java');
const loanReminderReceiverPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'LoanReminderReceiver.java');
const readingWidgetProviderPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'inkydameinteractive', 'inkbound', 'ReadingWidgetProvider.java');
const readingWidgetLayoutPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'layout', 'reading_widget.xml');
const readingWidgetInfoPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'xml', 'reading_widget_info.xml');
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

const readJavaProperties = (filePath) => {
  const properties = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.search(/[=:]/);
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim()
      .replace(/\\\\/g, '\\')
      .replace(/\\:/g, ':')
      .replace(/\\=/g, '=');
    properties[key] = value;
  }
  return properties;
};

const readKeystoreSha1 = (properties) => {
  const storeFileValue = properties.storeFile;
  const storePassword = properties.storePassword;
  const keyAlias = properties.keyAlias;
  if (!storeFileValue || !storePassword || !keyAlias) {
    fail('android/keystore.properties must define storeFile, storePassword, and keyAlias for release certificate verification.');
  }

  const storeFile = path.isAbsolute(storeFileValue)
    ? storeFileValue
    : path.resolve(androidDir, storeFileValue);

  if (!fs.existsSync(storeFile)) {
    fail(`release keystore does not exist at ${storeFile}.`);
  }

  const keytool = spawnSync('keytool', [
    '-list',
    '-v',
    '-keystore', storeFile,
    '-alias', keyAlias,
    '-storepass', storePassword,
  ], {
    encoding: 'utf8',
    shell: false,
  });

  if (keytool.error) {
    fail(`could not run keytool to inspect the release certificate: ${keytool.error.message}`);
  }
  if (keytool.status !== 0) {
    const details = (keytool.stderr || keytool.stdout || '').trim();
    fail(`keytool could not inspect the release certificate${details ? `: ${details}` : '.'}`);
  }

  const output = `${keytool.stdout ?? ''}\n${keytool.stderr ?? ''}`.replace(/\r\n?/g, '\n');
  const shaLine = output.split('\n').find((line) => /^\s*SHA1:\s*/i.test(line));
  const sha1 = normalizeSha1(shaLine?.replace(/^\s*SHA1:\s*/i, ''));

  if (!sha1 || sha1.length !== 40) {
    fail('keytool inspected the release certificate but did not return a valid SHA-1 fingerprint.');
  }

  return sha1;
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

  // Gradle/AGP signingReport formatting varies across Windows/JDK versions.
  // Normalize line endings, include stderr (some Gradle launchers route report
  // text there), and locate the exact release variant by lines instead of using
  // a fragile multiline regex boundary.
  const report = `${signingReport.stdout ?? ''}\n${signingReport.stderr ?? ''}`
    .replace(/\r\n?/g, '\n');
  const reportLines = report.split('\n');
  const releaseStart = reportLines.findIndex((line) => /^\s*Variant:\s*release\s*$/i.test(line));
  const releaseEnd = releaseStart >= 0
    ? reportLines.findIndex((line, index) => index > releaseStart && /^\s*Variant:\s*/i.test(line))
    : -1;
  const releaseLines = releaseStart >= 0
    ? reportLines.slice(releaseStart, releaseEnd >= 0 ? releaseEnd : reportLines.length)
    : [];
  if (releaseStart < 0) {
    fail('Gradle signingReport does not contain a release signing variant.');
  }

  const releaseShaLine = releaseLines.find((line) => /^\s*SHA1:\s*/i.test(line));
  const rawReleaseSha1 = releaseShaLine?.replace(/^\s*SHA1:\s*/i, '').trim() ?? '';
  let releaseSha1 = normalizeSha1(rawReleaseSha1);

  if (!releaseSha1 || releaseSha1.length !== 40) {
    // AGP 9.x can report the configured release keystore and alias without
    // printing certificate fingerprints. In that case verify the exact same
    // keystore directly with the JDK rather than treating a missing Gradle
    // display field as a missing certificate.
    const keystoreProperties = readJavaProperties(keystorePropertiesPath);
    releaseSha1 = readKeystoreSha1(keystoreProperties);
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
if (!fs.existsSync(loanReminderPluginPath) || !fs.existsSync(loanReminderReceiverPath)) {
  fail('Android library-loan reminder native files are missing.');
}
const loanReminderPlugin = fs.readFileSync(loanReminderPluginPath, 'utf8');
const loanReminderReceiver = fs.readFileSync(loanReminderReceiverPath, 'utf8');
for (const required of ['wasDelivered', 'EXTRA_BOOK_ID', 'EXTRA_DUE_DATE', 'EXTRA_KIND', 'cancelVisibleNotifications']) {
  if (!loanReminderPlugin.includes(required)) fail(`LoanReminderPlugin.java is missing idempotent reminder guard ${required}.`);
}
if (loanReminderPlugin.includes('now + 3000L')) {
  fail('LoanReminderPlugin.java must not replay missed due-today reminders after app open, sync, or upgrade.');
}
if (!loanReminderPlugin.includes('if (triggerAt <= now) return;')) {
  fail('LoanReminderPlugin.java must drop reminders whose intended delivery time has already passed.');
}
for (const required of ['markDelivered', 'deliveryKey', 'getSharedPreferences', 'bookId == null || dueDate == null || kind == null']) {
  if (!loanReminderReceiver.includes(required)) fail(`LoanReminderReceiver.java is missing persistent delivery guard ${required}.`);
}
if (!fs.readFileSync(mainActivityPath, 'utf8').includes('registerPlugin(LoanReminderPlugin.class)')) {
  fail('MainActivity does not register LoanReminderPlugin.');
}

if (!fs.existsSync(barcodePluginPath)) {
  fail('InkboundBarcodeScannerPlugin.java is missing. Android ISBN scanning cannot use the native fallback.');
}
const barcodePlugin = fs.readFileSync(barcodePluginPath, 'utf8');
for (const required of ['GmsBarcodeScanning.getClient', 'FORMAT_EAN_13', 'FORMAT_UPC_A', 'enableAutoZoom']) {
  if (!barcodePlugin.includes(required)) fail(`InkboundBarcodeScannerPlugin.java is missing ${required}.`);
}
if (!fs.readFileSync(mainActivityPath, 'utf8').includes('registerPlugin(InkboundBarcodeScannerPlugin.class)')) {
  fail('MainActivity does not register InkboundBarcodeScannerPlugin.');
}
const gradleSource = fs.readFileSync(gradlePath, 'utf8');
if (!gradleSource.includes('com.google.android.gms:play-services-code-scanner:16.1.0')) {
  fail('Google Play code scanner 16.1.0 is not wired into the Android app.');
}

for (const [filePath, label] of [
  [readingWidgetPluginPath, 'ReadingWidgetPlugin.java'],
  [readingWidgetProviderPath, 'ReadingWidgetProvider.java'],
  [readingWidgetLayoutPath, 'reading_widget.xml'],
  [readingWidgetInfoPath, 'reading_widget_info.xml'],
]) {
  if (!fs.existsSync(filePath)) fail(`${label} is missing. Android home-screen reading widget support is incomplete.`);
}
const readingWidgetPlugin = fs.readFileSync(readingWidgetPluginPath, 'utf8');
for (const required of ['syncState', 'consumeAction', 'PENDING_ACTION', 'refreshWidgets']) {
  if (!readingWidgetPlugin.includes(required)) fail(`ReadingWidgetPlugin.java is missing ${required}.`);
}
const readingWidgetProvider = fs.readFileSync(readingWidgetProviderPath, 'utf8');
for (const required of ['setChronometer', '"start"', '"resume"', '"pause"', '"stop"', 'MainActivity.class']) {
  if (!readingWidgetProvider.includes(required)) fail(`ReadingWidgetProvider.java is missing ${required}.`);
}
const mainActivitySource = fs.readFileSync(mainActivityPath, 'utf8');
if (!mainActivitySource.includes('registerPlugin(ReadingWidgetPlugin.class)') || !mainActivitySource.includes('handleReadingWidgetIntent')) {
  fail('MainActivity must register ReadingWidgetPlugin and route widget actions through the canonical app runtime.');
}

if (!fs.existsSync(manifestPath)) {
  fail('AndroidManifest.xml is missing.');
}
const manifestSource = fs.readFileSync(manifestPath, 'utf8');
if (!manifestSource.includes('android.permission.CAMERA')) {
  fail('AndroidManifest.xml must declare android.permission.CAMERA for the ISBN/stack scanner.');
}
if (!manifestSource.includes('.ReadingWidgetProvider') || !manifestSource.includes('@xml/reading_widget_info')) {
  fail('AndroidManifest.xml must register ReadingWidgetProvider with reading_widget_info metadata.');
}
for (const feature of [
  'android.hardware.camera.any',
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.flash',
]) {
  const escapedFeature = feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const optionalFeaturePattern = new RegExp(
    `<uses-feature\\s+[^>]*android:name=["']${escapedFeature}["'][^>]*android:required=["']false["'][^>]*/?>|<uses-feature\\s+[^>]*android:required=["']false["'][^>]*android:name=["']${escapedFeature}["'][^>]*/?>`,
    'i',
  );
  if (!optionalFeaturePattern.test(manifestSource)) {
    fail(`AndroidManifest.xml must mark ${feature} as android:required="false" so the optional scanner does not reduce Play device compatibility.`);
  }
}

console.log(`Inkbound Android Firebase configuration verified for ${expectedPackage} (${services.project_info.project_id}).`);
console.log(`Inkbound Android Google OAuth configuration verified (${androidOauthClients.length} Android certificate client${androidOauthClients.length === 1 ? '' : 's'}, ${webOauthClients.length} web client${webOauthClients.length === 1 ? '' : 's'}).`);
console.log('Inkbound Google Play Billing native wiring verified.');
console.log('Inkbound Android native barcode scanner, camera permission, and optional hardware compatibility verified.');
console.log('Inkbound Android library-loan notification idempotency and legacy-alarm suppression verified.');
console.log('Inkbound Android reading home-screen widget wiring verified.');
console.log('Release checks still require the Play Console subscription product/base plans and server API access to be configured.');
