(() => {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const kind = (classification) => ({
    'Direct Evidence': 'direct',
    'Transferable Evidence': 'transferable',
    'Missing Evidence': 'missing',
    'Needs Clarification': 'clarification',
  })[classification] || 'clarification';
  let graphObserver;

  function renderEvidenceGraph(host, experiences, requirements, selectedId, onSelect) {
    graphObserver?.disconnect();
    if (!requirements.length) {
      host.innerHTML = '<p class="field-hint">Source-backed connections appear after extraction. Unsupported requirements will have no connecting line.</p>';
      return;
    }
    const sources = experiences.map((experience) => ({ id: experience.id, title: experience.title || 'Experience', label: 'EXPERIENCE' }));
    if (requirements.some((requirement) => requirement.evidence?.some((evidence) => evidence.sourceType === 'skill'))) {
      sources.push({ id: '__practiced-skills', title: 'Practiced skills', label: 'SKILLS YOU LISTED' });
    }
    host.innerHTML = `
      <div class="graph-column-labels"><span>YOUR SOURCES</span><span>ROLE REQUIREMENTS</span></div>
      <div class="evidence-graph">
        <svg class="graph-connectors" aria-label="Inspectable evidence connections"></svg>
        <div class="graph-sources">${sources.map((source) => `<button type="button" class="graph-source graph-node" data-source-id="${escape(source.id)}"><small>${escape(source.label)}</small><strong>${escape(source.title)}</strong></button>`).join('')}</div>
        <div class="graph-requirements">${requirements.map((requirement) => `<button type="button" class="graph-requirement graph-node ${kind(requirement.classification)} ${selectedId === requirement.id ? 'selected' : ''}" data-graph-requirement="${escape(requirement.id)}"><strong>${escape(requirement.name)}</strong><small>${escape(requirement.classification)}</small></button>`).join('')}</div>
      </div>
      <div class="graph-legend"><span class="direct">Direct</span><span class="transferable">Transferable</span><span class="clarification">Clarify</span><span class="missing">Missing = no link</span></div>`;
    const graph = host.querySelector('.evidence-graph');
    const svg = host.querySelector('svg');
    const sourceButtons = [...host.querySelectorAll('[data-source-id]')];
    const requirementButtons = [...host.querySelectorAll('[data-graph-requirement]')];
    for (const button of requirementButtons) button.addEventListener('click', () => onSelect(button.dataset.graphRequirement));
    for (const button of sourceButtons) {
      button.addEventListener('click', () => {
        const connected = requirements.find((requirement) => requirement.evidence?.some((evidence) => (evidence.sourceType === 'skill' ? '__practiced-skills' : evidence.experienceId) === button.dataset.sourceId));
        if (connected) onSelect(connected.id, connected.evidence.find((evidence) => (evidence.sourceType === 'skill' ? '__practiced-skills' : evidence.experienceId) === button.dataset.sourceId)?.id);
      });
    }
    const draw = () => {
      const bounds = graph.getBoundingClientRect();
      if (!bounds.width) return;
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      svg.replaceChildren();
      for (const requirement of requirements) {
        if (requirement.classification === 'Missing Evidence') continue;
        const target = requirementButtons.find((button) => button.dataset.graphRequirement === requirement.id);
        if (!target) continue;
        for (const evidence of requirement.evidence || []) {
          const connectionClassification = requirement.classification === 'Needs Clarification'
            ? requirement.classification
            : evidence.relation === 'transferable' ? 'Transferable Evidence' : requirement.classification;
          const sourceId = evidence.sourceType === 'skill' ? '__practiced-skills' : evidence.experienceId;
          const source = sourceButtons.find((button) => button.dataset.sourceId === sourceId);
          if (!source) continue;
          const start = source.getBoundingClientRect();
          const end = target.getBoundingClientRect();
          const x1 = start.right - bounds.left;
          const y1 = start.top + start.height / 2 - bounds.top;
          const x2 = end.left - bounds.left;
          const y2 = end.top + end.height / 2 - bounds.top;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`);
          path.setAttribute('class', `evidence-edge ${kind(connectionClassification)} ${selectedId === requirement.id ? 'selected' : ''}`);
          path.setAttribute('data-edge-requirement', requirement.id);
          path.setAttribute('tabindex', '0');
          path.setAttribute('role', 'button');
          path.setAttribute('aria-label', `${source.textContent.trim()} to ${requirement.name}: ${connectionClassification}`);
          path.addEventListener('click', () => onSelect(requirement.id, evidence.id));
          path.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(requirement.id, evidence.id); }
          });
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = `${requirement.name}: “${evidence.excerpt}”`;
          path.append(title);
          svg.append(path);
        }
      }
    };
    graphObserver = new ResizeObserver(draw);
    graphObserver.observe(graph);
    requestAnimationFrame(draw);
  }

  const steps = [
    ['receive', 'Receive evidence'],
    ['validate', 'Validate input'],
    ['retrieve', 'Retrieve posting'],
    ['extract', 'Extract requirements'],
    ['normalize', 'Normalize experience'],
    ['link', 'Build evidence links'],
    ['classify', 'Classify support'],
    ['brief', 'Generate career brief'],
  ];
  function renderWorkflow(host, events, index, onInspect) {
    const snapshot = events.slice(0, Math.max(0, index + 1));
    const latest = new Map(snapshot.map((event) => [event.phase, event]));
    const node = (phase, name, number) => {
      const event = latest.get(phase);
      const status = event?.status || 'waiting';
      const duration = event?.duration_ms == null ? '—' : `${event.duration_ms} ms`;
      return `<button type="button" class="workflow-node ${escape(status)}" data-workflow-phase="${phase}" ${event ? '' : 'disabled'}><span class="workflow-node-number">${number || '↗'}</span><strong>${escape(name)}</strong><small>${escape(status)} <span>${escape(duration)}</span></small></button>`;
    };
    host.innerHTML = `
      <div class="workflow-boundary-row">
        <section class="system-boundary browser-boundary"><h4>BROWSER <span>Input, review & recovery</span></h4>${node('recovery', 'Request retry', '↻')}${node('review_gate', 'Wait for human review', 'H?')}${node('human_review', 'Confirm evidence review', 'H')}</section>
        <section class="system-boundary external-boundary"><h4>EXTERNAL JOB WEBSITE <span>Optional network boundary</span></h4>${node('external_fetch', 'Read public job page', '↗')}</section>
        <section class="system-boundary database-boundary"><h4>POSTGRESQL DATABASE <span>Durable storage</span></h4>${node('save', 'Save draft / final brief', '09')}</section>
        <section class="system-boundary outcome-boundary"><h4>RUN OUTCOME <span>Persisted final status</span></h4>${node('overall', 'Analysis result', '✓')}</section>
      </div>
      <section class="system-boundary server-boundary"><h4>APPLICATION SERVER <span>Deterministic extraction · no AI service</span></h4><div class="server-steps">${steps.map(([phase, name], index) => node(phase, name, String(index + 1).padStart(2, '0'))).join('')}</div></section>
      <p class="workflow-caption">Browser → application server → optional website retrieval → PostgreSQL. Node state is reconstructed from the recorded event selected below.</p>`;
    for (const button of host.querySelectorAll('[data-workflow-phase]')) {
      button.addEventListener('click', () => {
        const phase = button.dataset.workflowPhase;
        let eventIndex = events.findLastIndex((event) => event.phase === phase && event.status !== 'running');
        if (eventIndex < 0) eventIndex = events.findLastIndex((event) => event.phase === phase);
        if (eventIndex >= 0) onInspect(eventIndex);
      });
    }
  }
  window.RivetDiagrams = { renderEvidenceGraph, renderWorkflow };
})();
