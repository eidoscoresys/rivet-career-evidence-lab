import test from 'node:test';import assert from 'node:assert/strict';
import {containsTerm,skillsFromText,parseSkills,extractRequirements,compare} from '../engine.js';
test('token matching avoids substring false positives',()=>{assert.equal(containsTerm('graphql','go'),false);assert.equal(containsTerm('react native','react'),true)});
test('aliases canonicalize technical terms',()=>assert.deepEqual(skillsFromText('Amazon Web Services and Typescript'),['typescript','aws']));
test('matching uses real excerpts and missing terms',()=>{const text='Looking for React, Python and Docker experience. You will build cloud services with SQL.';const req=extractRequirements(text);const r=compare('React, Python, SQL',req);assert.equal(r.matched,3);assert.ok(r.missing.some(x=>x.name==='docker'));assert.ok(r.matches.every(x=>x.evidence));});
test('distinct skills and case-insensitive matches',()=>{const r=compare('PYTHON, Python, troubleshooting',extractRequirements('Must know Python and troubleshooting.'));assert.equal(r.score,100);assert.equal(r.matched,2)});
test('empty posting cannot report a fake score',()=>{const r=compare('Python',[]);assert.equal(r.score,0);assert.equal(r.total,0)});
test('profile parsing removes duplicates',()=>assert.deepEqual(parseSkills('SQL, SQL\nReact'),['SQL','React']));
