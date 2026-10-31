import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to connect MatchMap to its managed PostgreSQL database.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL connection error:', error.message);
});

export async function createRun(run) {
  await pool.query(
    `INSERT INTO runs
      (id, owner, created_at, source, target_role, input_url, input_text, experience_text, skills, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running')`,
    [
      run.id, run.owner, run.created_at, run.source, run.target_role, run.input_url,
      run.input_text, run.experience_text, run.skills,
    ],
  );
}

export async function logEvent(id, phase, status, message, detail = '', duration_ms = null) {
  const result = await pool.query(
    `INSERT INTO events (run_id, at, phase, status, message, detail, duration_ms)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6)
     RETURNING id, at`,
    [id, phase, status, message, detail, duration_ms],
  );
  return { id: Number(result.rows[0].id), at: result.rows[0].at.toISOString() };
}

export async function finishRun(id, status, patch = {}) {
  await pool.query(
    `UPDATE runs
       SET status = $1, job_title = COALESCE($2, job_title),
           result = COALESCE($3, result), error = $4, ended_at = NOW()
     WHERE id = $5`,
    [
      status,
      patch.job_title || null,
      patch.result === undefined ? null : JSON.stringify(patch.result),
      patch.error || null,
      id,
    ],
  );
}

export async function saveDraft(id, draft) {
  const result = await pool.query(
    `UPDATE runs SET status = 'awaiting_review', job_title = $1, result = $2, ended_at = NULL
       WHERE id = $3 AND status = 'running'`,
    [draft.targetRole, JSON.stringify(draft), id],
  );
  if (result.rowCount !== 1) throw new Error('The draft could not be saved for review.');
}

export async function beginReview(id, durationMs, correctionCount) {
  const result = await pool.query(
    `WITH updated AS (
       UPDATE runs SET status = 'running'
        WHERE id = $1 AND status = 'awaiting_review'
        RETURNING id
     )
     INSERT INTO events (run_id, at, phase, status, message, detail, duration_ms)
     SELECT id, NOW(), 'human_review', 'completed',
            'User reviewed evidence classifications', $2, $3
       FROM updated
     RETURNING id, run_id, at, phase, status, message, detail, duration_ms`,
    [
      id,
      `${correctionCount} correction${correctionCount === 1 ? '' : 's'} applied; elapsed time at the review gate recorded.`,
      durationMs,
    ],
  );
  const event = result.rows[0];
  return event ? {
    ...event,
    id: Number(event.id),
    at: event.at.toISOString(),
  } : null;
}

export async function getRun(id, owner) {
  const result = await pool.query(
    `SELECT id, created_at, source, target_role, status, job_title, result, error, ended_at,
            input_url, input_text, experience_text, skills
       FROM runs WHERE id = $1 AND owner = $2`,
    [id, owner],
  );
  const run = result.rows[0];
  if (!run) return null;
  let experienceEntries = [];
  try {
    experienceEntries = run.experience_text ? JSON.parse(run.experience_text) : [];
  } catch {
    experienceEntries = [];
  }
  return {
    ...run,
    experience_text: experienceEntries,
    result: run.result ? JSON.parse(run.result) : null,
  };
}

export async function fullRun(id) {
  const result = await pool.query('SELECT * FROM runs WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getEvents(id) {
  const result = await pool.query(
    `SELECT id, run_id, at, phase, status, message, detail, duration_ms
       FROM events WHERE run_id = $1 ORDER BY id`,
    [id],
  );
  return result.rows.map((event) => ({ ...event, id: Number(event.id) }));
}

export async function listRuns(owner) {
  const result = await pool.query(
    `SELECT id, created_at, source, target_role, status, COALESCE(job_title, target_role) AS job_title,
            result, error, ended_at
       FROM runs WHERE owner = $1 ORDER BY created_at DESC LIMIT 30`,
    [owner],
  );
  return result.rows.map((run) => ({
    ...run,
    result: run.result ? JSON.parse(run.result) : null,
  }));
}

export async function recoverInterruptedRuns() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interrupted = await client.query(
      `SELECT id FROM runs WHERE status = 'running' FOR UPDATE`,
    );
    const message = 'The server restarted during this analysis. Retry the run.';
    for (const run of interrupted.rows) {
      await client.query(
        `UPDATE runs SET status = 'failed', error = $1, ended_at = NOW() WHERE id = $2`,
        [message, run.id],
      );
      await client.query(
        `INSERT INTO events (run_id, at, phase, status, message, detail)
         VALUES ($1, NOW(), 'overall', 'failed', 'Interrupted run recovered', $2)`,
        [run.id, message],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function recentCount(owner) {
  const result = await pool.query(
    `SELECT COUNT(*)::integer AS count FROM runs
       WHERE owner = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
    [owner],
  );
  return result.rows[0].count;
}

export async function closeStore() {
  await pool.end();
}
