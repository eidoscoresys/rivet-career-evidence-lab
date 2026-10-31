const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const intakePanel = $('#intakePanel');
const workspace = $('#workspace');
const form = $('#analysisForm');
const experienceRows = $('#experienceRows');
const formMessage = $('#formMessage');
const runHistory = $('#runHistory');

let currentRun = null;
let savedRuns = [];
let events = [];
let selectedRequirementId = null;
let selectedEvidenceId = null;
let corrections = new Map();
let replayIndex = -1;
let replaySpeed = 1;
let replayPlaying = false;
let replayTimer = null;
let eventSource = null;
let lastSubmittedInput = null;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `exp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addExperience(title = '', text = '') {
  const id = newId();
  const row = document.createElement('article');
  row.className = 'experience-entry';
  row.dataset.experienceId = id;
  row.innerHTML = `
    <div class="experience-entry-header">
      <span>EXPERIENCE</span>
      <input type="text" maxlength="120" aria-label="Experience or project title" placeholder="Role, project, or task" value="${escapeHTML(title)}">
      <button type="button" aria-label="Remove this experience" title="Remove experience">×</button>
    </div>
    <textarea maxlength="8000" aria-label="Experience details" placeholder="Describe what you personally did, the tools you used, and the scope.">${escapeHTML(text)}</textarea>`;
  $('button', row).addEventListener('click', () => {
    if ($$('.experience-entry', experienceRows).length === 1) {
      $('input', row).value = '';
      $('textarea', row).value = '';
      return;
    }
    row.remove();
  });
  experienceRows.append(row);
}

function toggleIntake(show) {
  intakePanel.hidden = !show;
  workspace.hidden = show;
  $('#newAnalysisTop').hidden = show;
  if (show) intakePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setFormMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.classList.toggle('error', isError);
}

function selectedSource() {
  return $('input[name="source"]:checked')?.value || 'paste';
}

function updateSourceFields() {
  const paste = selectedSource() === 'paste';
  $('#pasteSource').hidden = !paste;
  $('#urlSource').hidden = paste;
}

function setExample() {
  experienceRows.replaceChildren();
  addExperience(
    'Equipment power-supply installation and testing',
    'Installed and tested equipment power supplies. Measured voltage and continuity with a digital multimeter.',
  );
  addExperience(
    'Electrical fault diagnosis and repair',
    'Diagnosed wiring-harness failures. Replaced defective electronic boards. Completed functional testing.',
  );
  $('#targetRole').value = 'Critical Facilities Technician';
  $('#skillsInput').value = '';
  $('#jobDescription').value = [
    'Critical Facilities Technician',
    'Perform electrical troubleshooting and equipment maintenance.',
    'Familiarity with UPS systems is required.',
    'Generator knowledge is required.',
    'Cooling-system knowledge is required.',
    'Follow facility safety procedures and document work performed.',
  ].join('\n');
  $('#jobUrl').value = '';
  $('#simulateFailure').checked = false;
  $('input[name="source"][value="paste"]').checked = true;
  updateSourceFields();
  setFormMessage('Illustrative example loaded. It contains no real user analysis or credentials.');
}

function collectInput() {
  const experiences = $$('.experience-entry', experienceRows).map((row, index) => ({
    id: row.dataset.experienceId || `experience-${index + 1}`,
    title: $('input', row).value.trim() || `Experience ${index + 1}`,
    text: $('textarea', row).value.trim(),
  })).filter((item) => item.text);
  return {
    source: selectedSource(),
    description: $('#jobDescription').value.trim(),
    url: $('#jobUrl').value.trim(),
    targetRole: $('#targetRole').value.trim(),
    skills: $('#skillsInput').value.trim(),
    experiences,
    fault: $('#simulateFailure').checked ? 'extract' : null,
  };
}

function validateInput(data) {
  if (!data.experiences.length) return 'Add at least one real work experience or project.';
  if (data.experiences.some((item) => item.text.length < 8)) return 'Each experience needs at least eight characters.';
  if (data.experiences.reduce((sum, item) => sum + item.text.length, 0) > 30000) return 'Experience text is limited to 30,000 characters.';
  if (data.source === 'paste' && data.description.length < 100) return 'Paste at least 100 characters from the job posting.';
  if (data.source === 'url' && !data.url) return 'Enter a public HTTPS job URL.';
  return '';
}

function savedInput(run) {
  let experiences = run.experience_text;
  if (typeof experiences === 'string') {
    try { experiences = JSON.parse(experiences); } catch { experiences = []; }
  }
  return {
    source: run.source || 'paste',
    description: run.input_text || '',
    url: run.input_url || '',
    targetRole: run.result?.targetRole || run.target_role || run.job_title || '',
    skills: run.skills || '',
    experiences: Array.isArray(experiences) ? experiences : [],
    fault: null,
  };
}

async function submitRun(data) {
  const issue = validateInput(data);
  if (issue) {
    setFormMessage(issue, true);
    return;
  }
  lastSubmittedInput = structuredClone(data);
  $('#analyzeButton').disabled = true;
  $('#analyzeButton').textContent = 'Saving inputs…';
  setFormMessage('Creating a private run and starting the recorded workflow.');
  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start this analysis.');
    corrections.clear();
    selectedRequirementId = null;
    events = [];
    replayIndex = -1;
    const placeholder = {
      id: result.id,
      status: 'running',
      job_title: data.targetRole || 'Analysis in progress',
      target_role: data.targetRole,
      source: data.source,
      input_text: data.source === 'paste' ? data.description : null,
      input_url: data.source === 'url' ? data.url : null,
      experience_text: data.experiences,
      skills: data.skills,
      result: null,
      error: null,
      events: [],
    };
    currentRun = placeholder;
    toggleIntake(false);
    renderRun(placeholder);
    await refreshHistory(result.id);
    connectEvents(result.id);
  } catch (error) {
    setFormMessage(error.message || 'Could not start this analysis.', true);
    if (!workspace.hidden) showRunAlert(error.message || 'Could not start this analysis.', 'failed');
  } finally {
    $('#analyzeButton').disabled = false;
    $('#analyzeButton').innerHTML = 'Map my evidence <span aria-hidden="true">→</span>';
  }
}

async function fetchRun(id) {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load this saved analysis.');
  return data;
}

async function openRun(id, { scroll = true } = {}) {
  stopReplay();
  eventSource?.close();
  eventSource = null;
  corrections.clear();
  selectedRequirementId = null;
  try {
    currentRun = await fetchRun(id);
    events = currentRun.events || [];
    replayIndex = events.length ? events.length - 1 : -1;
    toggleIntake(false);
    renderRun(currentRun);
    if (currentRun.status === 'running') connectEvents(id);
    if (scroll) workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showRunAlert(error.message, 'failed');
  }
}

function connectEvents(id) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  eventSource.addEventListener('step', (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    if (!event.id || events.some((item) => Number(item.id) === Number(event.id))) return;
    events.push(event);
    events.sort((a, b) => Number(a.id) - Number(b.id));
    if (!replayPlaying) replayIndex = events.length - 1;
    if (currentRun) currentRun.events = events;
    renderTimeline();
    renderRunStatus();
  });
  eventSource.addEventListener('done', async () => {
    eventSource?.close();
    eventSource = null;
    try {
      currentRun = await fetchRun(id);
      events = currentRun.events || events;
      replayIndex = events.length ? events.length - 1 : -1;
      renderRun(currentRun);
      await refreshHistory(id);
    } catch (error) {
      showRunAlert(error.message, 'failed');
    }
  });
}

async function refreshHistory(selectedId = currentRun?.id || '') {
  try {
    const response = await fetch('/api/runs', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load saved runs.');
    savedRuns = data.runs || [];
    renderHistory(selectedId);
  } catch (error) {
    console.warn('Run history unavailable:', error.message);
  }
}

function renderHistory(selectedId) {
  const prior = selectedId || runHistory.value;
  runHistory.innerHTML = savedRuns.map((run) => {
    const title = run.job_title || 'Untitled role';
    const status = statusLabel(run.status);
    const date = new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<option value="${escapeHTML(run.id)}">${escapeHTML(title)} · ${escapeHTML(status)} · ${escapeHTML(date)}</option>`;
  }).join('');
  const matched = savedRuns.find((run) => run.id === prior);
  runHistory.value = matched?.id || savedRuns[0]?.id || '';
  $('#emptyHistory').hidden = savedRuns.length > 0;
}

