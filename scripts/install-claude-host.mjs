// Registers native-host/claude-code-host.mjs with Chrome as a native messaging host, so the extension
// can run Claude Code with your Claude subscription. The extension ID is shown in Options → Key lines.
//   npm run claude:install -- <extension id> [more ids]
//   npm run claude:install            (again after moving Node or Claude Code; keeps the saved IDs)
//   npm run claude:uninstall
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.polyglot_player.claude_code';
const win = process.platform === 'win32';
// Full paths: some shells (Git Bash, IDE terminals) leave System32 off PATH.
const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostDir = join(root, 'native-host');
const hostScript = join(hostDir, 'claude-code-host.mjs');
const launcher = join(hostDir, win ? 'claude-code-host.bat' : 'claude-code-host.sh');
// Windows finds the manifest through the registry; macOS and Linux through a fixed folder.
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
const manifestDir = win
  ? hostDir
  : process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
    : join(homedir(), '.config/google-chrome/NativeMessagingHosts');
const manifestPath = join(manifestDir, `${HOST_NAME}.json`);

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

function findClaude() {
  let found = [];
  try {
    found = execFileSync(win ? join(system32, 'where.exe') : 'which', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    /* not on PATH */
  }
  // Where the native installer puts it, for shells that don't have it on PATH.
  const fallback = join(homedir(), '.local', 'bin', win ? 'claude.exe' : 'claude');
  if (existsSync(fallback)) found.push(fallback);
  // On Windows the helper starts claude.exe directly, so an npm `claude.cmd` shim won't do.
  const exe = found.find((p) => !win || p.toLowerCase().endsWith('.exe'));
  if (!exe) {
    fail(
      `Claude Code (claude${win ? '.exe' : ''}) was not found on PATH${found.length ? ` (found: ${found.join(', ')})` : ''}.\n` +
        'Install it with the native installer (https://code.claude.com), run `claude` once and sign in with /login,\nthen run this again.',
    );
  }
  return exe;
}

function savedIds() {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return m.allowed_origins.map((o) => o.replace(/^chrome-extension:\/\/|\/$/g, ''));
  } catch {
    return [];
  }
}

if (process.argv.includes('--uninstall')) {
  if (win) {
    try {
      execFileSync(join(system32, 'reg.exe'), ['delete', REG_KEY, '/f'], { stdio: 'ignore' });
    } catch {
      /* not registered */
    }
  }
  rmSync(manifestPath, { force: true });
  rmSync(launcher, { force: true });
  console.log('Claude Code helper removed.');
  process.exit(0);
}

const args = process.argv.slice(2);
const bad = args.filter((id) => !/^[a-p]{32}$/.test(id));
if (bad.length) fail(`Not an extension ID: ${bad.join(', ')}. Copy the command from Options → Key lines.`);
const ids = args.length ? args : savedIds();
if (!ids.length) {
  fail('Pass the extension ID: npm run claude:install -- <extension id>\nOptions → Key lines shows the full command.');
}

if (!existsSync(hostScript)) fail(`Missing ${hostScript}.`);
const claude = findClaude();
if (win) {
  writeFileSync(launcher, `@echo off\r\nset "CLAUDE_PATH=${claude}"\r\n"${process.execPath}" "${hostScript}" %*\r\n`);
} else {
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(launcher, `#!/bin/sh\nexport CLAUDE_PATH=${q(claude)}\nexec ${q(process.execPath)} ${q(hostScript)} "$@"\n`);
  chmodSync(launcher, 0o755);
}

mkdirSync(manifestDir, { recursive: true });
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      name: HOST_NAME,
      description: 'Polyglot Player: runs Claude Code for key lines and writes backup files',
      path: launcher,
      type: 'stdio',
      allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
    },
    null,
    2,
  )}\n`,
);
if (win) execFileSync(join(system32, 'reg.exe'), ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });

console.log(`Claude Code helper installed.
  Claude Code: ${claude}
  Node:        ${process.execPath}
  Extension:   ${ids.join(', ')}
Rebuild and reload the extension if you haven't since adding this feature, then use Options → Key lines → Test.`);
