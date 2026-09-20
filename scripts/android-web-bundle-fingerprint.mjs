import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_INPUTS = [
  'src',
  'public',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'android-release.json',
];

const normalize = (value) => value.split(path.sep).join('/');

const collectFiles = (root, relative) => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];

  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      return entry.isDirectory() ? collectFiles(root, child) : [child];
    });
};

export function androidWebBundleFingerprint(root = process.cwd()) {
  const hash = crypto.createHash('sha256');
  const files = ROOT_INPUTS
    .flatMap((entry) => collectFiles(root, entry))
    .filter((file) => !file.includes('/node_modules/'))
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));

  files.forEach((file) => {
    hash.update(normalize(file));
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update('\0');
  });

  return hash.digest('hex');
}