function statusLabel(status) {
  return ({
    running: 'Running',
    awaiting_review: 'Review',
    completed: 'Saved',
    failed: 'Failed',
  })[status] || status || 'Unknown';
}

function showRunAlert(message, state) {
  const box = $('#runAlert');
  box.textContent = message;
  box.className = `run-alert ${state || ''}`;
  box.hidden = !message;
}

function renderRunStatus() {
  if (!currentRun) return;
  const status = currentRun.status;
  const alertMessages = {
    running: ['Workflow is running. Each step and measured duration is being recorded.', ''],
    awaiting_review: ['Evidence map ready. Review classifications and source excerpts before generating statements.', 'completed'],
    completed: ['Reviewed transition brief saved. Its event history and source links can be replayed from this browser session.', 'completed'],
    failed: [`Analysis stopped: ${currentRun.error || 'An unexpected error occurred.'} Your inputs remain saved; retry or edit them before continuing.`, 'failed'],
  };
  const [message, state] = alertMessages[status] || ['', ''];
  showRunAlert(message, state);
  $('#retryButton').hidden = status !== 'failed';
  $('#pasteFallback').hidden = !(status === 'failed' && currentRun.source === 'url');
  $('#exportButton').hidden = status !== 'completed';
  $('#briefStatus').textContent = status === 'completed'
    ? 'REVIEWED · SAVED'
    : status === 'awaiting_review'
      ? 'HUMAN REVIEW'
      : status === 'running'
        ? 'WORKFLOW RUNNING'
        : status === 'failed'
          ? 'RUN FAILED'
          : 'DRAFT';
  $('#observatoryStatus').textContent = status === 'running'
    ? 'Live server events · each completed step stores its measured duration'
    : 'Persisted workflow events · select any step to inspect its details';
}

