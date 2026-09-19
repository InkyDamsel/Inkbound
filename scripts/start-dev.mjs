import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;

const children = new Set();
let shuttingDown = false;
let viteStarted = false;

function pipeChild(child) {
  children.add(child);
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', () => children.delete(child));
  return child;
}

function runOnce(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function startVite() {
  if (viteStarted || shuttingDown) return;
  viteStarted = true;
  console.log('\nInkbound DEV: Firebase is ready. Starting Vite at http://127.0.0.1:3000 ...\n');
  const vite = pipeChild(spawn(npmCommand, ['run', 'dev:web'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_FIREBASE_MODE: 'emulator',
    },
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  }));

  vite.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`Inkbound DEV: Vite exited with code ${code ?? 'unknown'}.`);
      shutdown('SIGTERM', code ?? 1);
    }
  });
}

function shutdown(signal = 'SIGTERM', exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nInkbound DEV: stopping local services...');
  for (const child of [...children]) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

try {
  console.log('Inkbound DEV: building local Firebase Functions...');
  await runOnce(npmCommand, ['run', 'functions:build']);

  console.log('\nInkbound DEV: starting local Firebase services...');
  const emulator = pipeChild(spawn(nodeCommand, ['scripts/start-firebase-emulators.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  }));

  let emulatorOutput = '';
  const inspectReady = (chunk) => {
    emulatorOutput += chunk.toString();
    if (
      emulatorOutput.includes('All emulators ready!')
      || emulatorOutput.includes('Emulator UI at http://127.0.0.1:4000')
    ) {
      startVite();
      emulatorOutput = '';
    } else if (emulatorOutput.length > 12000) {
      emulatorOutput = emulatorOutput.slice(-4000);
    }
  };
  emulator.stdout?.on('data', inspectReady);
  emulator.stderr?.on('data', inspectReady);

  emulator.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`Inkbound DEV: Firebase emulators exited with code ${code ?? 'unknown'}.`);
      shutdown('SIGTERM', code ?? 1);
    }
  });
} catch (error) {
  console.error('Inkbound DEV could not start.', error);
  shutdown('SIGTERM', 1);
}
