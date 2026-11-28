#!/usr/bin/env node
// npx tinkerlings: runs the installer of the system it is on, which installs or updates
// Tinkerlings in ~/.tinkerlings and starts it. (The npm package is only this way in.)

import { spawnSync } from 'node:child_process';

const FROM = 'https://raw.githubusercontent.com/maidevberlin/tinkerlings/main';
const [command, args] = process.platform === 'win32'
  ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${FROM}/install.ps1 | iex`]]
  : ['sh', ['-c', `curl -fsSL ${FROM}/install.sh | sh`]];
process.exit(spawnSync(command, args, { stdio: 'inherit' }).status ?? 1);
