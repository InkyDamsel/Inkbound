import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const configPath = path.join(cwd, 'capacitor.config.json');
const releaseMetadataPath = path.join(cwd, 'android-release.json');
const mainPath = path.join(cwd, 'src/main.tsx');
const firebasePath = path.join(cwd, 'src/lib/firebase.ts');
const googleBooksPath = path.join(cwd, 'src/features/book-search/data/googleBooksApi.ts');
const runtimeSubscriptionPath = path.join(cwd, 'src/platform/runtimeSubscriptionManagement.ts');
const runtimePlatformPath = path.join(cwd, 'src/platform/runtimePlatform.ts');
const runtimeAuthenticationPath = path.join(cwd, 'src/platform/runtimeAuthentication.ts');
const runtimeReauthenticationPath = path.join(cwd, 'src/platform/runtimeReauthentication.ts');
const runtimeExportPath = path.join(cwd, 'src/platform/runtimeExport.ts');
const runtimeNativeAppCheckPath = path.join(cwd, 'src/platform/runtimeNativeAppCheck.ts');
const runtimeNativeReadinessPath = path.join(cwd, 'src/platform/runtimeNativeReadiness.ts');
const runtimeNativeSecurityBootstrapPath = path.join(cwd, 'src/platform/runtimeNativeSecurityBootstrap.ts');
const initializeAndroidRuntimePath = path.join(cwd, 'src/platform/initializeAndroidRuntime.ts');

const fail = (message) => {
  console.error(`Inkbound Android verification failed: ${message}`);
  process.exit(1);
};

for (const requiredPath of [
  configPath,
  releaseMetadataPath,
  mainPath,
  firebasePath,
  googleBooksPath,
  runtimePlatformPath,
  runtimeSubscriptionPath,
  runtimeAuthenticationPath,
  runtimeReauthenticationPath,
  runtimeExportPath,
  runtimeNativeAppCheckPath,
  runtimeNativeReadinessPath,
  runtimeNativeSecurityBootstrapPath,
  initializeAndroidRuntimePath,
]) {
  if (!fs.existsSync(requiredPath)) fail(`required Android boundary is missing: ${path.relative(cwd, requiredPath)}`);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
  fail('capacitor.config.json is not valid JSON.');
}