function getExperiences(run = currentRun) {
  if (run?.result?.experiences?.length) return run.result.experiences;
  let source = run?.experience_text;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = []; }
  }
  return Array.isArray(source) ? source : [];
}

function getRequirements(run = currentRun) {
  return run?.result?.requirements || [];
}

function effectiveRequirement(requirement) {
  if (!requirement) return null;
  const correction = corrections.get(requirement.id);
  if (!correction) return requirement;
  const classification = correction.classification || requirement.classification;
  let evidence = requirement.evidence || [];
  if (correction.evidenceExcerpt) {
    const source = getExperiences().find((item) => item.id === correction.experienceId);
    evidence = [{
      experienceId: source?.id,
      sourceTitle: source?.title || 'Submitted experience',
      sourceType: 'experience',
      excerpt: correction.evidenceExcerpt,
    }];
  }
  if (classification === 'Missing Evidence') evidence = [];
  else if (correction.classification && ['Direct Evidence', 'Transferable Evidence'].includes(classification)) {
    evidence = evidence.map((item) => ({ ...item, relation: classification === 'Direct Evidence' ? 'direct' : 'transferable' }));
  }
  return { ...requirement, classification, evidence };
}

function classificationClass(classification) {
  if (classification === 'Transferable Evidence') return 'transferable';
  if (classification === 'Needs Clarification') return 'clarification';
  if (classification === 'Missing Evidence') return 'missing';
  return 'direct';
}

function classificationShort(classification) {
  return ({
    'Direct Evidence': 'DIRECT',
    'Transferable Evidence': 'TRANSFER',
    'Missing Evidence': 'UNVERIFIED',
    'Needs Clarification': 'CLARIFY',
  })[classification] || 'REVIEW';
}

function getSelectedRequirement() {
  const requirements = getRequirements();
  return effectiveRequirement(requirements.find((item) => item.id === selectedRequirementId) || requirements[0] || null);
}

