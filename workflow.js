import { parseSkills } from './engine.js';
import {
  extractCareerRequirements,
  normalizeExperiences,
  buildEvidenceLinks,
  classifyRequirements,
  generateTransitionBrief,
} from './evidence-engine.js';

async function timed(stage, id, phase, title, work) {
  const started = performance.now();
  await stage(id, phase, 'running', `${title} started`);
  try {
    const result = await work();
    await stage(
      id,
      phase,
      'completed',
      `${title} completed`,
      result.detail || '',
      Math.max(0, Math.round(performance.now() - started)),
    );
    return result.value;
  } catch (error) {
    await stage(
      id,
      phase,
      'failed',
      `${title} failed`,
      String(error.message || 'Unknown error'),
      Math.max(0, Math.round(performance.now() - started)),
    );
    throw error;
  }
}

async function finishFailure(id, error, dependencies, result) {
  const message = String(error.message || 'Unknown error');
  await dependencies.finishRun(id, 'failed', { error: message, result });
  await dependencies.stage(id, 'overall', 'failed', 'Run stopped safely', message);
}

export async function processCareerDraft(id, data, dependencies) {
  const { stage, saveDraft, readURL } = dependencies;
  try {
    await timed(stage, id, 'receive', 'Receive experience evidence', async () => {
      if (!Array.isArray(data.experiences) || data.experiences.length === 0) {
        throw new Error('Add at least one real work experience or project.');
      }
      return {
        value: true,
        detail: `Received ${data.experiences.length} experience or project entries.`,
      };
    });

    await timed(stage, id, 'validate', 'Validate submitted inputs', async () => {
      if (data.source === 'paste' && data.description.trim().length < 100) {
        throw new Error('Paste at least 100 characters from a real job description.');
      }
      if (data.source === 'url' && !data.url.trim()) {
        throw new Error('Enter a job posting URL.');
      }
      if (data.experiences.some((item) => typeof item?.text !== 'string' || item.text.trim().length < 8)) {
        throw new Error('Each experience entry needs at least eight characters.');
      }
      return {
        value: true,
        detail: 'Checked source type, experience fields and input limits; practiced skills are optional.',
      };
    });

    const jobText = await timed(stage, id, 'retrieve', 'Retrieve the job posting', async () => {
      const text = data.source === 'url' ? await readURL(data.url) : data.description;
      if (data.source === 'paste') {
        await stage(id, 'external_fetch', 'skipped', 'External job-site fetch skipped', 'The user supplied the posting text directly.');
      }
      return {
        value: text,
        detail: data.source === 'url'
          ? `Retrieved ${text.length} readable characters from the public job page.`
          : `Read ${text.length} pasted characters; external fetch was correctly skipped.`,
      };
    });

    if (data.source === 'url') {
      await stage(id, 'external_fetch', 'completed', 'External job-site fetch completed', 'Retrieved readable public posting text; no site-side telemetry is available.');
    }

    const requirements = await timed(stage, id, 'extract', 'Extract role requirements', async () => {
      if (data.fault === 'extract') {
        throw new Error('Simulated extraction failure for resilience testing. Your inputs are preserved.');
      }
      const found = extractCareerRequirements(jobText);
      if (!found.length) {
        throw new Error('No recognized requirements were found. Paste a fuller posting with specific role requirements.');
      }
      return {
        value: found,
        detail: `Extracted ${found.length} requirements with source excerpts from the job posting.`,
      };
    });

    const experiences = await timed(stage, id, 'normalize', 'Normalize experience evidence', async () => {
      const normalized = normalizeExperiences(data.experiences);
      if (!normalized.length) throw new Error('No usable experience text was provided.');
      return {
        value: normalized,
        detail: `Normalized ${normalized.length} experience entries without adding claims.`,
      };
    });

    const links = await timed(stage, id, 'link', 'Build source-backed evidence links', async () => {
      const found = buildEvidenceLinks(requirements, experiences, data.skills);
      return {
        value: found,
        detail: `Linked ${found.length} exact source excerpts to role requirements; unsupported requirements remain unlinked.`,
      };
    });

    const draft = await timed(stage, id, 'classify', 'Classify evidence support', async () => {
      const classified = classifyRequirements(requirements, links);
      return {
        value: {
          targetRole: data.targetRole || 'Role described in the posting',
          method: 'Deterministic source-text matching. This is not an AI assessment or hiring prediction.',
          experiences,
          skills: parseSkills(data.skills),
          requirements: classified,
        },
        detail: `Classified ${classified.length} requirements as direct, transferable, missing, or needing clarification.`,
      };
    });

    await timed(stage, id, 'save', 'Save review draft', async () => {
      await saveDraft(id, draft);
      return {
        value: true,
        detail: 'Saved the evidence map and workflow events. Brief generation is paused until you review it.',
      };
    });
    await stage(id, 'review_gate', 'skipped', 'Waiting for human review', 'No career statements are generated until the user confirms the evidence classifications.');
    return draft;
  } catch (error) {
    await finishFailure(id, error, dependencies);
    return null;
  }
}

export async function processCareerReview(id, reviewedDraft, dependencies) {
  const { stage, finishRun } = dependencies;
  try {
    const brief = await timed(stage, id, 'brief', 'Generate the transition brief', async () => {
      const result = generateTransitionBrief(reviewedDraft);
      return {
        value: result,
        detail: `Prepared source-backed resume and interview suggestions for ${result.directlySupported.length} direct evidence links.`,
      };
    });
    const result = { ...reviewedDraft, brief, source: 'reviewed' };
    await timed(stage, id, 'save', 'Save the reviewed result', async () => {
      await finishRun(id, 'completed', { job_title: reviewedDraft.targetRole, result });
      return {
        value: true,
        detail: 'Persisted the reviewed brief and final workflow events to PostgreSQL.',
      };
    });
    await stage(id, 'overall', 'completed', 'Transition brief saved', 'Reviewed classifications and source excerpts are available for replay.');
    return result;
  } catch (error) {
    await finishFailure(id, error, dependencies, reviewedDraft);
    return null;
  }
}
