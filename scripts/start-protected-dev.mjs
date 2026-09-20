import { spawn } from 'node:child_process';
import path from 'node:path';

const viteBin = path.resolve('node_modules', 'vite', 'bin', 'vite.js');
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';

const child = spawn(
  process.execPath,
  [viteBin, '--port=3000', `--host=${host}`],
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      // Normal npm run dev must authenticate against the real Firebase Auth
      // project so existing Inkbound accounts can sign in locally. Firestore
      // writes/collection reads and Functions remain blocked by firebase.ts.
      VITE_FIREBASE_MODE: 'protected',
    },
  },
);

child.on('error', (error) => {
  console.error('Inkbound could not start protected DEV mode.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
