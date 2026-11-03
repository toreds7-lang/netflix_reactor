// Chrome native messaging host that lets the extension run Claude Code (`claude -p`) with your
// Claude subscription, and write backup files of your saved sentences and words.
// Chrome starts it for each connection; `npm run claude:install` registers it.
// Protocol, both ways: a 4-byte little-endian length, then that many bytes of UTF-8 JSON.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Set by the launcher that install-claude-host.mjs writes. */
const CLAUDE = process.env.CLAUDE_PATH || 'claude';
const RUN_TIMEOUT_MS = 10 * 60_000;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
// An empty folder as the working directory, so no project CLAUDE.md, settings or memory are picked up.
const WORKDIR = join(tmpdir(), 'polyglot-claude-code');
/** Backups go here unless the extension names another folder (Options → Sentences). */
const BACKUP_DIR = join(homedir(), 'Documents', 'Polyglot Player');
/** Dated copies kept next to the latest one, one per day. */
const KEEP_DAILY = 30;
const DAILY_FILE = /^polyglot-backup-\d{4}-\d{2}-\d{2}\.json$/;
/** The 🔎 library is much larger and grows slowly: fewer dated copies of it. */
const KEEP_LIBRARY_DAILY = 3;
const LIBRARY_DAILY_FILE = /^polyglot-library-\d{4}-\d{2}-\d{2}\.json$/;

const children = new Set();
/** 💬 System prompt files of the chat answers being written; removed when they end, or when Chrome disconnects. */
const chatFiles = new Set();

function reply(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

/** Run Claude Code with `input` on stdin. With `onLine`, each line of its output goes there instead of `out`. */
function exec(args, input, timeoutMs, onLine) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Use the logged-in subscription even if an API key is set in the environment.
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(CLAUDE, args, { cwd: WORKDIR, env, windowsHide: true });
    children.add(child);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => {
      out += d;
      if (!onLine) return;
      let at;
      while ((at = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, at).trim();
        out = out.slice(at + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      children.delete(child);
    };
    child.on('error', (e) => {
      done();
      reject(
        e.code === 'ENOENT'
          ? new Error(`Claude Code was not found at ${CLAUDE}. Install it, then run npm run claude:install again.`)
          : e,
      );
    });
    child.on('close', (code, signal) => {
      done();
      resolve({ code, signal, out, err });
    });
    child.stdin.on('error', () => undefined); // the process may exit before reading everything
    child.stdin.end(input);
  });
}

/** Turn Claude Code's error text into something the sidebar can show. */
function describe(text) {
  const msg = String(text || '').trim();
  if (/not logged in|\/login|invalid api key/i.test(msg)) {
    return 'Claude Code is not signed in. Run `claude` in a terminal and sign in with /login.';
  }
  return msg.split('\n')[0].slice(0, 300) || 'Claude Code failed without a message.';
}

async function ping() {
  const version = await exec(['--version'], '', 30_000);
  const status = await exec(['auth', 'status'], '', 30_000);
  let auth = {};
  try {
    auth = JSON.parse(status.out);
  } catch {
    /* older versions print text */
  }
  return {
    ok: true,
    version: version.out.trim(),
    loggedIn: !!auth.loggedIn,
    authMethod: auth.authMethod ?? '',
    subscription: auth.subscriptionType ?? '',
  };
}

