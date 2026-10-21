import { chromium } from 'playwright';
import { input, password, confirm } from '@inquirer/prompts';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fullCases, executeWorkflow } from './cases.mjs';
import { selectCases, coverageFor, casePassed } from './coverage.mjs';
import { assertQaWorld, DEFAULT_QA_WORLD } from './world-guard.mjs';
import { loadDefaults, promptAccount, accountDefaults } from './local-defaults.mjs';
import { writeJournal, readJournal, finishCleanup, validateCredentials } from './lifecycle.mjs';
import { sourceFingerprint } from './evidence.mjs';

process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--full', '--list', '--cleanup-only', '--headless', '--saved'].includes(arg)) throw Error(`Unknown option: ${arg}`);
if (args.has('--list')) {
  for (const c of fullCases) console.log(`${c.name}${c.smoke ? ' [smoke]' : ''}: ${c.description}`);
  process.exit(0);
}
const selected = selectCases(fullCases, { full: args.has('--full'), filter: process.env.GUARDER_LIVE_CASE });
const directory = path.resolve('artifacts/live');
const journalPath = path.join(directory, 'recovery.json');
const lockPath = path.join(directory, 'runner.lock');
const local = await loadDefaults();
const world = process.env.GUARDER_DISPOSABLE_WORLD ?? local.world ?? DEFAULT_QA_WORLD;
const report = { started: new Date().toISOString(), cases: [], startupErrors: [], cleanup: 'not-needed' };
const secrets = [];
let browser, gm, player, record, locked = false, evidenceDirectory, current;
let interrupted = false;
let expectedConsoleLine = null;
let reloading = false;
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true; abort.abort();
  // Stop browser operations before recovery; interrupted runs retain their journal.
  void browser?.close().catch(() => {});
});
function safeError(error) {
  let result = String(error?.stack ?? error);
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join('[redacted]');
  return result;
}
async function rpc(page, method, extra = {}) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(async ({ method, context }) => {
        const api = await import('/modules/pf2e-guarder/tests/live/world.js');
        return api[method](context);
      }, { method, context: { world, runId: record?.runId, fixture: record?.fixture, ...extra } }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        interrupted = true;
        void browser?.close().catch(() => {});
        reject(Error(`Foundry operation timed out: ${method}; run test:live:cleanup`));
      }, 90000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function login(context, url, account, isGM) {
  const page = await context.newPage();
  // Other modules' socket handlers can throw while a page reloads mid-run; that is not this module's error.
  const capture = error => {
    if (reloading) return;
    const text = safeError(error);
    // Load-time errors from the QA world's own data or other modules are reported, not failed on.
    if (!current && !text.includes('pf2e-guarder')) (report.worldWarnings ??= []).push(text);
    else (current?.errors ?? report.startupErrors).push(text);
  };
  page.on('pageerror', capture);
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (current && expectedConsoleLine && message.text().split('\n')[0] === expectedConsoleLine) {
      (current.expectedErrors ??= []).push(expectedConsoleLine);
    } else capture(message.text());
  });
  page.setDefaultTimeout(20000);
  await page.goto(`${url}/join`);
  await page.locator('select[name="userid"], select[name="userId"], input[name="username"]').first().waitFor();
  assertQaWorld(await page.evaluate(() => globalThis.game?.world?.id), world);
  const select = page.locator('select[name="userid"], select[name="userId"]');
  if (await select.count()) {
    const options = await select.locator('option').evaluateAll(rows => rows.map(o => ({ label: o.textContent.trim(), id: o.value })));
    const found = options.find(o => o.label.toLowerCase() === account.username.trim().toLowerCase());
    if (!found) throw Error(`QA ${isGM ? 'GM' : 'player'} account not found`);
    await select.selectOption(found.id);
  } else await page.locator('input[name="username"]').fill(account.username);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, { timeout: 90000 });
  const state = await rpc(page, 'preflight');
  if (state.isGM !== isGM) throw Error(`Wrong QA account role: expected ${isGM ? 'GM' : 'player'}`);
  return { page, state };
}
async function prepareSession(session) {
  await session.page.waitForFunction(id => game.scenes.has(id), record.fixture.scene);
  await rpc(session.page, 'view'); await rpc(session.page, 'installTaggers'); await rpc(session.page, 'openPanel');
}
async function reloadSessions() {
  reloading = true;
  try { await reloadPages(); } finally { reloading = false; }
  for (const session of [gm, player]) await prepareSession(session);
}
async function reloadPages() {
  for (const session of [gm, player]) {
    await session.page.reload();
    await session.page.waitForFunction(() => game.ready && canvas.ready, null, { timeout: 90000 });
  }
  // Let late socket traffic from the reload settle before errors count again.
  await new Promise(resolve => setTimeout(resolve, 3000));
}
async function recover() {
  if (record.world !== world || record.url !== report.url || record.gm.user !== gm.state.user || record.player.user !== player.state.user) throw Error('Recovery requires original world, URL and accounts');
  report.cleanup = 'running';
  await finishCleanup({ journal: journalPath,
    // Restore views before deleting scenes so no client remains on a deleted canvas.
    cleanup: async () => {
      const results = await Promise.allSettled([[gm, record.gm], [player, record.player]].map(([session, saved]) => rpc(session.page, 'restore', { saved })));
      const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);
      if (failures.length) throw new AggregateError(failures, 'Session restoration failed');
    },
    restore: async () => {
      await rpc(gm.page, 'setPause', { paused: record.gm.paused });
      await rpc(gm.page, 'cleanup');
      if (Number.isFinite(record.gm.worldTime)) await rpc(gm.page, 'restoreWorldTime', { value: record.gm.worldTime });
      if (record.sundry) await rpc(gm.page, 'configureSundry', { restore: true, saved: record.sundry });
    },
    verify: async () => {
      const remaining = await rpc(gm.page, 'leftovers');
      if (Object.values(remaining).some(ids => ids.length)) throw Error('Fixture documents remain');
      for (const [session, saved] of [[gm, record.gm], [player, record.player]]) {
        const actual = await rpc(session.page, 'preflight');
        if (actual.scene !== saved.scene || actual.paused !== record.gm.paused) throw Error('Session state not restored');
        if (Number.isFinite(record.gm.worldTime) && actual.worldTime !== record.gm.worldTime) throw Error('World time not restored');
      }
      if (record.sundry) {
        const config = await rpc(gm.page, 'moduleConfiguration');
        if (Object.hasOwn(config, 'sundry') !== record.sundry.exists || (record.sundry.exists && config.sundry !== record.sundry.value)) throw Error('Sundry module configuration not restored');
      }
    },
  });
  report.cleanup = 'complete';
}
async function saveReport() {
  report.finished = new Date().toISOString();
  report.coverage = coverageFor(fullCases, report.cases);
  await writeJournal(path.join(directory, 'report.json'), report);
  if (evidenceDirectory) await writeJournal(path.join(evidenceDirectory, 'report.json'), report);
}

