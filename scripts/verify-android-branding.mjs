import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const sourceRoot = path.join(cwd, 'assets', 'branding', 'android', 'res');
const targetRoot = path.join(cwd, 'android', 'app', 'src', 'main', 'res');
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const launcherFiles = ['ic_launcher.png', 'ic_launcher_round.png'];
const failures = [];

const digest = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

for (const density of densities) {
  for (const fileName of launcherFiles) {
    const source = path.join(sourceRoot, `mipmap-${density}`, fileName);
    const target = path.join(targetRoot, `mipmap-${density}`, fileName);

    if (!fs.existsSync(source)) {
      failures.push(`approved branding source is missing: ${path.relative(cwd, source)}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      failures.push(`Android launcher resource is missing: ${path.relative(cwd, target)}`);
      continue;
    }
    if (digest(source) !== digest(target)) {
      failures.push(`Android launcher resource does not match approved Inkbound branding: ${path.relative(cwd, target)}`);
    }
  }
}

for (const fileName of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const adaptivePath = path.join(targetRoot, 'mipmap-anydpi-v26', fileName);
  if (fs.existsSync(adaptivePath)) {
    failures.push(`generic adaptive launcher override must not exist until Inkbound has authored adaptive layers: ${path.relative(cwd, adaptivePath)}`);
  }
}

const manifestPath = path.join(cwd, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  failures.push('AndroidManifest.xml is missing.');
} else {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!/android:icon=["']@mipmap\/ic_launcher["']/.test(manifest)) {
    failures.push('AndroidManifest.xml must use @mipmap/ic_launcher.');
  }
  if (!/android:roundIcon=["']@mipmap\/ic_launcher_round["']/.test(manifest)) {
    failures.push('AndroidManifest.xml must use @mipmap/ic_launcher_round.');
  }
}

if (failures.length > 0) {
  console.error('Inkbound Android branding verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error('Run npm run android:branding:sync, then verify again.');
  process.exit(1);
}

console.log('Inkbound Android launcher branding verified against the approved brand assets.');