function renderVault() {
  const experiences = getExperiences();
  const run = currentRun;
  $('#vaultCount').textContent = `${String(experiences.length).padStart(2, '0')} SOURCE${experiences.length === 1 ? '' : 'S'}`;
  $('#vaultSources').innerHTML = experiences.length
    ? experiences.map((experience) => `
      <article class="source-summary">
        <span class="source-kind">Experience source · submitted</span>
        <strong>${escapeHTML(experience.title || 'Experience')}</strong>
        <p>${escapeHTML(experience.text || '')}</p>
      </article>`).join('')
    : '<p class="field-hint">No experience source was attached to this run.</p>';
  const requirements = getRequirements(run).map(effectiveRequirement);
  if (!selectedRequirementId && requirements.length) selectedRequirementId = requirements[0].id;
  if (!requirements.some((item) => item.id === selectedRequirementId)) selectedRequirementId = requirements[0]?.id || null;
  $('#requirementList').innerHTML = requirements.length
    ? requirements.map((item) => {
      const evidenceLabel = item.evidence?.[0]?.excerpt || 'No supporting excerpt found in submitted material';
      return `<button type="button" class="requirement-item ${item.id === selectedRequirementId ? 'selected' : ''}" data-requirement-id="${escapeHTML(item.id)}">
        <span><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(evidenceLabel)}</small></span>
        <span class="classification-chip ${classificationClass(item.classification)}">${classificationShort(item.classification)}</span>
      </button>`;
    }).join('')
    : '<p class="field-hint">Requirements will appear when extraction is complete.</p>';
  $$('.requirement-item', $('#requirementList')).forEach((button) => {
    button.addEventListener('click', () => {
      selectedRequirementId = button.dataset.requirementId;
      selectedEvidenceId = null;
      renderVault();
      renderBridge();
    });
  });
  window.RivetDiagrams.renderEvidenceGraph($('#evidenceGraph'), experiences, requirements, selectedRequirementId, (requirementId, evidenceId) => {
    selectedRequirementId = requirementId;
    selectedEvidenceId = evidenceId || null;
    renderVault();
    renderBridge();
  });
}

function evidenceOptions() {
  return getExperiences().flatMap((experience) => {
    const statements = String(experience.text || '').split(/(?<=[.!?])\s+|\n+/).map((text) => text.trim()).filter(Boolean);
    return statements.map((excerpt, index) => ({
      id: `${experience.id}:${index}`,
      experienceId: experience.id,
      title: experience.title || 'Experience',
      excerpt,
    }));
  });
}

