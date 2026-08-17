import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const googleServicesPath = path.join(root, 'android', 'app', 'google-services.json');
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

console.log(`Inkbound Android Firebase configuration verified for ${expectedPackage} (${services.project_info.project_id}).`);
console.log('Next native checks: register SHA-1/SHA-256 fingerprints in Firebase, enable Google sign-in, and register Play Integrity in App Check.');
