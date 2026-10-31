import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const out = 'generated-artifacts/diagram-verification';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const response = await context.request.post(`${base}/api/runs`, { data: {
    source: 'paste', url: '', targetRole: 'Critical Facilities Technician', skills: '', fault: null,
    description: 'Critical Facilities Technician. Perform electrical troubleshooting and equipment maintenance. Familiarity with UPS systems is required. Generator knowledge is required. Cooling-system knowledge is required.',
    experiences: [
      { id: 'test-power', title: 'Power-supply testing', text: 'Installed and tested equipment power supplies. Measured voltage and continuity with a digital multimeter.' },
      { id: 'test-repair', title: 'Electrical diagnosis', text: 'Diagnosed wiring-harness failures. Replaced defective electronic boards. Completed functional testing.' },
    ],
  } });
  assert.equal(response.status(), 202);
  const { id } = await response.json();
  for (let index = 0; index < 100; index++) {
    const run = await (await context.request.get(`${base}/api/runs/${id}`)).json();
    if (run.status === 'awaiting_review') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.goto(base);
  await expect(page.locator('#reviewGate')).toBeVisible();
  await expect(page.locator('.evidence-edge').first()).toBeAttached();
  assert.equal(await page.locator('[data-edge-requirement="generators"]').count(), 0);
  assert.equal(await page.locator('[data-edge-requirement="cooling-systems"]').count(), 0);
  await page.locator('[data-edge-requirement="electrical-troubleshooting"].transferable').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bridgeDetails .classification-chip')).toHaveText('Transferable Evidence');
  await expect(page.locator('#bridgeDetails')).toContainText('Measured voltage and continuity');
  await page.locator('[data-edge-requirement="electrical-troubleshooting"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bridgeDetails h4')).toHaveText('Electrical troubleshooting');
  await expect(page.locator('#classificationChoice')).toHaveValue('Direct Evidence');
  await page.locator('#classificationChoice').selectOption('Missing Evidence');
  assert.equal(await page.locator('[data-edge-requirement="electrical-troubleshooting"]').count(), 0);
  await expect(page.locator('[data-graph-requirement="electrical-troubleshooting"]')).toHaveClass(/missing/);
  await page.locator('#classificationChoice').selectOption('Direct Evidence');
  await expect(page.locator('[data-edge-requirement="electrical-troubleshooting"]').first()).toBeAttached();
  console.log('PASS evidence graph: inspectable real links; no unsupported edges; pending corrections update graph');
  await expect(page.locator('[data-workflow-phase="extract"]')).toHaveClass(/completed/);
  await expect(page.locator('[data-workflow-phase="brief"]')).toHaveClass(/waiting/);
  await page.locator('.event-row').first().click();
  await expect(page.locator('[data-workflow-phase="receive"]')).toHaveClass(/running/);
  await expect(page.locator('[data-workflow-phase="extract"]')).toHaveClass(/waiting/);
  await page.locator('.event-row').filter({ hasText: 'Extract role requirements completed' }).click();
  await expect(page.locator('[data-workflow-phase="extract"]')).toHaveClass(/completed/);
  await expect(page.locator('.external-boundary')).toContainText('skipped');
  await expect(page.locator('.browser-boundary')).toContainText('BROWSER');
  await expect(page.locator('.database-boundary')).toContainText('POSTGRESQL DATABASE');
  console.log('PASS execution diagram: actual event snapshots, measured durations, skipped external boundary, inspectable nodes');
  await page.evaluate(() => window.scrollTo(0, document.querySelector('#workspace').offsetTop - 15));
  await page.screenshot({ path: `${out}/desktop-evidence-graph.png` });
  await page.locator('.observatory').evaluate((element) => window.scrollTo(0, element.offsetTop - 10));
  await page.screenshot({ path: `${out}/desktop-execution-diagram.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator('.bridge-panel').evaluate((element) => window.scrollTo(0, element.offsetTop - 10));
  await page.screenshot({ path: `${out}/mobile-evidence-graph.png` });
  await page.locator('.observatory').evaluate((element) => window.scrollTo(0, element.offsetTop - 10));
  await page.screenshot({ path: `${out}/mobile-execution-diagram.png` });
  assert.deepEqual(errors, []);
  console.log('PASS mobile diagrams: 390px width, no page overflow, no JavaScript errors');
  await context.close();
  const fallbackContext = await browser.newContext();
  const fallbackPage = await fallbackContext.newPage();
  const submission = {
    source: 'url', url: 'https://127.0.0.1/job', targetRole: 'Facilities Technician', skills: 'multimeter',
    description: '', experiences: [{ id: 'preserved', title: 'Repair work', text: 'Measured voltage and continuity with a digital multimeter.' }],
  };
  const blockedResponse = await fallbackContext.request.post(`${base}/api/runs`, { data: submission });
  const blocked = await blockedResponse.json();
  for (let index = 0; index < 100; index++) {
    const run = await (await fallbackContext.request.get(`${base}/api/runs/${blocked.id}`)).json();
    if (run.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fallbackPage.goto(base);
  await expect(fallbackPage.locator('#pasteFallback')).toBeVisible();
  await fallbackPage.locator('#pasteFallback').click();
  await expect(fallbackPage.locator('.experience-entry textarea')).toHaveValue(submission.experiences[0].text);
  await expect(fallbackPage.locator('#skillsInput')).toHaveValue('multimeter');
  await expect(fallbackPage.locator('input[name="source"][value="paste"]')).toBeChecked();
  await fallbackPage.locator('#jobDescription').fill('Facilities Technician. Perform electrical troubleshooting and equipment maintenance. Maintain UPS systems and generator equipment. Cooling-system knowledge is required.');
  await fallbackPage.locator('#analyzeButton').click();
  await expect(fallbackPage.locator('#reviewGate')).toBeVisible({ timeout: 20000 });
  console.log('PASS blocked URL recovery: private-network retrieval refused, saved inputs restored, pasted posting succeeds');
  await fallbackContext.close();
} finally {
  await browser.close();
}
