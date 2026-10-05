import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const source = path.join(root, 'assets', 'branding', 'master', 'inkbound-master-icon-1024.png');
const targetDir = path.join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

if (process.platform !== 'darwin') {
  console.error('Inkbound iOS branding sync must run on macOS because it uses sips.');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error('Inkbound iOS branding sync failed: master 1024 icon is missing.');
  process.exit(1);
}
if (!fs.existsSync(targetDir)) {
  console.error('Inkbound iOS branding sync failed: iOS AppIcon.appiconset is missing. Run npm run ios:bootstrap first.');
  process.exit(1);
}

const specs = [
  ['iphone', '20x20', '2x', 40, 'Icon-App-20x20@2x.png'],
  ['iphone', '20x20', '3x', 60, 'Icon-App-20x20@3x.png'],
  ['iphone', '29x29', '2x', 58, 'Icon-App-29x29@2x.png'],
  ['iphone', '29x29', '3x', 87, 'Icon-App-29x29@3x.png'],
  ['iphone', '40x40', '2x', 80, 'Icon-App-40x40@2x.png'],
  ['iphone', '40x40', '3x', 120, 'Icon-App-40x40@3x.png'],
  ['iphone', '60x60', '2x', 120, 'Icon-App-60x60@2x.png'],
  ['iphone', '60x60', '3x', 180, 'Icon-App-60x60@3x.png'],
  ['ipad', '20x20', '1x', 20, 'Icon-App-20x20@1x.png'],
  ['ipad', '20x20', '2x', 40, 'Icon-App-20x20@2x-ipad.png'],
  ['ipad', '29x29', '1x', 29, 'Icon-App-29x29@1x.png'],
  ['ipad', '29x29', '2x', 58, 'Icon-App-29x29@2x-ipad.png'],
  ['ipad', '40x40', '1x', 40, 'Icon-App-40x40@1x.png'],
  ['ipad', '40x40', '2x', 80, 'Icon-App-40x40@2x-ipad.png'],
  ['ipad', '76x76', '1x', 76, 'Icon-App-76x76@1x.png'],
  ['ipad', '76x76', '2x', 152, 'Icon-App-76x76@2x.png'],
  ['ipad', '83.5x83.5', '2x', 167, 'Icon-App-83.5x83.5@2x.png'],
  ['ios-marketing', '1024x1024', '1x', 1024, 'Icon-App-1024x1024@1x.png'],
];

for (const [, , , pixels, filename] of specs) {
  const output = path.join(targetDir, filename);
  const result = spawnSync('sips', ['-z', String(pixels), String(pixels), source, '--out', output], {
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    console.error(`Inkbound iOS branding sync failed while creating ${filename}.`);
    process.exit(result.status ?? 1);
  }
}

const contents = {
  images: specs.map(([idiom, size, scale, , filename]) => ({
    idiom,
    size,
    scale,
    filename,
  })),
  info: { author: 'xcode', version: 1 },
};

fs.writeFileSync(path.join(targetDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
console.log('Inkbound iOS AppIcon asset catalog synchronized from assets/branding/master/inkbound-master-icon-1024.png.');
