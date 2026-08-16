import { spawnSync } from 'node:child_process';

// Android must never bundle Inkbound's web-origin Google Books API key. Mobile
// catalog traffic goes through the authenticated/App-Check Cloud Function instead.
const env = {
  ...process.env,
  VITE_GOOGLE_BOOKS_API_KEY: '',
  VITE_RUNTIME_TARGET: 'android',
};

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Inkbound Android web bundle built without the web-only Google Books API key.');