function renderBridge() {
  const requirement = getSelectedRequirement();
  if (!requirement) {
    $('#bridgeMeta').textContent = currentRun?.status === 'running' ? 'Workflow in progress' : 'No extracted requirement yet';
    $('#bridgeDetails').innerHTML = '<div class="empty-state"><span class="empty-mark">R</span><h3>Every connection needs a source.</h3><p>The evidence bridge will display exact experience and job excerpts after requirement extraction.</p></div>';
    return;
  }
  const correction = corrections.get(requirement.id) || {};
  const classification = correction.classification || requirement.classification;
  const evidenceOptionsList = evidenceOptions();
  const originalEvidence = requirement.evidence?.find((item) => item.id === selectedEvidenceId)
    || requirement.evidence?.find((item) => item.relation === 'direct') || requirement.evidence?.[0];
  const connectionClassification = classification === 'Direct Evidence' && originalEvidence?.relation === 'transferable'
    ? 'Transferable Evidence' : classification;
  const connectionExplanation = connectionClassification !== classification
    ? 'This selected source is related, transferable evidence. A different source supports the overall requirement directly; this connection is not upgraded to direct evidence.'
    : correction.explanation || requirement.explanation || '';
  const selectedOption = correction.evidenceExcerpt
    ? evidenceOptionsList.find((item) => item.experienceId === correction.experienceId && item.excerpt === correction.evidenceExcerpt)
    : originalEvidence
      ? evidenceOptionsList.find((item) => item.experienceId === originalEvidence.experienceId && item.excerpt === originalEvidence.excerpt)
      : null;
  const roleExcerpt = requirement.postingExcerpt
    ? `<blockquote class="quote job">“${escapeHTML(requirement.postingExcerpt)}”</blockquote>`
    : '<div class="unverified">No exact job-posting excerpt was retained for this requirement.</div>';
  const evidenceMarkup = originalEvidence
    ? `<blockquote class="quote">“${escapeHTML(originalEvidence.excerpt)}”</blockquote><p class="field-hint">Source: ${escapeHTML(originalEvidence.sourceTitle)}${originalEvidence.sourceType === 'skill' ? ' · practiced skill you listed' : ''}</p>`
    : `<div class="unverified">No exact supporting excerpt was found in the submitted experience or practiced skills. This is missing / unverified, not proof that you lack the experience.</div>`;
  const editable = currentRun?.status === 'awaiting_review';
  const selectorMarkup = editable ? `
    <div class="review-edit">
      <label for="classificationChoice">Review overall requirement support
        <select id="classificationChoice" data-requirement-id="${escapeHTML(requirement.id)}">
          ${['Direct Evidence', 'Transferable Evidence', 'Needs Clarification', 'Missing Evidence'].map((value) => `<option value="${escapeHTML(value)}" ${value === classification ? 'selected' : ''}>${escapeHTML(value)}</option>`).join('')}
        </select>
      </label>
      ${['Direct Evidence', 'Transferable Evidence'].includes(classification) ? `
        <label for="evidenceChoice">Evidence excerpt ${originalEvidence ? '(optional correction)' : '(required)'}
          <select id="evidenceChoice" class="review-quote-select" data-requirement-id="${escapeHTML(requirement.id)}">
            <option value="">Keep the current source excerpt</option>
            ${evidenceOptionsList.map((item) => `<option value="${escapeHTML(item.id)}" ${item.id === selectedOption?.id ? 'selected' : ''}>${escapeHTML(item.title)} — ${escapeHTML(item.excerpt.slice(0, 110))}</option>`).join('')}
          </select>
        </label>
        ${!originalEvidence && !evidenceOptionsList.length ? '<p class="field-hint">Add a source excerpt in your experience, then edit the inputs.</p>' : ''}
      ` : ''}
    </div>` : '';

  $('#bridgeMeta').innerHTML = `SELECTED CONNECTION <span>· ${escapeHTML(classificationShort(connectionClassification))}</span>`;
  $('#bridgeDetails').innerHTML = `
    <div class="bridge-header">
      <div><h4>${escapeHTML(requirement.name)}</h4><div class="bridge-meta">Role requirement · source linked below</div></div>
      <span class="classification-chip ${classificationClass(connectionClassification)}">${escapeHTML(connectionClassification)}</span>
    </div>
    <div class="excerpt-label">Experience source · exact excerpt</div>
    ${evidenceMarkup}
    <div class="excerpt-label">Job posting · exact excerpt</div>
    ${roleExcerpt}
    <div class="detail-grid">
      <div class="detail-card"><strong>Why this label</strong><p>${escapeHTML(connectionExplanation)}</p></div>
      <div class="detail-card uncertainty"><strong>Uncertainty</strong><p>${escapeHTML(requirement.uncertainty || 'Review scope and context before using this claim.')}</p></div>
    </div>
    ${selectorMarkup}`;

  $('#classificationChoice')?.addEventListener('change', (event) => {
    const current = corrections.get(requirement.id) || {};
    current.classification = event.target.value;
    corrections.set(requirement.id, current);
    renderVault();
    renderBridge();
  });
  $('#evidenceChoice')?.addEventListener('change', (event) => {
    const selected = evidenceOptionsList.find((item) => item.id === event.target.value);
    const current = corrections.get(requirement.id) || {};
    if (selected) {
      current.evidenceExcerpt = selected.excerpt;
      current.experienceId = selected.experienceId;
    } else {
      delete current.evidenceExcerpt;
      delete current.experienceId;
    }
    corrections.set(requirement.id, current);
    renderVault();
    renderBridge();
  });
}