let releaseMetadata;
try {
  releaseMetadata = JSON.parse(fs.readFileSync(releaseMetadataPath, 'utf8'));
} catch {
  fail('android-release.json is not valid JSON.');
}
if (!Number.isInteger(releaseMetadata.versionCode) || releaseMetadata.versionCode < 1) {
  fail('android-release.json versionCode must be a positive integer.');
}
if (typeof releaseMetadata.versionName !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(releaseMetadata.versionName)) {
  fail('android-release.json versionName must use semantic version format.');
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

const firebaseAuthentication = config.plugins?.FirebaseAuthentication;
if (firebaseAuthentication?.skipNativeAuth !== true) {
  fail('FirebaseAuthentication must keep skipNativeAuth enabled so the JS Firebase session remains authoritative.');
}
if (!Array.isArray(firebaseAuthentication?.providers) || !firebaseAuthentication.providers.includes('google.com')) {
  fail('FirebaseAuthentication must keep the native Google provider enabled.');
}

const mainSource = fs.readFileSync(mainPath, 'utf8');
// No service-worker registration is the safest native configuration. If web PWA
// registration is added later, it must be explicitly excluded from native WebView.
const mentionsServiceWorker = mainSource.includes('serviceWorker');
const nativeGuardedServiceWorker = mainSource.includes("import.meta.env.PROD && !isNativeRuntime() && 'serviceWorker' in navigator");
if (mentionsServiceWorker && !nativeGuardedServiceWorker) {
  fail('PWA service workers must remain disabled inside the native Android WebView.');
}
if (!mainSource.includes('<NativeRuntimeGate>')) {
  fail('Android startup must gate account/security providers until native services are ready.');
}
if (!mainSource.includes('initializeAndroidRuntime().catch(markNativeRuntimeFailed)')) {
  fail('Android startup must initialize native services and surface initialization failures.');
}

const nativeReadinessSource = fs.readFileSync(runtimeNativeReadinessPath, 'utf8');
if (!nativeReadinessSource.includes('markNativeRuntimeReady')) {
  fail('native adapter bootstrap must retain an explicit readiness completion signal.');
}
if (!nativeReadinessSource.includes('markNativeRuntimeFailed')) {
  fail('native adapter bootstrap must surface startup failures instead of hanging indefinitely.');
}

const firebaseSource = fs.readFileSync(firebasePath, 'utf8');
if (!firebaseSource.includes('new CustomProvider')) {
  fail('Android Firebase App Check must use the JS CustomProvider bridge.');
}
if (!firebaseSource.includes('getNativeAppCheckToken')) {
  fail('Android Firebase App Check must obtain tokens from the native Play Integrity adapter.');
}
if (!firebaseSource.includes('export function initializeNativeFirebaseAppCheck()')) {
  fail('Android Firebase App Check must remain explicitly deferred until native Play Integrity is configured.');
}
if (!firebaseSource.includes('!useFirebaseEmulators && !isNativeRuntime() && appCheckSiteKey')) {
  fail('web reCAPTCHA App Check must remain excluded from native Android builds.');
}

const nativeAppCheckSource = fs.readFileSync(runtimeNativeAppCheckPath, 'utf8');
if (!nativeAppCheckSource.includes('configureNativeAppCheck')) {
  fail('the native Play Integrity App Check adapter registration point is missing.');
}
if (!nativeAppCheckSource.includes('expireTimeMillis')) {
  fail('native App Check tokens must include an explicit expiration time.');
}

const nativeSecurityBootstrapSource = fs.readFileSync(runtimeNativeSecurityBootstrapPath, 'utf8');
const configureIndex = nativeSecurityBootstrapSource.indexOf('configureNativeAppCheck(appCheckAdapter)');
const initializeIndex = nativeSecurityBootstrapSource.indexOf('initializeNativeFirebaseAppCheck()');
const readyIndex = nativeSecurityBootstrapSource.indexOf('markNativeRuntimeReady()');
if (configureIndex < 0 || initializeIndex < 0 || readyIndex < 0 || !(configureIndex < initializeIndex && initializeIndex < readyIndex)) {
  fail('Android security startup must remain ordered: configure Play Integrity, initialize JS App Check, then mark native runtime ready.');
}

const androidRuntimeSource = fs.readFileSync(initializeAndroidRuntimePath, 'utf8');
for (const requiredSnippet of [
  'FirebaseAppCheck.initialize',
  'FirebaseAuthentication.signInWithGoogle',
  'skipNativeAuth: true',
  'useCredentialManager: true',
  'signInWithCredential',
  'reauthenticateWithCredential',
  "CapacitorApp.addListener('appStateChange'",
  'initializeNativeSecurityRuntime',
]) {
  if (!androidRuntimeSource.includes(requiredSnippet)) {
    fail(`Android runtime adapter is missing required native integration: ${requiredSnippet}`);
  }
}
const authConfigIndex = androidRuntimeSource.indexOf('configureRuntimeAuthentication');
const reauthConfigIndex = androidRuntimeSource.indexOf('configureRuntimeReauthentication');
const lifecycleConfigIndex = androidRuntimeSource.indexOf('configureRuntimeLifecycle');
const securityReadyIndex = androidRuntimeSource.lastIndexOf('initializeNativeSecurityRuntime');
if ([authConfigIndex, reauthConfigIndex, lifecycleConfigIndex, securityReadyIndex].some((index) => index < 0)
  || !(authConfigIndex < securityReadyIndex && reauthConfigIndex < securityReadyIndex && lifecycleConfigIndex < securityReadyIndex)) {
  fail('Android runtime must configure auth, reauthentication, and lifecycle before releasing native readiness.');
}

const subscriptionSource = fs.readFileSync(runtimeSubscriptionPath, 'utf8');
if (!subscriptionSource.includes('isAvailable: () => !isNativeRuntime()')) {
  fail('browser subscription management must remain unavailable inside native builds.');
}
if (!subscriptionSource.includes("if (isNativeRuntime()) throw new Error('Subscription management is not connected to this app store build yet.')")) {
  fail('browser subscription management must fail closed if invoked from a native runtime.');
}
if (!androidRuntimeSource.includes('configureRuntimeSubscriptionManagement')) {
  fail('Android must install its native subscription-management adapter.');
}

const authenticationSource = fs.readFileSync(runtimeAuthenticationPath, 'utf8');
if (!authenticationSource.includes('isNativeRuntime()')) {
  fail('Google authentication must keep a native-safe boundary instead of browser popup fallback.');
}

const reauthenticationSource = fs.readFileSync(runtimeReauthenticationPath, 'utf8');
if (!reauthenticationSource.includes('nativeSafeReauthenticationAdapter')) {
  fail('security-sensitive reauthentication must fail closed until the native Android adapter is installed.');
}

const exportSource = fs.readFileSync(runtimeExportPath, 'utf8');
if (!exportSource.includes('nativeSafeExportAdapter')) {
  fail('native exports must not fall back to browser download behavior.');
}

const googleBooksSource = fs.readFileSync(googleBooksPath, 'utf8');
if (!googleBooksSource.includes("provider: 'google-books'")) {
  fail('Android Google Books traffic must stay behind the protected Firebase catalog gateway.');
}
if (!googleBooksSource.includes("httpsCallable<") || !googleBooksSource.includes("'searchHardcoverBooks'")) {
  fail('Google Books must retain the App Check-protected Firebase catalog transport used by Android.');
}
if (!googleBooksSource.includes('functions && auth?.currentUser')) {
  fail('signed-in catalog enrichment must prefer the protected Firebase transport before any web-only direct fallback.');
}

const androidDir = path.join(cwd, 'android');
if (fs.existsSync(androidDir)) {
  const variablesPath = path.join(androidDir, 'variables.gradle');
  if (!fs.existsSync(variablesPath)) fail('generated Android project is missing variables.gradle.');
  const variables = fs.readFileSync(variablesPath, 'utf8');
  if (!/minSdkVersion\s*=\s*24/.test(variables)) fail('generated Android minSdkVersion must remain 24.');
  if (!/compileSdkVersion\s*=\s*36/.test(variables)) fail('generated Android compileSdkVersion must remain 36.');
  if (!/targetSdkVersion\s*=\s*36/.test(variables)) fail('generated Android targetSdkVersion must remain 36.');
  if (!/rgcfaIncludeGoogle\s*=\s*true/.test(variables)) fail('native Google sign-in dependencies must remain enabled.');
  if (!/androidxCredentialsVersion\s*=\s*["']1\.3\.0["']/.test(variables)) {
    fail('native Google Credential Manager dependency baseline is missing.');
  }

  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) fail('generated Android main manifest is missing.');
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!/android:allowBackup=["']false["']/.test(manifest)) {
    fail('Android production backups must remain disabled for account-owned local data.');
  }
  if (!/android:usesCleartextTraffic=["']false["']/.test(manifest)) {
    fail('Android production cleartext traffic must remain disabled.');
  }

  const debugManifestPath = path.join(androidDir, 'app', 'src', 'debug', 'AndroidManifest.xml');
  if (!fs.existsSync(debugManifestPath)) fail('Android debug manifest is missing.');
  const debugManifest = fs.readFileSync(debugManifestPath, 'utf8');
  if (!/android:usesCleartextTraffic=["']true["']/.test(debugManifest)) {
    fail('Android debug builds must retain explicit HTTP support for local emulator/LAN development.');
  }

  const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
  if (!fs.existsSync(appGradlePath)) fail('generated Android app/build.gradle is missing.');
  const appGradle = fs.readFileSync(appGradlePath, 'utf8');
  if (!/applicationId\s+["']com\.inkydameinteractive\.inkbound["']/.test(appGradle)) {
    fail('generated Android applicationId must remain com.inkydameinteractive.inkbound.');
  }
  const versionCodeMatch = /versionCode\s+(\d+)/.exec(appGradle);
  const versionNameMatch = /versionName\s+["']([^"']+)["']/.exec(appGradle);
  if (Number(versionCodeMatch?.[1]) !== releaseMetadata.versionCode) {
    fail('generated Android versionCode does not match android-release.json.');
  }
  if (versionNameMatch?.[1] !== releaseMetadata.versionName) {
    fail('generated Android versionName does not match android-release.json.');
  }
}

console.log(`Inkbound Android configuration verified (com.inkydameinteractive.inkbound, ${releaseMetadata.versionName} (${releaseMetadata.versionCode}), API 36 baseline).`);
