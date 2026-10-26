import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MedicalPolicySchema, type MedicalPolicy } from '@openpa/core';
import {
  ScenarioFixtureSchema,
  GoldSidecarSchema,
  ScenarioManifestEntrySchema,
  type ScenarioFixture,
  type GoldSidecar,
  type ScenarioManifestEntry,
} from './types.js';
import { InMemoryEvidenceSource } from '@openpa/evaluators';

export interface RetrievalCohort {
  cases: ScenarioFixture[];
  goldSidecars: Record<string, GoldSidecar>;
  policies: Record<string, MedicalPolicy>;
  manifest: ScenarioManifestEntry[];
}

export function loadRetrievalCohort(rootDir: string): RetrievalCohort {
  const casesDir = join(rootDir, 'datasets/retrieval/cases');
  const goldDir = join(rootDir, 'datasets/retrieval/gold');
  const policiesDir = join(rootDir, 'datasets/policies');
  const manifestPath = join(rootDir, 'datasets/retrieval/manifest.json');

  // Load policies
  const policyFiles = readdirSync(policiesDir).filter(f => f.endsWith('.json'));
  const policies: Record<string, MedicalPolicy> = {};
  for (const f of policyFiles) {
    const raw = JSON.parse(readFileSync(join(policiesDir, f), 'utf8'));
    const parsed = MedicalPolicySchema.parse(raw);
    policies[parsed.id] = parsed;
  }

  // Load manifest
  const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = (Array.isArray(manifestRaw) ? manifestRaw : []).map(entry =>
    ScenarioManifestEntrySchema.parse(entry)
  );

  // Load cases
  const caseFiles = readdirSync(casesDir)
    .filter(f => f.endsWith('.json'))
    .sort();
  const cases = caseFiles.map(f => {
    const raw = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
    return ScenarioFixtureSchema.parse(raw);
  });

  // Load gold sidecars
  const goldFiles = readdirSync(goldDir)
    .filter(f => f.endsWith('.gold.json'))
    .sort();
  const goldSidecars: Record<string, GoldSidecar> = {};
  for (const f of goldFiles) {
    const raw = JSON.parse(readFileSync(join(goldDir, f), 'utf8'));
    const parsed = GoldSidecarSchema.parse(raw);
    goldSidecars[parsed.scenarioId] = parsed;
  }

  return { cases, goldSidecars, policies, manifest };
}

export function createSourcesForFixture(fixture: ScenarioFixture): InMemoryEvidenceSource[] {
  return fixture.sources.map(desc => {
    const records = fixture.sourceCorpus[desc.id] ?? [];
    return new InMemoryEvidenceSource(desc, records);
  });
}