function renderBrief() {
  const panel = $('#briefContent');
  const run = currentRun;
  const draft = run?.result;
  const brief = draft?.brief;
  if (run?.status !== 'completed' || !brief) {
    panel.innerHTML = `
      <div class="brief-role">${escapeHTML(draft?.targetRole || run?.job_title || 'Role under consideration')}</div>
      <div class="brief-subtitle">Requirements sourced from the supplied job posting</div>
      <p class="brief-evidence-note">${escapeHTML(draft?.method || 'Source text is extracted and mapped using deterministic matching.')}</p>
      <div class="brief-lock"><strong>${run?.status === 'awaiting_review' ? 'HUMAN REVIEW REQUIRED' : run?.status === 'failed' ? 'ANALYSIS NOT COMPLETE' : 'BRIEF GENERATION LOCKED'}</strong>
        ${run?.status === 'awaiting_review'
          ? 'Review the evidence classifications and excerpts. No resume or interview statement is generated until you confirm the review.'
          : run?.status === 'failed'
            ? 'The failed run is saved. Retry its original input or edit it before generating a transition brief.'
            : 'A source-backed opportunity brief appears here after all workflow steps complete and evidence is reviewed.'}
      </div>`;
    $('#reviewGate').hidden = run?.status !== 'awaiting_review';
    $('#reviewAcknowledged').checked = false;
    $('#generateBrief').disabled = true;
    return;
  }

  $('#reviewGate').hidden = true;
  const direct = brief.directlySupported || [];
  const transferable = brief.transferable || [];
  const gaps = brief.missingOrUnverified || [];
  const nextActions = brief.nextActions || [];
  panel.innerHTML = `
    <div class="brief-role">${escapeHTML(brief.targetRole || draft.targetRole || 'Target role')}</div>
    <div class="brief-subtitle">Reviewed career transition brief · no hiring score</div>
    <p class="brief-evidence-note">Each supported suggestion cites text you submitted. The matching method is deterministic and is not an AI assessment.</p>
    ${direct.length ? `<section class="brief-block"><h4>Directly supported</h4><ul class="brief-list">${direct.map((item) => `<li>${escapeHTML(item.requirement)}<blockquote>“${escapeHTML(item.excerpt)}”</blockquote></li>`).join('')}</ul></section>` : ''}
    ${transferable.length ? `<section class="brief-block"><h4>Transferable evidence · not direct qualification</h4><ul class="brief-list">${transferable.map((item) => `<li class="transfer">${escapeHTML(item.requirement)}<blockquote>“${escapeHTML(item.excerpt)}” — ${escapeHTML(item.explanation)}</blockquote></li>`).join('')}</ul></section>` : ''}
    ${brief.resumeBullets?.length ? `<section class="brief-block"><h4>Resume bullet drafts</h4><ul class="brief-list">${brief.resumeBullets.map((item) => `<li>${escapeHTML(item.text)}<blockquote>${escapeHTML(item.note)}</blockquote></li>`).join('')}</ul></section>` : ''}
    ${brief.interviewTalkingPoints?.length ? `<section class="brief-block"><h4>Interview talking points</h4><ul class="brief-list">${brief.interviewTalkingPoints.map((item) => `<li>${escapeHTML(item.requirement)}<blockquote>${escapeHTML(item.prompt)}</blockquote></li>`).join('')}</ul></section>` : ''}
    ${gaps.length ? `<section class="brief-block"><h4>Missing or needs clarification</h4><div class="brief-missing">${gaps.map((item) => `<div><b>${escapeHTML(item.requirement)}</b> · ${escapeHTML(item.classification)} — ${escapeHTML(item.reason)}</div>`).join('<br>')}</div></section>` : ''}
    ${nextActions.length ? `<section class="brief-block"><h4>Practical next steps</h4><div class="brief-next">${nextActions.map((item, index) => `<div class="brief-next-item"><b>${String(index + 1).padStart(2, '0')}</b><span><strong>${escapeHTML(item.requirement)}:</strong> ${escapeHTML(item.action)}</span></div>`).join('')}</div></section>` : ''}
    <p class="brief-guardrail">${escapeHTML(brief.caveat || 'Evidence is limited to what you submitted. Transferable experience does not establish direct qualification or certification.')}</p>`;
}

function renderRun(run) {
  currentRun = run;
  const draft = run.result;
  $('#workspaceTitle').textContent = draft?.targetRole || run.job_title || `Run ${String(run.id).slice(0, 8)}`;
  renderRunStatus();
  renderVault();
  renderBridge();
  renderBrief();
  events = run.events || events;
  renderTimeline();
}

