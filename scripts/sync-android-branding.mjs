import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const sourceRoot = path.join(cwd, 'assets', 'branding', 'android', 'res');
const targetRoot = path.join(cwd, 'android', 'app', 'src', 'main', 'res');
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const launcherFiles = ['ic_launcher.png', 'ic_launcher_round.png'];

const fail = (message) => {
  console.error(`Inkbound Android branding sync failed: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(sourceRoot)) fail('approved Android branding source is missing.');
if (!fs.existsSync(targetRoot)) fail('generated Android resource directory is missing. Run npm run android:bootstrap first.');

for (const density of densities) {
  const sourceDir = path.join(sourceRoot, `mipmap-${density}`);
  const targetDir = path.join(targetRoot, `mipmap-${density}`);
  if (!fs.existsSync(sourceDir)) fail(`missing approved branding density: mipmap-${density}.`);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const fileName of launcherFiles) {
    const source = path.join(sourceDir, fileName);
    const target = path.join(targetDir, fileName);
    if (!fs.existsSync(source)) fail(`missing approved launcher asset: ${path.relative(cwd, source)}.`);
    fs.copyFileSync(source, target);
  }
}

// The approved Inkbound artwork is currently maintained as complete launcher
// PNGs, not separately authored adaptive foreground/background layers. Remove
// Capacitor's generated adaptive-icon XML so Android cannot prefer the generic
// Capacitor foreground over the approved Inkbound launcher artwork on API 26+.
const adaptiveDir = path.join(targetRoot, 'mipmap-anydpi-v26');
for (const fileName of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const adaptivePath = path.join(adaptiveDir, fileName);
  if (fs.existsSync(adaptivePath)) fs.rmSync(adaptivePath);
}

console.log('Inkbound Android launcher branding synchronized from assets/branding/android/res.');
