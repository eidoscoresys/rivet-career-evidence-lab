import { TERMS, parseSkills } from './engine.js';

const REQUIREMENT_CONCEPTS = [
  {
    id: 'electrical-troubleshooting',
    name: 'Electrical troubleshooting',
    postingAliases: ['electrical troubleshooting', 'electrical diagnostics', 'electrical fault finding'],
    directCues: ['electrical troubleshooting', 'diagnosed wiring', 'wiring harness', 'troubleshoot electrical'],
    transferableCues: ['electrical testing', 'voltage', 'continuity', 'multimeter', 'digital multimeter'],
    nextStep: 'Document the types of electrical faults you diagnosed, the checks you performed, and the equipment scope.',
  },
  {
    id: 'equipment-maintenance',
    name: 'Equipment maintenance',
    postingAliases: ['equipment maintenance', 'maintain equipment', 'maintaining equipment', 'equipment servicing'],
    directCues: ['equipment maintenance', 'installed and tested equipment', 'replaced defective', 'functional testing', 'equipment repair'],
    transferableCues: ['hardware testing', 'electronics repair', 'mechanical assembly'],
    nextStep: 'Compare the posting’s maintenance tasks with work you have actually performed; list only verified tasks.',
  },
  {
    id: 'ups-systems',
    name: 'UPS systems',
    postingAliases: ['uninterruptible power supply', 'ups systems', 'ups familiarity', 'ups'],
    directCues: ['uninterruptible power supply', 'ups system', 'ups systems'],
    transferableCues: ['equipment power supplies', 'power supplies', 'voltage', 'continuity', 'multimeter'],
    nextStep: 'Seek supervised UPS orientation and record the exact hands-on scope before claiming direct UPS experience.',
  },
  {
    id: 'generators',
    name: 'Generators',
    postingAliases: ['backup generators', 'backup generator', 'generator knowledge', 'generator maintenance', 'generators', 'generator'],
    directCues: ['generator', 'generators'],
    transferableCues: [],
    nextStep: 'Look for supervised generator inspection or maintenance training, then document only procedures you personally complete.',
  },
  {
    id: 'cooling-systems',
    name: 'Cooling systems',
    postingAliases: ['cooling-system knowledge', 'cooling systems', 'cooling system', 'data-center hvac', 'data center hvac', 'hvac'],
    directCues: ['cooling system', 'hvac', 'crac', 'chiller'],
    transferableCues: [],
    nextStep: 'Request a qualified facility orientation to its cooling systems; do not describe this as HVAC experience until verified.',
  },
  {
    id: 'data-center-operations',
    name: 'Data center operations',
    postingAliases: ['data center operations', 'data centre operations', 'data center experience', 'data centre experience'],
    directCues: ['data center', 'data centre', 'datacenter'],
    transferableCues: [],
    nextStep: 'Learn the facility’s operating procedures through an authorized orientation before claiming data-center experience.',
  },
];

const CLASSIFICATIONS = new Set([
  'Direct Evidence',
  'Transferable Evidence',
  'Missing Evidence',
  'Needs Clarification',
]);

const VAGUE_CLAIM = /\b(familiar with|exposure to|worked around|helped with|some experience|knowledge of)\b/i;

function phraseMatches(text, phrase) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  const source = ` ${normalize(text)} `;
  const target = ` ${normalize(phrase)} `;
  return target.trim().length > 0 && source.includes(target);
}