function formatDuration(duration) {
  if (duration === null || duration === undefined || duration === '') return '—';
  const value = Number(duration);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.max(0, Math.round(value))} ms`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'time unavailable' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderTimeline() {
  const timeline = $('#eventTimeline');
  window.RivetDiagrams.renderWorkflow($('#workflowDiagram'), events, replayIndex, (eventIndex) => {
    pauseReplay();
    replayIndex = eventIndex;
    renderTimeline();
  });
  $('#eventCount').textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  if (!events.length) {
    timeline.innerHTML = '<p class="field-hint">Waiting for persisted workflow events…</p>';
    $('#eventInspector').innerHTML = '<strong>No events yet</strong><span>Events appear here as the server records each step.</span>';
    return;
  }
  if (replayIndex < 0 || replayIndex >= events.length) replayIndex = events.length - 1;
  timeline.innerHTML = events.map((event, index) => `
    <button type="button" class="event-row ${escapeHTML(event.status || '')} ${index === replayIndex ? 'selected' : ''}" data-event-index="${index}">
      <span class="event-bullet">${event.status === 'failed' ? '!' : event.status === 'skipped' ? '–' : event.status === 'running' ? '…' : '✓'}</span>
      <span class="event-main"><strong>${escapeHTML(event.message || event.phase)}</strong><small>${escapeHTML(event.phase || 'workflow')} · ${escapeHTML(formatTime(event.at))}</small></span>
      <span class="event-detail">${escapeHTML(event.detail || 'No additional detail was recorded.')}</span>
      <span class="event-status">${escapeHTML(event.status || 'unknown')}</span>
      <span class="event-duration">${formatDuration(event.duration_ms)}</span>
    </button>`).join('');
  $$('.event-row', timeline).forEach((button) => button.addEventListener('click', () => {
    pauseReplay();
    replayIndex = Number(button.dataset.eventIndex);
    renderTimeline();
  }));
  const selected = events[replayIndex];
  $('#eventInspector').innerHTML = `<strong>${escapeHTML(selected.message || selected.phase)}</strong><span>${escapeHTML(selected.detail || 'No additional detail was recorded.')} · ${escapeHTML(formatDuration(selected.duration_ms))} · ${escapeHTML(formatTime(selected.at))}</span>`;
}

function scheduleReplayTick() {
  clearTimeout(replayTimer);
  if (!replayPlaying || replayIndex >= events.length - 1) {
    if (replayIndex >= events.length - 1) replayPlaying = false;
    return;
  }
  const now = Date.parse(events[replayIndex]?.at);
  const next = Date.parse(events[replayIndex + 1]?.at);
  const gap = Number.isFinite(now) && Number.isFinite(next) ? Math.max(0, next - now) : 0;
  const delay = Math.min(2200, Math.max(320, gap / replaySpeed));
  replayTimer = setTimeout(() => {
    replayIndex = Math.min(replayIndex + 1, events.length - 1);
    renderTimeline();
    scheduleReplayTick();
  }, delay);
}

function startReplay() {
  if (!events.length) return;
  if (replayIndex >= events.length - 1) replayIndex = 0;
  replayPlaying = true;
  renderTimeline();
  scheduleReplayTick();
}

function pauseReplay() {
  replayPlaying = false;
  clearTimeout(replayTimer);
}

function stopReplay() {
  pauseReplay();
  replayIndex = -1;
}

function renderInput(run) {
  const data = savedInput(run);
  experienceRows.replaceChildren();
  (data.experiences.length ? data.experiences : [{ title: '', text: '' }]).forEach((item) => addExperience(item.title, item.text));
  $('#skillsInput').value = data.skills;
  $('#targetRole').value = data.targetRole === 'Role described in the posting' ? '' : data.targetRole;
  $('#jobDescription').value = data.description;
  $('#jobUrl').value = data.url;
  $('input[name="source"][value="url"]').checked = data.source === 'url';
  $('input[name="source"][value="paste"]').checked = data.source !== 'url';
  $('#simulateFailure').checked = false;
  updateSourceFields();
  setFormMessage('Inputs were restored from your saved run. Review or edit them before retrying.');
}

function correctionsForSubmission() {
  return [...corrections.entries()].flatMap(([requirementId, value]) => {
    const requirement = getRequirements().find((item) => item.id === requirementId);
    if (!requirement) return [];
    const classification = value.classification || requirement.classification;
    const correction = { requirementId, classification };
    const original = requirement.evidence?.[0];
    if (value.evidenceExcerpt && (value.evidenceExcerpt !== original?.excerpt || value.experienceId !== original?.experienceId)) {
      correction.evidenceExcerpt = value.evidenceExcerpt;
      correction.experienceId = value.experienceId;
    }
    if (classification !== requirement.classification || correction.evidenceExcerpt) return [correction];
    return [];
  });
}

async function submitReview() {
  if (!currentRun || currentRun.status !== 'awaiting_review') return;
  if (!$('#reviewAcknowledged').checked) return;
  const button = $('#generateBrief');
  button.disabled = true;
  button.textContent = 'Saving your review…';
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(currentRun.id)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acknowledgeReview: true,
        corrections: correctionsForSubmission(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your review.');
    currentRun.status = 'running';
    renderRunStatus();
    renderBrief();
    events = currentRun.events || events;
    renderTimeline();
    connectEvents(currentRun.id);
  } catch (error) {
    showRunAlert(error.message || 'Could not save your review.', 'failed');
    button.disabled = false;
    button.innerHTML = 'Confirm review &amp; build brief <span aria-hidden="true">→</span>';
  }
}

function briefAsText() {
  const brief = currentRun?.result?.brief;
  if (!brief) return '';
  const sections = [
    `RIVET Career Transition Brief — ${brief.targetRole}`,
    '',
    'DIRECTLY SUPPORTED',
    ...(brief.directlySupported || []).map((item) => `• ${item.requirement}: “${item.excerpt}”`),
    '',
    'TRANSFERABLE EVIDENCE (NOT DIRECT QUALIFICATION)',
    ...(brief.transferable || []).map((item) => `• ${item.requirement}: “${item.excerpt}” — ${item.explanation}`),
    '',
    'RESUME BULLET DRAFTS',
    ...(brief.resumeBullets || []).map((item) => `• ${item.text}`),
    '',
    'INTERVIEW TALKING POINTS',
    ...(brief.interviewTalkingPoints || []).map((item) => `• ${item.requirement}: ${item.prompt}`),
    '',
    'MISSING OR NEEDS CLARIFICATION',
    ...(brief.missingOrUnverified || []).map((item) => `• ${item.requirement} (${item.classification}): ${item.reason}`),
    '',
    'PRACTICAL NEXT STEPS',
    ...(brief.nextActions || []).map((item, index) => `${index + 1}. ${item.requirement}: ${item.action}`),
    '',
    brief.caveat || '',
    '',
    'Generated from user-submitted evidence. Review all statements before using.',
  ];
  return sections.join('\n');
}

function downloadBrief() {
  const content = briefAsText();
  if (!content) return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `rivet-career-transition-${Date.now()}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

