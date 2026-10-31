import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.TEST_BASE_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://127.0.0.1:5000');
const output = 'generated-artifacts/browser-verification';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const results = [];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const check = (name, detail) => {
  results.push({ name, passed: true, detail });
  console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`);
};

async function readCurrentRun() {
  const id = await page.locator('#runHistory').inputValue();
  const response = await context.request.get(`${base}/api/runs/${id}`);
  assert.equal(response.status(), 200);
  return response.json();
}

async function waitForReview() {
  await expect(page.locator('#reviewGate')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#runAlert')).toContainText('Evidence map ready');
}

async function buildBrief() {
  await page.locator('#reviewAcknowledged').check();
  await page.locator('#generateBrief').click();
  await expect(page.locator('#briefStatus')).toHaveText('REVIEWED · SAVED', { timeout: 20000 });
}

try {
  await page.goto(base);
  if (await page.locator('#newAnalysisTop').isVisible()) await page.locator('#newAnalysisTop').click();
  await page.locator('#loadExample').click();
  await page.locator('#analyzeButton').click();
  await waitForReview();
  assert.ok(await page.locator('.evidence-edge').count() > 0, 'real evidence graph has source-backed edges');
  assert.equal(await page.locator('[data-edge-requirement="generators"]').count(), 0, 'missing evidence has no graph edge');
  await expect(page.locator('.server-boundary')).toContainText('APPLICATION SERVER');
  await expect(page.locator('.database-boundary')).toContainText('POSTGRESQL DATABASE');
  await expect(page.locator('#briefContent')).not.toContainText('Resume bullet drafts');
  check('human-review gate', 'No resume or interview statements before review');

  await page.locator('[data-requirement-id="electrical-troubleshooting"]').first().click();
  await expect(page.locator('#classificationChoice')).toHaveValue('Direct Evidence');
  await expect(page.locator('#bridgeDetails')).toContainText('Diagnosed wiring-harness failures.');
  await page.locator('#classificationChoice').selectOption('Transferable Evidence');
  await page.locator('[data-requirement-id="ups-systems"]').first().click();
  await expect(page.locator('#classificationChoice')).toHaveValue('Transferable Evidence');
  for (const id of ['generators', 'cooling-systems']) {
    await page.locator(`[data-requirement-id="${id}"]`).first().click();
    await expect(page.locator('#classificationChoice')).toHaveValue('Missing Evidence');
  }
  check('evidence inspection', 'Exact sources present; UPS transferable; generator and cooling missing');
  await buildBrief();
  let first = await readCurrentRun();
  assert.equal(first.result.requirements.find((item) => item.id === 'electrical-troubleshooting').classification, 'Transferable Evidence');
  check('review correction persisted', first.id);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/transition-brief.txt`);
  const briefText = await fs.readFile(`${output}/transition-brief.txt`, 'utf8');
  assert.match(briefText, /Career Transition Brief/);
  assert.match(briefText, /TRANSFERABLE EVIDENCE/);
  check('brief download', 'Text includes reviewed evidence and caveats');
  await page.reload();
  await expect(page.locator('#briefStatus')).toHaveText('REVIEWED · SAVED');
  assert.equal((await readCurrentRun()).id, first.id);
  check('refresh persistence', 'Saved run, correction, and brief restored');

  for (const speed of ['0.5', '1', '2']) {
    await page.locator(`[data-speed="${speed}"]`).click();
    await expect(page.locator(`[data-speed="${speed}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#replayButton').click();
  await page.waitForTimeout(750);
  await page.locator('#pauseReplay').click();
  const pausedIndex = Number(await page.locator('.event-row.selected').getAttribute('data-event-index'));
  await page.waitForTimeout(400);
  assert.equal(Number(await page.locator('.event-row.selected').getAttribute('data-event-index')), pausedIndex);
  await page.locator('#stepReplay').click();
  assert.equal(Number(await page.locator('.event-row.selected').getAttribute('data-event-index')), pausedIndex + 1);
  check('replay controls', 'Speed selections, play, pause, and single-event step respond');
  await page.locator('#workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop-workspace.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile must not overflow horizontally');
  for (const [selector, name] of [['.vault-panel', 'vault'], ['.bridge-panel', 'bridge'], ['.brief-panel', 'brief'], ['.observatory', 'observatory']]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/mobile-${name}.png` });
  }
  check('mobile layout', '390×844: no horizontal overflow; vault, bridge, brief and replay visible');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#newAnalysisTop').click();
  await page.locator('#loadExample').click();
  await page.locator('#simulateFailure').check();
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#runAlert')).toContainText('Simulated extraction failure', { timeout: 20000 });
  const failed = await readCurrentRun();
  assert.equal(failed.status, 'failed');
  assert.ok(failed.events.some((item) => item.phase === 'extract' && item.status === 'failed' && item.duration_ms >= 0));
  await page.locator('#retryButton').click();
  await waitForReview();
  await buildBrief();
  const recovered = await readCurrentRun();
  assert.equal(recovered.status, 'completed');
  assert.ok(recovered.events.some((item) => item.phase === 'recovery' && item.detail.includes(failed.id)));
  assert.notEqual(recovered.id, failed.id);
  assert.deepEqual(recovered.experience_text, failed.experience_text);
  assert.equal(recovered.target_role, failed.target_role);
  check('simulated failure and retry', 'Measured failed event retained; saved input succeeds in a new run');

  await page.locator('#newAnalysisTop').click();
  await page.locator('#loadExample').click();
  await page.locator('.experience-entry').nth(1).locator('button').click();
  await page.locator('.experience-entry input').fill('Data service project');
  await page.locator('.experience-entry textarea').fill('Built Python data services. Maintained PostgreSQL databases. Deployed AWS cloud applications. Documented automated tests.');
  await page.locator('#skillsInput').fill('Python, PostgreSQL, AWS');
  await page.locator('#targetRole').fill('Software Engineer');
  await page.locator('#jobDescription').fill('Software Engineer. Build Python data services, maintain PostgreSQL databases, deploy AWS cloud applications, and document automated tests.');
  await page.locator('#analyzeButton').click();
  await waitForReview();
  await buildBrief();
  const second = await readCurrentRun();
  assert.notDeepEqual(second.result.requirements.map((item) => item.id), first.result.requirements.map((item) => item.id));
  check('different-input analysis', 'Software-engineering requirements differ from facilities run');
  const otherContext = await browser.newContext();
  assert.equal((await otherContext.request.get(`${base}/api/runs/${first.id}`)).status(), 404);
  await otherContext.close();
  check('browser ownership', 'Independent browser cannot read another session run');
  assert.deepEqual(errors, [], 'No browser JavaScript errors');
  check('browser console', 'No page errors');
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ base, success: true, results, browserErrors: errors }, null, 2));
} catch (error) {
  console.error(error);
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ base, success: false, results, browserErrors: errors, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