function splitEvidence(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function excerptMatching(text, cues) {
  return splitEvidence(text).find((sentence) =>
    cues.some((cue) => phraseMatches(sentence, cue)),
  ) || null;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findPostingExcerpt(text, aliases) {
  return splitEvidence(text).find((sentence) =>
    aliases.some((alias) => phraseMatches(sentence, alias)),
  ) || null;
}

export function normalizeExperiences(experiences) {
  if (!Array.isArray(experiences)) return [];
  return experiences.slice(0, 20).map((experience, index) => ({
    id: String(experience?.id || `experience-${index + 1}`).slice(0, 80),
    title: String(experience?.title || `Experience ${index + 1}`).trim().slice(0, 120),
    text: String(experience?.text || '').trim().slice(0, 8_000),
  })).filter((experience) => experience.text);
}

function listRequirements(jobText) {
  const requirements = [];

  for (const concept of REQUIREMENT_CONCEPTS) {
    const postingExcerpt = findPostingExcerpt(jobText, concept.postingAliases);
    if (postingExcerpt) {
      requirements.push({
        id: concept.id,
        name: concept.name,
        postingExcerpt: postingExcerpt.slice(0, 280),
        _concept: concept,
      });
    }
  }

  for (const requirement of TERMS.flatMap(([name, aliases]) => {
    const postingExcerpt = findPostingExcerpt(jobText, aliases);
    return postingExcerpt ? [{ name, aliases, postingExcerpt }] : [];
  })) {
    const representedByConcept = REQUIREMENT_CONCEPTS.some((concept) =>
      concept.postingAliases.some((alias) =>
        phraseMatches(requirement.postingExcerpt, alias),
      ),
    );
    if (representedByConcept) continue;
    const id = `skill-${slugify(requirement.name)}`;
    if (requirements.some((entry) => entry.id === id)) continue;
    requirements.push({
      id,
      name: requirement.name,
      postingExcerpt: requirement.postingExcerpt.slice(0, 280),
      _directCues: [requirement.name, ...requirement.aliases],
    });
  }

  return requirements
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ _concept, _directCues, ...requirement }) => ({
      ...requirement,
      directCues: _concept?.directCues || _directCues || [requirement.name],
      transferableCues: _concept?.transferableCues || [],
      nextStep: _concept?.nextStep || `Review the posting requirement “${requirement.name}” and identify a real example before describing it as experience.`,
    }));
}

function evidenceCandidates(requirement, experiences, skills) {
  const candidates = [];
  for (const experience of experiences) {
    const directExcerpt = excerptMatching(experience.text, requirement.directCues);
    if (directExcerpt) {
      candidates.push({
        id: `${experience.id}:direct`,
        experienceId: experience.id,
        sourceTitle: experience.title,
        sourceType: 'experience',
        excerpt: directExcerpt.slice(0, 320),
        relation: 'direct',
      });
      continue;
    }
    const transferableExcerpt = excerptMatching(experience.text, requirement.transferableCues);
    if (transferableExcerpt) {
      candidates.push({
        id: `${experience.id}:transfer`,
        experienceId: experience.id,
        sourceTitle: experience.title,
        sourceType: 'experience',
        excerpt: transferableExcerpt.slice(0, 320),
        relation: 'transferable',
      });
    }
  }

  if (!candidates.length) {
    const skill = skills.find((entry) =>
      requirement.directCues.some((cue) => phraseMatches(entry, cue))
      || phraseMatches(entry, requirement.name),
    );
    if (skill) {
      candidates.push({
        id: `skill:${slugify(skill)}`,
        experienceId: null,
        sourceTitle: 'Practiced skills you listed',
        sourceType: 'skill',
        excerpt: skill,
        relation: 'direct',
      });
    }
  }

  return candidates.slice(0, 4);
}

function classificationFor(candidates) {
  if (!candidates.length) return 'Missing Evidence';
  const direct = candidates.filter((candidate) => candidate.relation === 'direct');
  const strongest = direct.length ? direct : candidates;
  const vague = strongest.some((candidate) => VAGUE_CLAIM.test(candidate.excerpt));
  if (vague) return 'Needs Clarification';
  return direct.length ? 'Direct Evidence' : 'Transferable Evidence';
}

function explanationFor(classification, candidates, name) {
  const preferred = classification === 'Direct Evidence'
    ? candidates.find((item) => item.relation === 'direct')
    : classification === 'Transferable Evidence'
      ? candidates.find((item) => item.relation === 'transferable')
      : candidates[0];
  const excerpt = preferred?.excerpt;
  if (classification === 'Direct Evidence') {
    return `Your submitted material directly states: “${excerpt}”`;
  }
  if (classification === 'Transferable Evidence') {
    return `This related experience may transfer to ${name}, but it does not establish direct experience with that system: “${excerpt}”`;
  }
  if (classification === 'Needs Clarification') {
    return `Your note mentions related experience, but its scope is unclear: “${excerpt}”`;
  }
  return `No matching evidence was found in the experiences or practiced skills you submitted for ${name}.`;
}

export function extractCareerRequirements(jobText) {
  return listRequirements(jobText);
}