$('#addExperience').addEventListener('click', () => addExperience());
$('#loadExample').addEventListener('click', setExample);
$$('input[name="source"]').forEach((radio) => radio.addEventListener('change', updateSourceFields));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitRun(collectInput());
});
$('#editInputs').addEventListener('click', () => {
  if (currentRun) renderInput(currentRun);
  toggleIntake(true);
});
$('#pasteFallback').addEventListener('click', () => {
  if (!currentRun) return;
  renderInput(currentRun);
  $('input[name="source"][value="paste"]').checked = true;
  updateSourceFields();
  setFormMessage('Your experience and skills are preserved. Paste the job description to continue without contacting the blocked website.');
  toggleIntake(true);
  $('#jobDescription').focus();
});
$('#newAnalysisTop').addEventListener('click', () => {
  eventSource?.close();
  eventSource = null;
  currentRun = null;
  corrections.clear();
  selectedRequirementId = null;
  experienceRows.replaceChildren();
  addExperience();
  form.reset();
  updateSourceFields();
  setFormMessage('Add one or more real experiences and a job posting to create a new evidence map.');
  toggleIntake(true);
});
$('#retryButton').addEventListener('click', () => {
  if (currentRun) submitRun({ ...savedInput(currentRun), retryOf: currentRun.id });
  else if (lastSubmittedInput) submitRun({ ...lastSubmittedInput, fault: null });
});
runHistory.addEventListener('change', () => {
  if (runHistory.value) openRun(runHistory.value);
});
$('#reviewAcknowledged').addEventListener('change', (event) => {
  $('#generateBrief').disabled = !event.target.checked;
});
$('#generateBrief').addEventListener('click', submitReview);
$('#exportButton').addEventListener('click', downloadBrief);
$('#replayButton').addEventListener('click', startReplay);
$('#pauseReplay').addEventListener('click', pauseReplay);
$('#stepReplay').addEventListener('click', () => {
  if (!events.length) return;
  pauseReplay();
  replayIndex = Math.min(replayIndex + 1, events.length - 1);
  renderTimeline();
});
$$('[data-speed]').forEach((button) => button.addEventListener('click', () => {
  replaySpeed = Number(button.dataset.speed);
  $$('[data-speed]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  if (replayPlaying) scheduleReplayTick();
}));

addExperience();
updateSourceFields();
refreshHistory().then(() => {
  if (savedRuns.length) openRun(savedRuns[0].id, { scroll: false });
});