async function run({ model, effort, system, user, schema }) {
  if (typeof model !== 'string' || !/^claude-[a-z0-9-]+$/.test(model)) throw new Error('Invalid model.');
  if (effort !== undefined && !EFFORTS.has(effort)) throw new Error('Invalid effort.');
  if (typeof system !== 'string' || typeof user !== 'string' || typeof schema !== 'object') throw new Error('Invalid request.');
  const args = [
    '-p',
    '--model', model,
    ...(effort ? ['--effort', effort] : []),
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
    // A plain completion: no tools, MCP servers, settings, hooks or saved session.
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
  const { code, signal, out, err } = await exec(args, user, RUN_TIMEOUT_MS);
  if (signal) throw new Error('Claude Code took too long and was stopped.');
  let res;
  try {
    res = JSON.parse(out);
  } catch {
    throw new Error(describe(err || out || `Claude Code exited with code ${code}.`));
  }
  if (res.is_error || res.structured_output == null) throw new Error(describe(res.result || res.subtype));
  const usage = res.usage ?? {};
  return {
    ok: true,
    output: res.structured_output,
    model: Object.keys(res.modelUsage ?? {}).find((m) => m.startsWith(model)) ?? model,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
  };
}

/**
 * 💬 Chat: one streamed answer. Each piece of text goes back as `{ ok: true, delta }` as it is written, then
 * `{ ok: true, done: true, ... }`. The system prompt holds the whole episode, so it goes through a file: Windows
 * limits a command line to about 32,000 characters. Kept the same between questions, it is cached.
 */
async function chat({ model, effort, system, user }) {
  if (typeof model !== 'string' || !/^claude-[a-z0-9-]+$/.test(model)) throw new Error('Invalid model.');
  if (effort !== undefined && !EFFORTS.has(effort)) throw new Error('Invalid effort.');
  if (typeof system !== 'string' || typeof user !== 'string') throw new Error('Invalid request.');
  const file = join(WORKDIR, `chat-${process.pid}-${Date.now()}.txt`);
  writeFileSync(file, system, 'utf8');
  chatFiles.add(file);
  const args = [
    '-p',
    '--model', model,
    ...(effort ? ['--effort', effort] : []),
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt-file', file,
    // A plain completion: no tools, MCP servers, settings, hooks or saved session.
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
  let result = null;
  try {
    const { code, signal, err } = await exec(args, user, RUN_TIMEOUT_MS, (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      const delta = m.type === 'stream_event' && m.event?.type === 'content_block_delta' ? m.event.delta : null;
      if (delta?.type === 'text_delta' && delta.text) reply({ ok: true, delta: delta.text });
      else if (m.type === 'result') result = m;
    });
    if (signal) throw new Error('Claude Code took too long and was stopped.');
    if (!result) throw new Error(describe(err || `Claude Code exited with code ${code}.`));
  } finally {
    rmSync(file, { force: true });
    chatFiles.delete(file);
  }
  if (result.is_error) throw new Error(describe(result.result || result.subtype));
  const usage = result.usage ?? {};
  return {
    ok: true,
    done: true,
    model: Object.keys(result.modelUsage ?? {}).find((m) => m.startsWith(model)) ?? model,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
  };
}

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Write through a temporary file, so a crash mid-write leaves the previous backup in place. */
function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

/** The backup folder: the one the extension names (a full path), or the default. */
function backupFolder(dir) {
  if (dir != null && (typeof dir !== 'string' || !isAbsolute(dir))) {
    throw new Error('The backup folder must be a full path, such as C:\\Users\\you\\OneDrive\\Backups.');
  }
  const folder = dir ?? BACKUP_DIR;
  mkdirSync(folder, { recursive: true });
  return folder;
}

/** Write `latest` and a copy for today, then keep only the newest `keep` dated copies matching `daily`. */
function writeWithDaily(folder, latestName, prefix, daily, keep, json) {
  const latest = join(folder, latestName);
  writeAtomic(latest, json);
  writeAtomic(join(folder, `${prefix}-${localDate()}.json`), json);
  const copies = readdirSync(folder).filter((f) => daily.test(f)).sort();
  for (const f of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(folder, f), { force: true });
  return latest;
}

/** The app's JSON, checked: it must be one of the extension's files. */
function parseApp(json, kind) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : null;
  } catch {
    /* reported below */
  }
  if (data?.app !== 'polyglot-player' || (kind && data.kind !== kind)) throw new Error('Invalid backup.');
}

/** The extension's backup JSON as polyglot-backup-latest.json plus a copy for today; older daily copies are pruned. */
function backup({ json, dir }) {
  parseApp(json);
  const path = writeWithDaily(backupFolder(dir), 'polyglot-backup-latest.json', 'polyglot-backup', DAILY_FILE, KEEP_DAILY, json);
  return { ok: true, path };
}

/** The 🔎 library (saved episodes) as polyglot-library.json plus a copy for today, in the same folder. */
function backupLibrary({ json, dir }) {
  parseApp(json, 'library');
  const path = writeWithDaily(backupFolder(dir), 'polyglot-library.json', 'polyglot-library', LIBRARY_DAILY_FILE, KEEP_LIBRARY_DAILY, json);
  return { ok: true, path };
}

async function handle(msg) {
  try {
    const type = msg?.type;
    reply(
      type === 'ping'
        ? await ping()
        : type === 'backup'
          ? backup(msg)
          : type === 'backupLibrary'
            ? backupLibrary(msg)
            : type === 'chat'
              ? await chat(msg)
              : await run(msg ?? {}),
    );
  } catch (e) {
    reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

mkdirSync(WORKDIR, { recursive: true });

let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.subarray(4, 4 + len).toString('utf8');
    buf = buf.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      reply({ ok: false, error: 'Invalid message.' });
      continue;
    }
    void handle(msg);
  }
});
// Chrome closes stdin when the extension disconnects (■ in the chat, or its worker stops): stop Claude Code too.
process.stdin.on('end', () => {
  for (const child of children) child.kill();
  for (const file of chatFiles) rmSync(file, { force: true });
  process.exit(0);
});
