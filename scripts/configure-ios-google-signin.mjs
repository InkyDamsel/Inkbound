import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'ios', 'App', 'App');
const googleServicePath = path.join(appRoot, 'GoogleService-Info.plist');
const infoPlistPath = path.join(appRoot, 'Info.plist');

const fail = (message) => {
  console.error(`Inkbound iOS Google sign-in configuration failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(googleServicePath)) fail('GoogleService-Info.plist is missing.');
if (!fs.existsSync(infoPlistPath)) fail('Info.plist is missing.');

const googleService = fs.readFileSync(googleServicePath, 'utf8');
const infoPlist = fs.readFileSync(infoPlistPath, 'utf8');

const reversedMatch = googleService.match(
  /<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/,
);
if (!reversedMatch?.[1]) fail('REVERSED_CLIENT_ID is missing from GoogleService-Info.plist.');

const reversedClientId = reversedMatch[1].trim();

if (infoPlist.includes(`<string>${reversedClientId}</string>`)) {
  console.log(`Inkbound iOS Google sign-in URL scheme already configured: ${reversedClientId}`);
  process.exit(0);
}

const urlTypeBlock = [
  '\t<key>CFBundleURLTypes</key>',
  '\t<array>',
  '\t\t<dict>',
  '\t\t\t<key>CFBundleTypeRole</key>',
  '\t\t\t<string>Editor</string>',
  '\t\t\t<key>CFBundleURLSchemes</key>',
  '\t\t\t<array>',
  `\t\t\t\t<string>${reversedClientId}</string>`,
  '\t\t\t</array>',
  '\t\t</dict>',
  '\t</array>',
].join('\n');

const existingUrlTypes = infoPlist.match(
  /<key>CFBundleURLTypes<\/key>\s*<array>([\s\S]*?)<\/array>/,
);

let next = infoPlist;
if (existingUrlTypes) {
  const existingArray = existingUrlTypes[0];
  const insertion = [
    '\t\t<dict>',
    '\t\t\t<key>CFBundleTypeRole</key>',
    '\t\t\t<string>Editor</string>',
    '\t\t\t<key>CFBundleURLSchemes</key>',
    '\t\t\t<array>',
    `\t\t\t\t<string>${reversedClientId}</string>`,
    '\t\t\t</array>',
    '\t\t</dict>',
  ].join('\n');

  next = next.replace(
    existingArray,
    existingArray.replace(/<\/array>\s*$/, `${insertion}\n\t</array>`),
  );
} else {
  next = next.replace('</dict>', `${urlTypeBlock}\n</dict>`);
}

fs.writeFileSync(infoPlistPath, next);
console.log(`Inkbound iOS Google sign-in URL scheme configured: ${reversedClientId}`);
