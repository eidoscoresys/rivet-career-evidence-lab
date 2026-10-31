import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCareerDraft,
  applyCareerReview,
  generateTransitionBrief,
} from '../evidence-engine.js';

const experience = [
  {
    id: 'supplies',
    title: 'Power supply testing',
    text: 'Installed and tested equipment power supplies. Measured voltage and continuity with a digital multimeter.',
  },
  {
    id: 'repair',
    title: 'Electrical repair',
    text: 'Diagnosed wiring-harness failures. Replaced defective electronic boards. Completed functional testing.',
  },
];
const posting = [
  'Facilities Technician',
  'Perform electrical troubleshooting and equipment maintenance.',
  'Familiarity with UPS systems is required.',
  'Generator knowledge is required.',
  'Cooling-system knowledge is required.',
].join('\n');

test('evidence matching distinguishes direct, transferable, and missing support', () => {
  const draft = buildCareerDraft({
    targetRole: 'Critical Facilities Technician',
    jobText: posting,
    experiences: experience,
  });
  const byId = Object.fromEntries(draft.requirements.map((item) => [item.id, item]));

  assert.equal(byId['electrical-troubleshooting'].classification, 'Direct Evidence');
  assert.ok(byId['electrical-troubleshooting'].evidence.some((item) => item.excerpt === 'Diagnosed wiring-harness failures.'));
  assert.equal(byId['equipment-maintenance'].classification, 'Direct Evidence');
  assert.equal(byId['ups-systems'].classification, 'Transferable Evidence');
  assert.equal(byId.generators.classification, 'Missing Evidence');
  assert.equal(byId['cooling-systems'].classification, 'Missing Evidence');
  assert.ok(byId.generators.uncertainty.includes('does not prove'));
});

test('brief statements cite submitted wording and do not upgrade transferable gaps', () => {
  const draft = buildCareerDraft({ targetRole: 'Critical Facilities Technician', jobText: posting, experiences: experience });
  const brief = generateTransitionBrief(draft);
  const sourceText = experience.map((item) => item.text).join(' ');

  assert.ok(brief.resumeBullets.length > 0);
  for (const bullet of brief.resumeBullets) {
    assert.equal(bullet.text, bullet.evidenceExcerpt);
    assert.ok(sourceText.includes(bullet.text));
  }
  assert.ok(brief.transferable.some((item) => item.requirement === 'UPS systems'));
  assert.ok(!brief.directlySupported.some((item) => item.requirement === 'UPS systems'));
  assert.ok(!brief.directlySupported.some((item) => item.excerpt === 'Measured voltage and continuity with a digital multimeter.'), 'a transferable connection is not promoted by another direct connection');
  assert.equal(brief.nextActions.length, 3);
  assert.deepEqual(new Set(brief.missingOrUnverified.map((item) => item.requirement)), new Set(['Generators', 'Cooling systems']));
});

test('vague experience remains needs-clarification, and review cannot invent a source quote', () => {
  const draft = buildCareerDraft({
    jobText: 'Generator knowledge is required.',
    experiences: [{ id: 'vague', title: 'Facilities work', text: 'Familiar with generators.' }],
  });
  assert.equal(draft.requirements[0].classification, 'Needs Clarification');
  assert.throws(
    () => applyCareerReview(draft, [{
      requirementId: 'generators',
      classification: 'Direct Evidence',
      experienceId: 'vague',
      evidenceExcerpt: 'Serviced standby generators.',
    }]),
    /exactly match a submitted experience/,
  );
  assert.throws(
    () => applyCareerReview(draft, [
      { requirementId: 'generators', classification: 'Needs Clarification' },
      { requirementId: 'generators', classification: 'Missing Evidence' },
    ]),
    /only once/,
  );
});

