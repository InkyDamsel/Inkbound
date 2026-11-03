import fs from 'node:fs';
import path from 'node:path';

// A clean App Store build must preserve the scanner implementation while
// excluding only its diagnostic UI. This operates on the actual compiled
// bundle that Capacitor will copy into the Xcode project.
const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error('iOS release blocked: dist/assets missing. Run build:ios first.');
  process.exit(1);
}
const jsFiles = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
const chunks = jsFiles.map((name) => ({ name, content: fs.readFileSync(path.join(assetsDir, name), 'utf8') }));
const bundle = chunks.map((chunk) => chunk.content).join('\n');
const forbidden = [
  '[Inkbound scanner] Cover identification failed',
  '[Inkbound scanner] ISBN lookup',
  'Scanner details',
  'Copy diagnostic report',
  'Check App Check',
  'Test diagnostics',
  'Provider trace:',
  'Scanner DEBUG bundle verified',
  'register its App Check debug token',
];
const violations = forbidden.flatMap((phrase) =>
  chunks.filter(({ content }) => content.includes(phrase)).map(({ name }) => `${phrase} in ${name}`));
const required = [
  'Scan as many as you want',
  'Start Scanner',
  'Cover text was detected',
  'Possible editions',
];
const missing = required.filter((phrase) => !bundle.includes(phrase));
if (jsFiles.length === 0 || violations.length || missing.length) {
  console.error('iOS App Store bundle blocked:');
  if (!jsFiles.length) console.error('- Compiled JS chunks were not found.');
  violations.forEach((violation) => console.error(`- Development diagnostics leaked: ${violation}`));
  missing.forEach((phrase) => console.error(`- Scanner UI missing: ${phrase}`));
  process.exit(1);
}
console.log('Inkbound clean iOS scanner bundle verified: scanner present, debug UI absent.');
