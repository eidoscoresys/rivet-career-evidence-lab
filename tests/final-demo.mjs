import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const output = 'generated-artifacts/final-demo';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
const browserErrors = [];
let runPosts = 0;
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('request', (request) => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runPosts++;
});
const checks = [];
const record = (name, detail) => {
  checks.push({ name, passed: true, detail });
  console.log(`PASS ${name}: ${detail}`);
};
const currentId = async () => page.locator('#runHistory').inputValue();
const fetchRun = async (id) => {
  const response = await context.request.get(`${base}/api/runs/${id}`);
  assert.equal(response.status(), 200);
  return response.json();
};
const waitForReview = async () => {
  await expect(page.locator('#reviewGate')).toBeVisible({ timeout: 20000 });
};
const finishHumanReview = async () => {
  await page.locator('#reviewAcknowledged').check();
  await page.locator('#generateBrief').click();
  await expect(page.locator('#briefStatus')).toHaveText('REVIEWED · SAVED', { timeout: 20000 });
};
const scrollTop = async (selector) => page.locator(selector).evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 12));

try {
  await page.goto(base);
  await expect(page.locator('#intakePanel')).toBeVisible();
  await page.locator('#loadExample').click();
  await page.locator('#addExperience').click();
  const extra = page.locator('.experience-entry').nth(2);
  await extra.locator('input').fill('Safety procedures — illustrative ambiguity');
  await extra.locator('textarea').fill('Helped with safety procedures and documenting work performed.');
  await page.locator('#analyzeButton').click();
  await waitForReview();
  const id = await currentId();
  let run = await fetchRun(id);
  assert.equal(run.status, 'awaiting_review');
  const preRefreshPosts = runPosts;
  await page.reload();
  await waitForReview();
  assert.equal(await currentId(), id);
  assert.equal(runPosts, preRefreshPosts, 'refreshing the draft does not repeat analysis');
  run = await fetchRun(id);
  assert.equal(run.status, 'awaiting_review');
  assert.equal(run.result.experiences.length, 3);
  record('review-gate refresh persistence', `PostgreSQL draft ${id} and submitted sources restored without re-running the analysis.`);
  assert.equal(run.target_role, 'Critical Facilities Technician');
  const requirementById = Object.fromEntries(run.result.requirements.map((item) => [item.id, item]));
  assert.equal(requirementById['electrical-troubleshooting'].classification, 'Direct Evidence');
  assert.equal(requirementById['equipment-maintenance'].classification, 'Direct Evidence');
  assert.equal(requirementById['ups-systems'].classification, 'Transferable Evidence');
  assert.equal(requirementById.generators.classification, 'Missing Evidence');
  assert.equal(requirementById['cooling-systems'].classification, 'Missing Evidence');
  const clarification = run.result.requirements.find((item) => item.classification === 'Needs Clarification');
  assert.ok(clarification, 'the illustrative vague safety statement is identified for clarification');
  assert.match(clarification.evidence[0].excerpt, /Helped with safety procedures/);
  for (const [name, classification] of Object.entries({
    'electrical-troubleshooting': 'Direct Evidence',
    'ups-systems': 'Transferable Evidence',
    generators: 'Missing Evidence',
    [clarification.id]: 'Needs Clarification',
  })) {
    await expect(page.locator(`[data-graph-requirement="${name}"]`)).toHaveText(new RegExp(classification.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  await expect(page.locator('.evidence-edge').first()).toBeVisible();
  const beforeReview = run.result.requirements.length;
  assert.ok(beforeReview >= 6);
  record('live illustrative analysis', `PostgreSQL run ${id}; ${beforeReview} role requirements; all four evidence classifications; UPS is transferable and generators/cooling remain unverified.`);
  await page.locator('[data-edge-requirement="electrical-troubleshooting"].direct').first().click();
  await expect(page.locator('#bridgeDetails')).toContainText('Diagnosed wiring-harness failures.');
  await expect(page.locator('#bridgeDetails')).toContainText('Perform electrical troubleshooting and equipment maintenance.');
  await scrollTop('.bridge-panel');
  await page.locator('.bridge-panel').screenshot({ path: `${output}/01-evidence-bridge-desktop.png` });

  await finishHumanReview();
  run = await fetchRun(id);
  assert.equal(run.status, 'completed');
  const completedPostCount = runPosts;
  await page.reload();
  await expect(page.locator('#briefStatus')).toHaveText('REVIEWED · SAVED');
  assert.equal(await currentId(), id);
  assert.equal(runPosts, completedPostCount, 'refreshing a completed run does not repeat analysis');
  run = await fetchRun(id);
  assert.equal(run.status, 'completed');
  assert.ok(run.result.brief.resumeBullets.length > 0);
  assert.ok(run.result.brief.interviewTalkingPoints.length > 0);
  assert.equal(run.result.brief.nextActions.length, 3);
  assert.ok(run.result.brief.resumeBullets.every((item) => run.experience_text.some((entry) => entry.text.includes(item.text))));
  assert.ok(run.result.brief.transferable.every((item) => item.explanation.includes('does not establish direct experience')));
  const phases = ['receive', 'validate', 'retrieve', 'external_fetch', 'extract', 'normalize', 'link', 'classify', 'review_gate', 'human_review', 'brief', 'save', 'overall'];
  for (const phase of phases) assert.ok(run.events.some((event) => event.phase === phase), `recorded phase ${phase}`);
  for (const event of run.events.filter((entry) => entry.status === 'completed' && phases.some((phase) => phase === entry.phase && phase !== 'overall'))) {
    assert.ok(Number.isInteger(event.duration_ms) && event.duration_ms >= 0, `${event.phase} has measured duration`);
  }
  assert.ok(run.events.some((event) => event.phase === 'save' && event.status === 'completed' && /PostgreSQL/i.test(event.detail)), 'real draft/final persistence is recorded');
  assert.ok(run.events.some((event) => event.phase === 'review_gate' && event.status === 'skipped'));
  assert.ok(run.events.some((event) => event.phase === 'overall' && event.status === 'completed'));
  record('reviewed Career Transition Brief', `${run.result.brief.resumeBullets.length} verbatim resume drafts, ${run.result.brief.interviewTalkingPoints.length} interview talking points, 3 practical next steps.`);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/career-transition-brief.txt`);
  const downloadedBrief = await fs.readFile(`${output}/career-transition-brief.txt`, 'utf8');
  assert.match(downloadedBrief, /Resume bullet drafts/i);
  assert.match(downloadedBrief, /Interview talking points/i);
  await scrollTop('.brief-panel');
  await page.locator('.brief-panel').screenshot({ path: `${output}/02-career-brief-desktop.png` });

  const originalEvents = run.events.map((event) => ({ id: event.id, phase: event.phase, status: event.status }));
  const originalPostCount = runPosts;
  for (const speed of ['0.5', '1', '2']) {
    await page.locator(`[data-speed="${speed}"]`).click();
    await expect(page.locator(`[data-speed="${speed}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#replayButton').click();
  await page.waitForTimeout(450);
  await page.locator('#pauseReplay').click();
  const paused = Number(await page.locator('.event-row.selected').getAttribute('data-event-index'));
  await page.locator('#stepReplay').click();
  assert.equal(Number(await page.locator('.event-row.selected').getAttribute('data-event-index')), paused + 1);
  await page.locator('.event-row').last().click();
  await expect(page.locator('[data-workflow-phase="overall"]')).toHaveClass(/completed/);
  await expect(page.locator('[data-workflow-phase="review_gate"]')).toHaveClass(/skipped/);
  await expect(page.locator('[data-workflow-phase="human_review"]')).toHaveClass(/completed/);
  await expect(page.locator('[data-workflow-phase="save"]')).toHaveClass(/completed/);
  await expect(page.locator('.external-boundary')).toContainText('skipped');
  await expect(page.locator('.database-boundary')).toContainText('POSTGRESQL DATABASE');
  await page.locator('.event-timeline').evaluate((node) => { node.style.maxHeight = 'none'; node.style.overflow = 'visible'; });
  await scrollTop('.observatory');
  await page.locator('.observatory').screenshot({ path: `${output}/03-completed-workflow-desktop.png` });
  const runAfterReplay = await fetchRun(id);
  assert.deepEqual(runAfterReplay.events.map((event) => ({ id: event.id, phase: event.phase, status: event.status })), originalEvents);
  assert.equal(runPosts, originalPostCount, 'replay makes no new analysis request');
  record('PostgreSQL replay and execution diagram', `${run.events.length} stored events; all processing phases, human review, PostgreSQL saves and final success visible; replay made no analysis request.`);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['#workspace', '.bridge-panel', '.brief-panel', '.observatory']) {
    await scrollTop(selector);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${selector} has no mobile horizontal overflow`);
  }
  await scrollTop('#workspace');
  await page.screenshot({ path: `${output}/mobile-workspace-390px.png` });
  await page.locator('.bridge-panel').screenshot({ path: `${output}/mobile-evidence-bridge-390px.png` });
  await page.locator('.brief-panel').screenshot({ path: `${output}/mobile-career-brief-390px.png` });
  await page.locator('.observatory').evaluate((node) => { node.querySelector('.event-timeline').style.maxHeight = 'none'; node.querySelector('.event-timeline').style.overflow = 'visible'; });
  await page.locator('.observatory').screenshot({ path: `${output}/mobile-workflow-390px.png` });
  record('complete mobile experience', '390×844; intake, evidence graph, reviewed brief and replay diagram inspected without horizontal overflow.');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#newAnalysisTop').click();
  await page.locator('#loadExample').click();
  const inputBeforeFailure = await page.locator('.experience-entry textarea').nth(0).inputValue();
  await page.locator('#simulateFailure').check();
  await page.locator('#analyzeButton').click();
  await expect(page.locator('#runAlert')).toContainText('Simulated extraction failure', { timeout: 20000 });
  const failedId = await currentId();
  const failure = await fetchRun(failedId);
  assert.equal(failure.status, 'failed');
  const failedEvent = failure.events.find((event) => event.phase === 'extract' && event.status === 'failed');
  assert.ok(failedEvent && Number.isInteger(failedEvent.duration_ms) && failedEvent.duration_ms >= 0);
  assert.ok(failure.experience_text.some((item) => item.text === inputBeforeFailure));
  await expect(page.locator('#retryButton')).toBeVisible();
  await scrollTop('#workspace');
  await page.screenshot({ path: `${output}/04-simulated-failure.png` });
  record('simulated extraction failure', `Run ${failedId} records a visible error and ${failedEvent.duration_ms} ms failed extraction; submitted experience remains in PostgreSQL.`);

  await page.locator('#retryButton').click();
  await waitForReview();
  assert.equal(await page.locator('.experience-entry textarea').nth(0).inputValue(), inputBeforeFailure);
  const retryId = await currentId();
  await finishHumanReview();
  const recovered = await fetchRun(retryId);
  assert.equal(recovered.status, 'completed');
  assert.notEqual(recovered.id, failure.id);
  assert.ok(recovered.events.some((event) => event.phase === 'recovery' && event.detail.includes(failure.id)));
  assert.equal(recovered.experience_text[0].text, inputBeforeFailure);
  await expect(page.locator('#runAlert')).toContainText('Reviewed transition brief saved.');
  await page.locator('.event-timeline').evaluate((node) => { node.style.maxHeight = 'none'; node.style.overflow = 'visible'; });
  await page.locator('.event-row').filter({ hasText: 'Retry requested after a failed run' }).click();
  await expect(page.locator('[data-workflow-phase="recovery"]')).toHaveClass(/completed/);
  await expect(page.locator('#eventInspector')).toContainText(failure.id);
  await scrollTop('.observatory');
  await page.locator('.observatory').screenshot({ path: `${output}/05-failure-recovery-sequence.png` });
  await scrollTop('#workspace');
  await page.screenshot({ path: `${output}/06-successful-retry.png` });
  record('successful recovery', `New run ${recovered.id} succeeded, references failed run ${failure.id}, and preserves original input.`);

  assert.deepEqual(browserErrors, [], 'browser JavaScript errors');
  const result = {
    base,
    success: true,
    completedRunId: id,
    failureRunId: failedId,
    retryRunId: retryId,
    totalStoredEvents: run.events.length,
    classificationCounts: Object.fromEntries(['Direct Evidence', 'Transferable Evidence', 'Missing Evidence', 'Needs Clarification'].map((classification) => [classification, run.result.requirements.filter((requirement) => requirement.classification === classification).length])),
    recordedPhases: phases,
    screenshotFiles: [
      '01-evidence-bridge-desktop.png',
      '02-career-brief-desktop.png',
      '03-completed-workflow-desktop.png',
      '04-simulated-failure.png',
      '05-failure-recovery-sequence.png',
      '06-successful-retry.png',
      'mobile-workspace-390px.png',
      'mobile-evidence-bridge-390px.png',
      'mobile-career-brief-390px.png',
      'mobile-workflow-390px.png',
    ],
    checks,
    browserErrors,
  };
  await fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(`RESULTS ${JSON.stringify(result)}`);
} catch (error) {
  console.error(error);
  await page.screenshot({ path: `${output}/failure-diagnostic.png` }).catch(() => {});
  await fs.writeFile(`${output}/results.json`, JSON.stringify({ success: false, checks, browserErrors, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