export function buildEvidenceLinks(requirements, experiences, skills = '') {
  const parsedSkills = parseSkills(skills);
  return requirements.flatMap((requirement) =>
    evidenceCandidates(requirement, experiences, parsedSkills).map((evidence) => ({
      requirementId: requirement.id,
      evidence,
    })),
  );
}

export function classifyRequirements(requirements, links) {
  const evidenceByRequirement = new Map();
  for (const link of links) {
    if (!evidenceByRequirement.has(link.requirementId)) evidenceByRequirement.set(link.requirementId, []);
    evidenceByRequirement.get(link.requirementId).push(link.evidence);
  }
  return requirements.map((requirement) => {
    const evidence = [...(evidenceByRequirement.get(requirement.id) || [])]
      .sort((a, b) => Number(b.relation === 'direct') - Number(a.relation === 'direct'));
    const classification = classificationFor(evidence);
    return {
      id: requirement.id,
      name: requirement.name,
      postingExcerpt: requirement.postingExcerpt,
      classification,
      evidence,
      explanation: explanationFor(classification, evidence, requirement.name),
      uncertainty: classification === 'Missing Evidence'
        ? 'This absence is limited to the information submitted; it does not prove you lack the experience.'
        : classification === 'Transferable Evidence'
          ? 'Transferable does not mean direct experience, equipment qualification, or certification.'
          : classification === 'Needs Clarification'
            ? 'Add the specific action, equipment, and scope before relying on this claim.'
            : 'Confirm the quoted scope is accurate before using it in an application.',
      reviewed: false,
    };
  });
}

export function buildCareerDraft({ jobText, experiences, skills = '', targetRole = '' }) {
  const normalizedExperiences = normalizeExperiences(experiences);
  const requirements = extractCareerRequirements(jobText);
  const links = buildEvidenceLinks(requirements, normalizedExperiences, skills);
  return {
    targetRole: String(targetRole || '').trim().slice(0, 140) || 'Role described in the posting',
    method: 'Deterministic source-text matching. This is not an AI assessment or hiring prediction.',
    experiences: normalizedExperiences,
    skills: parseSkills(skills),
    requirements: classifyRequirements(requirements, links),
  };
}

export function applyCareerReview(draft, corrections = []) {
  if (!Array.isArray(corrections) || corrections.length > 100) {
    throw new Error('Review updates must be a list of at most 100 requirement corrections.');
  }
  const byId = new Map(draft.requirements.map((requirement) => [requirement.id, requirement]));
  const correctionMap = new Map();
  for (const correction of corrections) {
    if (!correction || !byId.has(correction.requirementId) || !CLASSIFICATIONS.has(correction.classification)) {
      throw new Error('A review update refers to an unknown requirement or classification.');
    }
    if (correctionMap.has(correction.requirementId)) {
      throw new Error('Each requirement can be corrected only once.');
    }
    correctionMap.set(correction.requirementId, correction);
  }
  const requirements = draft.requirements.map((requirement) => {
    const correction = correctionMap.get(requirement.id);
    if (!correction) return { ...requirement, reviewed: true };

    let evidence = requirement.evidence;
    if (correction.evidenceExcerpt) {
      const experience = draft.experiences.find((item) => item.id === correction.experienceId);
      const excerpt = String(correction.evidenceExcerpt).trim();
      if (!experience || excerpt.length < 8 || !experience.text.includes(excerpt)) {
        throw new Error('A corrected evidence quote must exactly match a submitted experience.');
      }
      evidence = [{
        id: `${experience.id}:reviewed:${requirement.id}`,
        experienceId: experience.id,
        sourceTitle: experience.title,
        sourceType: 'experience',
        excerpt,
        relation: correction.classification === 'Direct Evidence' ? 'direct' : 'transferable',
      }];
    } else if (['Direct Evidence', 'Transferable Evidence'].includes(correction.classification)) {
      evidence = evidence.map((item) => ({
        ...item,
        relation: correction.classification === 'Direct Evidence' ? 'direct' : 'transferable',
      }));
    }

    if (['Direct Evidence', 'Transferable Evidence'].includes(correction.classification) && !evidence.length) {
      throw new Error('Direct or transferable classifications need a quote from your submitted experience or practiced skills.');
    }

    return {
      ...requirement,
      classification: correction.classification,
      evidence: correction.classification === 'Missing Evidence' ? [] : evidence,
      explanation: correction.explanation
        ? `${String(correction.explanation).trim().slice(0, 400)} (Reviewed by you.)`
        : explanationFor(correction.classification, evidence, requirement.name),
      uncertainty: correction.classification === 'Direct Evidence'
        ? 'You reviewed this classification. Confirm the scope is accurate before using it.'
        : correction.classification === 'Transferable Evidence'
          ? 'You reviewed this classification. Transferable does not establish direct experience or certification.'
          : correction.classification === 'Needs Clarification'
            ? 'You reviewed this classification. Add more detail before relying on it.'
            : 'You reviewed this as missing from the submitted material; this does not prove you lack the experience.',
      reviewed: true,
      reviewSource: 'user',
    };
  });

  return { ...draft, requirements };
}

