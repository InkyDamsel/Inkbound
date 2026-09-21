import { spawn } from 'node:child_process';

const nodeCommand = process.execPath;
const npmExecPath = process.env.npm_execpath;
const requestedMode = process.argv.includes('--emulator') ? 'emulator' : 'production';
const useEmulators = requestedMode === 'emulator';


function npmInvocation(args) {
  if (process.platform === 'win32' && npmExecPath) {
    return { command: nodeCommand, args: [npmExecPath, ...args] };
  }
  return { command: 'npm', args };
}

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
  console.log(
    useEmulators
      ? '\nInkbound DEV: local Firebase is ready. Starting Vite at http://127.0.0.1:3000 ...\n'
      : '\nInkbound DEV: starting app-parity Vite against production Firebase at http://127.0.0.1:3000 ...\n',
  );
  const viteCommand = npmInvocation(['run', 'dev:web']);
  const vite = pipeChild(spawn(viteCommand.command, viteCommand.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_FIREBASE_MODE: requestedMode,
      // DEV should match production data/functions, but never open real
      // subscription checkout just because the production release switch is on.
      VITE_PREMIUM_SUBSCRIPTIONS_OPEN: 'false',
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
  if (!useEmulators) {
    console.log('Inkbound DEV: APP-PARITY mode.');
    console.log('Inkbound DEV: using production Firebase Auth, Firestore, Storage, and Cloud Functions.');
    console.log('Inkbound DEV: subscription checkout is forced OFF for localhost.');
    startVite();
  } else {
    console.log('Inkbound DEV: EMULATOR mode.');
    console.log('Inkbound DEV: preparing catalog services for local parity...');
    await runOnce(nodeCommand, ['scripts/sync-dev-catalog-secrets.mjs']);

    console.log('Inkbound DEV: building local Firebase Functions...');
    const functionsBuild = npmInvocation(['run', 'functions:build']);
    await runOnce(functionsBuild.command, functionsBuild.args);

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
  }
} catch (error) {
  console.error('Inkbound DEV could not start.', error);
  shutdown('SIGTERM', 1);
}
