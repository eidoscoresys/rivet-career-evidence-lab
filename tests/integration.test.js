import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const experienceA = [
  {
    id: 'power-supplies',
    title: 'Equipment power-supply installation and testing',
    text: 'Installed and tested equipment power supplies. Measured voltage and continuity with a digital multimeter.',
  },
  {
    id: 'fault-diagnosis',
    title: 'Electrical fault diagnosis and repair',
    text: 'Diagnosed wiring-harness failures. Replaced defective electronic boards. Completed functional testing.',
  },
];
const facilitiesInput = {
  source: 'paste',
  description: [
    'Critical Facilities Technician',
    'Perform electrical troubleshooting and equipment maintenance.',
    'Familiarity with UPS systems is required.',
    'Generator knowledge is required.',
    'Cooling-system knowledge is required.',
  ].join('\n'),
  url: '',
  targetRole: 'Critical Facilities Technician',
  skills: '',
  experiences: experienceA,
  fault: null,
};

test('RIVET records reviewable evidence, failure recovery, replay, and PostgreSQL persistence', {
  timeout: 60_000,
}, async () => {
  assert.ok(databaseUrl, 'DATABASE_URL must point to the managed PostgreSQL database');
  const port = 34000 + Math.floor(Math.random() * 18000);
  const base = `http://127.0.0.1:${port}`;
  const createdRunIds = [];
  const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
  let proc;

  const startServer = async () => {
    proc = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    throw new Error('Server did not become healthy');
  };

  const stopServer = async () => {
    if (!proc || proc.exitCode !== null) return;
    const child = proc;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2500);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const makeRequest = (cookie) => async (pathname, options = {}) => {
    const response = await fetch(`${base}${pathname}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(cookie.value ? { cookie: cookie.value } : {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie.value = setCookie.split(';')[0];
    return response;
  };

  const waitForRun = async (request, id, expectedStatuses = ['awaiting_review', 'completed', 'failed']) => {
    for (let i = 0; i < 200; i++) {
      const response = await request(`/api/runs/${id}`);
      assert.equal(response.status, 200);
      const run = await response.json();
      if (expectedStatuses.includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Run ${id} did not reach an expected status`);
  };

  const submit = async (request, input) => {
    const response = await request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 202, (await response.clone().text()));
    const { id } = await response.json();
    createdRunIds.push(id);
    return id;
  };

  const confirmReview = async (request, id, corrections = []) => {
    const response = await request(`/api/runs/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acknowledgeReview: true, corrections }),
    });
    assert.equal(response.status, 202, await response.text());
    return waitForRun(request, id, ['completed', 'failed']);
  };

  const verifyCompletedSteps = (events, phases) => {
    for (const phase of phases) {
      assert.ok(events.some((event) => event.phase === phase && event.status === 'running'), `${phase} started`);
      const completed = events.find((event) => event.phase === phase && event.status === 'completed');
      assert.ok(completed, `${phase} completed`);
      assert.ok(Number.isInteger(completed.duration_ms) && completed.duration_ms >= 0, `${phase} has measured duration`);
      assert.ok(completed.message && completed.detail, `${phase} records its outcome and operation`);
    }
  };

  try {
    await startServer();
    const cookie = { value: '' };
    const request = makeRequest(cookie);
    const phases = ['receive', 'validate', 'retrieve', 'extract', 'normalize', 'link', 'classify', 'save'];

    const firstId = await submit(request, facilitiesInput);
    const draftRun = await waitForRun(request, firstId);
    assert.equal(draftRun.status, 'awaiting_review');
    assert.equal(draftRun.result.targetRole, facilitiesInput.targetRole);
    assert.equal(draftRun.result.requirements.length, 5);
    assert.deepEqual(
      new Set(draftRun.result.requirements.map((requirement) => requirement.classification)),
      new Set(['Direct Evidence', 'Transferable Evidence', 'Missing Evidence']),
    );
    const draftById = Object.fromEntries(draftRun.result.requirements.map((item) => [item.id, item]));
    assert.equal(draftById['electrical-troubleshooting'].classification, 'Direct Evidence');
    assert.equal(draftById['equipment-maintenance'].classification, 'Direct Evidence');
    assert.equal(draftById['ups-systems'].classification, 'Transferable Evidence');
    assert.equal(draftById.generators.classification, 'Missing Evidence');
    assert.equal(draftById['cooling-systems'].classification, 'Missing Evidence');
    assert.ok(draftById['electrical-troubleshooting'].evidence.some((item) => item.excerpt === 'Diagnosed wiring-harness failures.'));
    assert.ok(draftRun.events.some((event) => event.phase === 'external_fetch' && event.status === 'skipped'));
    verifyCompletedSteps(draftRun.events, phases);

    const missingAck = await request(`/api/runs/${firstId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ corrections: [] }),
    });
    assert.equal(missingAck.status, 400, 'brief generation is blocked without explicit human review acknowledgement');

    const unsupportedClaim = await request(`/api/runs/${firstId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acknowledgeReview: true,
        corrections: [{ requirementId: 'generators', classification: 'Direct Evidence' }],
      }),
    });
    assert.equal(unsupportedClaim.status, 400, 'unsupported direct claims cannot be made without a source quote');
    assert.equal((await (await request(`/api/runs/${firstId}`)).json()).status, 'awaiting_review');

    const firstCompleted = await confirmReview(request, firstId);
    assert.equal(firstCompleted.status, 'completed');
    assert.ok(firstCompleted.result.brief);
    const finalEvents = firstCompleted.events;
    verifyCompletedSteps(finalEvents, ['brief', 'save']);
    assert.ok(finalEvents.some((event) => event.phase === 'human_review' && event.status === 'completed' && event.duration_ms >= 0));
    assert.ok(finalEvents.some((event) => event.phase === 'overall' && event.status === 'completed'));
    assert.ok(finalEvents.every((event) => event.run_id === firstId));
    const finalBrief = firstCompleted.result.brief;
    assert.ok(finalBrief.directlySupported.some((item) => item.requirement === 'Electrical troubleshooting'));
    assert.ok(finalBrief.transferable.some((item) => item.requirement === 'UPS systems'));
    assert.deepEqual(new Set(finalBrief.missingOrUnverified.map((item) => item.requirement)), new Set(['Generators', 'Cooling systems']));
    for (const bullet of finalBrief.resumeBullets) {
      assert.ok(experienceA.some((entry) => entry.text.includes(bullet.text)), 'resume drafts quote submitted experience text verbatim');
    }
    const stream = await (await request(`/api/runs/${firstId}/events`)).text();
    assert.match(stream, /event: step/);
    assert.match(stream, /human_review/);
    assert.match(stream, /event: done/);

    const failedId = await submit(request, { ...facilitiesInput, fault: 'extract' });
    const failedRun = await waitForRun(request, failedId, ['failed']);
    assert.equal(failedRun.status, 'failed');
    assert.match(failedRun.error, /Simulated extraction failure/);
    assert.ok(failedRun.experience_text.length, 'failed runs retain the user-submitted evidence for retry');
    const failedExtract = failedRun.events.find((event) => event.phase === 'extract' && event.status === 'failed');
    assert.ok(failedExtract);
    assert.match(failedExtract.detail, /Your inputs are preserved/);
    assert.ok(Number.isInteger(failedExtract.duration_ms) && failedExtract.duration_ms >= 0);

    const retryId = await submit(request, { ...facilitiesInput, fault: null, retryOf: failedId });
    assert.equal((await waitForRun(request, retryId)).status, 'awaiting_review');
    const retryRun = await confirmReview(request, retryId);
    assert.equal(retryRun.status, 'completed');
    assert.ok(retryRun.events.some((event) => event.phase === 'recovery' && event.detail.includes(failedId)), 'retry records its verified recovery origin');
    assert.notEqual(retryRun.id, failedId);

    const secondInput = {
      source: 'paste',
      description: 'Software Engineer. Build Python data services, maintain PostgreSQL databases, deploy AWS cloud applications, and document automated tests.',
      url: '',
      targetRole: 'Software Engineer',
      skills: 'Python, PostgreSQL, AWS',
      experiences: [{
        id: 'data-services',
        title: 'Data service project',
        text: 'Built Python data services. Maintained PostgreSQL databases. Deployed AWS cloud applications. Documented automated tests.',
      }],
      fault: null,
    };
    const secondId = await submit(request, secondInput);
    const secondDraft = await waitForRun(request, secondId);
    assert.equal(secondDraft.status, 'awaiting_review');
    const secondCompleted = await confirmReview(request, secondId);
    assert.equal(secondCompleted.status, 'completed');
    assert.notDeepEqual(
      secondCompleted.result.brief.directlySupported.map((item) => item.excerpt),
      finalBrief.directlySupported.map((item) => item.excerpt),
    );

    const otherBrowser = await fetch(`${base}/api/runs/${firstId}`);
    assert.equal(otherBrowser.status, 404, 'run history is scoped to its owning browser session');

    await stopServer();
    await startServer();
    const persistedRun = await (await request(`/api/runs/${firstId}`)).json();
    assert.equal(persistedRun.status, 'completed');
    assert.equal(persistedRun.events.length, finalEvents.length);
    assert.equal(persistedRun.result.brief.resumeBullets.length, finalBrief.resumeBullets.length);
    assert.equal(persistedRun.events.find((event) => event.phase === 'extract' && event.status === 'completed').duration_ms >= 0, true);
    assert.equal(persistedRun.result.requirements.find((item) => item.id === 'ups-systems').classification, 'Transferable Evidence');
    const persistedFailure = await (await request(`/api/runs/${failedId}`)).json();
    assert.equal(persistedFailure.status, 'failed');
    assert.match(persistedFailure.events.find((event) => event.phase === 'extract' && event.status === 'failed').detail, /Simulated extraction failure/);
    const history = await (await request('/api/runs')).json();
    assert.deepEqual(new Set(history.runs.map((run) => run.id)), new Set(createdRunIds));
  } finally {
    await stopServer();
    if (createdRunIds.length) {
      await cleanupPool.query('DELETE FROM runs WHERE id = ANY($1::uuid[])', [createdRunIds]);
    }
    await cleanupPool.end();
  }
});
