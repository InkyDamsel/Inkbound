import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const configPath = path.join(cwd, 'capacitor.config.json');
const mainPath = path.join(cwd, 'src/main.tsx');
const googleBooksPath = path.join(cwd, 'src/features/book-search/data/googleBooksApi.ts');
const runtimeSubscriptionPath = path.join(cwd, 'src/platform/runtimeSubscriptionManagement.ts');
const runtimePlatformPath = path.join(cwd, 'src/platform/runtimePlatform.ts');
const runtimeAuthenticationPath = path.join(cwd, 'src/platform/runtimeAuthentication.ts');
const runtimeReauthenticationPath = path.join(cwd, 'src/platform/runtimeReauthentication.ts');
const runtimeExportPath = path.join(cwd, 'src/platform/runtimeExport.ts');

const fail = (message) => {
  console.error(`Inkbound Android verification failed: ${message}`);
  process.exit(1);
};

for (const requiredPath of [
  configPath,
  mainPath,
  googleBooksPath,
  runtimePlatformPath,
  runtimeSubscriptionPath,
  runtimeAuthenticationPath,
  runtimeReauthenticationPath,
  runtimeExportPath,
]) {
  if (!fs.existsSync(requiredPath)) fail(`required Android boundary is missing: ${path.relative(cwd, requiredPath)}`);
}

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

const firebaseAuthentication = config.plugins?.FirebaseAuthentication;
if (firebaseAuthentication?.skipNativeAuth !== true) {
  fail('FirebaseAuthentication must keep skipNativeAuth enabled so the JS Firebase session remains authoritative.');
}
if (!Array.isArray(firebaseAuthentication?.providers) || !firebaseAuthentication.providers.includes('google.com')) {
  fail('FirebaseAuthentication must keep the native Google provider enabled.');
}

const mainSource = fs.readFileSync(mainPath, 'utf8');
if (!mainSource.includes("import.meta.env.PROD && !isNativeRuntime() && 'serviceWorker' in navigator")) {
  fail('PWA service workers must remain disabled inside the native Android WebView.');
}

const subscriptionSource = fs.readFileSync(runtimeSubscriptionPath, 'utf8');
if (!subscriptionSource.includes('!isNativeRuntime() && Boolean(webBillingPortalUrl)')) {
  fail('native builds must not fall back to the web billing portal.');
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
if (!googleBooksSource.includes('if (isNativeRuntime())')) {
  fail('Google Books transport must keep a distinct native-safe request path.');
}

const androidDir = path.join(cwd, 'android');
if (fs.existsSync(androidDir)) {
  const variablesPath = path.join(androidDir, 'variables.gradle');
  if (!fs.existsSync(variablesPath)) fail('generated Android project is missing variables.gradle.');
  const variables = fs.readFileSync(variablesPath, 'utf8');
  if (!/minSdkVersion\s*=\s*24/.test(variables)) fail('generated Android minSdkVersion must remain 24.');
  if (!/compileSdkVersion\s*=\s*36/.test(variables)) fail('generated Android compileSdkVersion must remain 36.');
  if (!/targetSdkVersion\s*=\s*36/.test(variables)) fail('generated Android targetSdkVersion must remain 36.');

  const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
  if (!fs.existsSync(appGradlePath)) fail('generated Android app/build.gradle is missing.');
  const appGradle = fs.readFileSync(appGradlePath, 'utf8');
  if (!/applicationId\s+["']com\.inkydameinteractive\.inkbound["']/.test(appGradle)) {
    fail('generated Android applicationId must remain com.inkydameinteractive.inkbound.');
  }
}

console.log('Inkbound Android configuration verified (com.inkydameinteractive.inkbound, API 36 baseline).');