try {
  await mkdir(directory, { recursive: true });
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw Error('Invalid runner lock; inspect before removing', { cause: error });
    try { process.kill(pid, 0); throw Error(`Live runner already active (PID ${pid})`, { cause: error }); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath); lock = await open(lockPath, 'wx');
  }
  locked = true;
  await lock.writeFile(String(process.pid)); await lock.close();
  record = await readJournal(journalPath);
  if (record && !args.has('--cleanup-only')) throw Error('Interrupted run found. Run npm run test:live:cleanup first');
  if (!record && args.has('--cleanup-only')) { console.log('No recovery needed.'); }
  else {
    const url = process.env.GUARDER_FOUNDRY_URL ?? (args.has('--saved') ? local.url : await input({ message: 'Foundry URL:', default: local.url ?? 'http://localhost:30000' }, { signal: abort.signal }));
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Use HTTP(S) URL without embedded credentials, query or fragment');
    report.url = parsed.href.replace(/\/$/, '');
    if (record && (record.url !== report.url || record.world !== world)) throw Error('Recovery journal belongs to another world/URL');
    const accounts = {};
    for (const role of ['gm', 'player']) {
      accounts[role] = args.has('--saved') ? accountDefaults(role, local) : await promptAccount(role, local, process.env, { input, password, confirm }, { signal: abort.signal });
      secrets.push(accounts[role].password);
    }
    validateCredentials(accounts.gm, accounts.player);
    browser = await chromium.launch({ headless: args.has('--headless'), channel: process.env.GUARDER_BROWSER_CHANNEL || undefined });
    // A local Foundry often serves a self-signed certificate.
    const contextOptions = { viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: ['localhost', '127.0.0.1'].includes(parsed.hostname) };
    gm = await login(await browser.newContext(contextOptions), report.url, accounts.gm, true);
    player = await login(await browser.newContext(contextOptions), report.url, accounts.player, false);
    if (args.has('--cleanup-only')) await recover();
    else {
      report.environment = gm.state;
      const manifest = JSON.parse(await readFile('module.json', 'utf8'));
      if (manifest.version !== gm.state.module) {
        // Foundry caches module.json until the server restarts; scripts are still served fresh from disk.
        // The override is only safe when the manifest's esmodules/styles didn't change.
        if (process.env.GUARDER_ALLOW_VERSION_MISMATCH !== '1') throw Error('Restart QA world to load current module version');
        report.environmentWarning = `Foundry reports module ${gm.state.module}, manifest is ${manifest.version} (GUARDER_ALLOW_VERSION_MISMATCH)`;
        console.warn(report.environmentWarning);
      }
      report.sourceFingerprint = await sourceFingerprint();
      const prerequisites = await rpc(gm.page, 'prerequisites');
      if (prerequisites.blocked) {
        report.cases = selected.map(c => ({ name: c.name, status: 'blocked', error: prerequisites.blocked }));
      } else {
        record = { runId: randomUUID(), world, url: report.url, gm: gm.state, player: player.state };
        evidenceDirectory = path.join(directory, record.runId);
        await mkdir(evidenceDirectory, { recursive: true });
        // Write before the first world mutation, including scene creation and pause changes.
        await writeJournal(journalPath, record);
        report.cleanup = 'pending';
        await rpc(gm.page, 'setPause', { paused: false });
        record.fixture = await rpc(gm.page, 'setup', { player: player.state.user, items: prerequisites.items });
        await writeJournal(journalPath, record);
        for (const session of [gm, player]) await prepareSession(session);
        for (const scenario of selected) {
          if (interrupted) throw Error('Live suite interrupted');
          const result = { name: scenario.name, status: 'running', assertions: [], screenshots: [], errors: [] };
          report.cases.push(result); current = result;
          console.log(`RUN ${scenario.name}`);
          const check = (label, passed) => {
            result.assertions.push({ label, passed: Boolean(passed) });
            if (!passed) throw Error(label);
          };
          const screenshot = async label => {
            for (const [role, session] of [['gm', gm], ['player', player]]) {
              const file = `${scenario.name}-${label}-${role}.png`;
              await session.page.screenshot({ path: path.join(evidenceDirectory, file) });
              result.screenshots.push(file);
            }
          };
          try {
            if (scenario.sundry && !(await gm.page.evaluate(() => game.modules.get('sundry')?.active))) {
              const config = await rpc(gm.page, 'moduleConfiguration');
              record.sundry = { exists: Object.hasOwn(config, 'sundry'), value: config.sundry ?? null };
              await writeJournal(journalPath, record);
              await rpc(gm.page, 'configureSundry');
              await reloadSessions();
              result.integration = 'sundry';
            }
            for (const session of [gm, player]) await rpc(session.page, 'tidy');
            const outcome = await executeWorkflow(scenario.name, { gm: gm.page, player: player.page, fixture: record.fixture, rpc, check, screenshot,
              expectConsoleError: async (line, operation) => {
                expectedConsoleLine = line;
                try { return await operation(); } finally { expectedConsoleLine = null; }
              },
              eventually: async (label, predicate) => {
                const deadline = Date.now() + 20000;
                while (Date.now() < deadline) {
                  if (await predicate()) { check(label, true); return; }
                  await new Promise(resolve => setTimeout(resolve, 150));
                }
                check(label, false);
              },
            });
            result.status = outcome?.blocked ? 'blocked' : 'pass';
            if (outcome?.blocked) result.error = outcome.blocked;
            if (result.errors.length) result.status = 'failed';
            if (result.status === 'pass' && !casePassed(result)) throw Error('Case produced no assertion/screenshot evidence');
          } catch (error) {
            result.status = String(error.message).includes('Prerequisite:') ? 'blocked' : 'failed'; result.error = safeError(error);
            if (!interrupted && record.fixture) result.actual = await rpc(gm.page, 'snapshot').catch(() => null);
            if (!interrupted) await screenshot('failure').catch(() => {});
          }
          current = null;
          console.log(`${result.status.toUpperCase()} ${scenario.name}${result.error ? `: ${result.error.split('\n')[0]}` : ''}`);
          await saveReport();
          // Every case arranges its own fixture state, so one failure does not stop the suite.
          if (result.status === 'failed' && !interrupted) for (const session of [gm, player]) await rpc(session.page, 'closePrompts').catch(() => {});
        }
        report.sourceChangedDuringRun = report.sourceFingerprint !== await sourceFingerprint();
      }
    }
  }
} catch (error) {
  report.error = safeError(error); console.error(report.error);
} finally {
  if (locked) {
    const pending = await readJournal(journalPath).catch(() => null);
    if (pending && gm && player && !interrupted && !report.error?.includes('Interrupted run found')) {
      record = pending;
      try { await recover(); } catch (error) { report.cleanup = 'incomplete'; report.cleanupError = safeError(error); }
    } else if (pending) report.cleanup = 'incomplete';
    await browser?.close().catch(() => {});
    await saveReport();
    await unlink(lockPath);
  }
}
if (report.error || report.startupErrors.length || report.sourceChangedDuringRun || report.cleanup === 'incomplete' ||
  (!args.has('--cleanup-only') && (report.cases.length !== selected.length || report.cases.some(c => !casePassed(c))))) process.exitCode = 1;
console.log(`Live tests: ${report.cases.filter(casePassed).length}/${selected.length} passed; cleanup: ${report.cleanup}`);