function nextStepFor(requirement) {
  const concept = REQUIREMENT_CONCEPTS.find((entry) => entry.id === requirement.id);
  return concept?.nextStep
    || `Review “${requirement.name}” and identify a real example or a practical learning step.`;
}

export function generateTransitionBrief(reviewedDraft) {
  const requirements = reviewedDraft.requirements;
  const direct = requirements.filter((item) => item.classification === 'Direct Evidence');
  const transferable = requirements.filter((item) => item.classification === 'Transferable Evidence');
  const unresolved = requirements.filter((item) =>
    ['Missing Evidence', 'Needs Clarification'].includes(item.classification),
  );
  const directEvidence = direct.flatMap((requirement) => requirement.evidence
    .filter((evidence) => evidence.relation === 'direct')
    .map((evidence) => ({
    requirement: requirement.name,
    sourceTitle: evidence.sourceTitle,
    excerpt: evidence.excerpt,
    sourceType: evidence.sourceType,
  })));
  const transferableEvidence = requirements.flatMap((requirement) => {
    if (!['Direct Evidence', 'Transferable Evidence'].includes(requirement.classification)) return [];
    return requirement.evidence.filter((evidence) =>
      requirement.classification === 'Transferable Evidence' || evidence.relation === 'transferable',
    ).map((evidence) => ({
      requirement: requirement.name,
      excerpt: evidence.excerpt,
      explanation: `This excerpt is related to ${requirement.name}, but by itself does not establish direct experience or qualification.`,
    }));
  });

  const resumeBullets = directEvidence
    .filter((item) => item.sourceType === 'experience')
    .map((item) => ({
      text: item.excerpt,
      evidenceExcerpt: item.excerpt,
      supportedRequirement: item.requirement,
      note: 'Draft based only on your submitted wording; review before using.',
    }));
  const interviewTalkingPoints = [...directEvidence, ...transferableEvidence]
    .map((item) => ({
      requirement: item.requirement,
      prompt: `Describe the scope and steps behind: “${item.excerpt}”`,
      evidenceExcerpt: item.excerpt,
    }));
  const nextActions = [...unresolved, ...transferable].slice(0, 3).map((requirement) => ({
    requirement: requirement.name,
    action: nextStepFor(requirement),
  }));
  const generalActions = [
    { requirement: 'Verify your sources', action: 'Confirm each quoted action and its scope before using the brief in an application.' },
    { requirement: 'Prepare a concrete example', action: 'Practice explaining one submitted experience with only the steps and outcomes you can verify.' },
    { requirement: 'Review the full posting', action: 'Compare the brief with the complete job posting and clarify any requirements the deterministic extractor did not recognize.' },
  ];
  for (const action of generalActions) {
    if (nextActions.length >= 3) break;
    nextActions.push(action);
  }

  return {
    targetRole: reviewedDraft.targetRole,
    requirements,
    directlySupported: directEvidence,
    transferable: transferableEvidence,
    missingOrUnverified: unresolved.map((item) => ({
      requirement: item.name,
      classification: item.classification,
      postingExcerpt: item.postingExcerpt,
      reason: item.explanation,
    })),
    resumeBullets,
    interviewTalkingPoints,
    nextActions,
    caveat: 'Evidence is limited to what you submitted. Transferable experience is not a direct qualification or certification.',
  };
}

