import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PriorAuthCaseSchema,
  MedicalPolicySchema,
  FhirBundleIndexer,
  type PriorAuthCase,
  type MedicalPolicy,
} from '@openpa/core';
import {
  createEvaluationOrchestrator,
  type StrategyName,
  DeterministicRulesEvaluator,
} from '@openpa/evaluators';
import { ChatGptAuth, resolveChatGptProviders } from '@openpa/evaluators/chatgpt-auth';
import {
  BenchmarkHarness,
  CounterfactualSensitivityTester,
  type MutationType,
} from '@openpa/eval-suite';
import { z } from 'zod';

export interface McpServerOptions {
  rootDir?: string;
}

function resolveProjectRootDir(customRoot?: string): string {
  if (customRoot && existsSync(customRoot)) return customRoot;
  const currentFile = fileURLToPath(import.meta.url);
  const srcOrDistDir = dirname(currentFile);
  // packages/mcp-server/(src|dist) -> root is ../../..
  const candidate = resolve(srcOrDistDir, '../../..');
  if (existsSync(join(candidate, 'datasets'))) return candidate;
  return process.cwd();
}

export function createOpenPaMcpServer(options: McpServerOptions = {}): Server {
  const rootDir = resolveProjectRootDir(options.rootDir);
  const casesDir = join(rootDir, 'datasets/cases');
  const policiesDir = join(rootDir, 'datasets/policies');

  function loadPolicies(): MedicalPolicy[] {
    if (!existsSync(policiesDir)) return [];
    const files = readdirSync(policiesDir).filter(f => f.endsWith('.json'));
    const loaded = files.map(f => {
      const raw = JSON.parse(readFileSync(join(policiesDir, f), 'utf-8'));
      return MedicalPolicySchema.parse(raw);
    });
    const narrative = join(rootDir, 'datasets/narrative/policy.json');
    if (existsSync(narrative)) loaded.push(MedicalPolicySchema.parse(JSON.parse(readFileSync(narrative,'utf8'))));
    return loaded;
  }

  function loadCases(): PriorAuthCase[] {
    if (!existsSync(casesDir)) return [];
    const files = readdirSync(casesDir).filter(f => f.endsWith('.json'));
    const loaded = files.map(f => {
      const raw = JSON.parse(readFileSync(join(casesDir, f), 'utf-8'));
      return PriorAuthCaseSchema.parse(raw);
    });
    const narrative = join(rootDir, 'datasets/narrative/cases');
    if (existsSync(narrative)) loaded.push(...readdirSync(narrative).filter(f=>f.endsWith('.json')).map(f=>PriorAuthCaseSchema.parse(JSON.parse(readFileSync(join(narrative,f),'utf8')))));
    return loaded;
  }

  const server = new Server(
    {
      name: 'fhir-prior-auth-eval-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_cases',
          description: 'List available synthetic prior authorization benchmark cases with scenario categories and ground-truth tags.',
          inputSchema: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['lumbar_mri', 'knee_mri', 'pt_extension', 'sleep_study', 'dme', 'other'],
                description: 'Optional clinical category filter',
              },
            },
          },
        },
        {
          name: 'get_case_detail',
          description: 'Retrieve full FHIR bundle, requested service details, and matching medical policy for a case.',
          inputSchema: {
            type: 'object',
            properties: {
              caseId: { type: 'string', description: 'The unique case ID (e.g. case-lumbar-001-meets)' },
            },
            required: ['caseId'],
          },
        },
        {
          name: 'evaluate_case',
          description: 'Evaluate prior authorization requirements for a case across deterministic rules, tiered inference, or simulation.',
          inputSchema: {
            type: 'object',
            properties: {
              caseId: { type: 'string', description: 'The case ID to evaluate' },
              strategy: {
                type: 'string',
                enum: ['rules', 'cheap', 'tiered', 'llm', 'simulation'],
                description: 'Rules, rules+Jev, full cascade, generative baseline, or explicit simulation',
              },
              live: {type:'boolean',description:'Explicitly enable configured server-side providers. Default false; no paid calls.'},
              budgetCapUsd: {
                type: 'number',
                description: 'Maximum allowable cost budget in USD (must be non-negative)',
              },
            },
            required: ['caseId'],
          },
        },
        {
          name: 'inspect_evidence',
          description: 'Extract and inspect normalized clinical evidence from the FHIR bundle supporting a specific policy requirement, distinguishing candidate vs accepted evidence.',
          inputSchema: {
            type: 'object',
            properties: {
              caseId: { type: 'string', description: 'The case ID to inspect' },
              requirementId: { type: 'string', description: 'The policy requirement ID (e.g. req-radiculopathy)' },
            },
            required: ['caseId', 'requirementId'],
          },
        },
        {
          name: 'run_counterfactual_test',
          description: 'Apply an adversarial counterfactual perturbation and test whether the evaluation disposition correctly flips.',
          inputSchema: {
            type: 'object',
            properties: {
              caseId: { type: 'string', description: 'The case ID to mutate' },
              mutationType: {
                type: 'string',
                enum: [
                  'shorten_therapy_duration',
                  'diagnosis_non_indicated',
                  'temporal_expiry',
                  'clinical_negation',
                  'laterality_mismatch',
                  'remove_supporting_evidence',
                ],
                description: 'The perturbation vector to apply',
              },
            },
            required: ['caseId', 'mutationType'],
          },
        },
        {
          name: 'run_benchmark',
          description: 'Run batch evaluation across all benchmark cases and return statistical metrics and KPI rollups.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    const cases = loadCases();
    const policies = loadPolicies();
    const policyMap = new Map<string, MedicalPolicy>();
    for (const p of policies) policyMap.set(p.id, p);

    try {
      switch (name) {
        case 'list_cases': {
          const schema = z.object({
            category: z.enum(['lumbar_mri', 'knee_mri', 'pt_extension', 'sleep_study', 'dme', 'other']).optional(),
          });
          const parsed = schema.safeParse(args ?? {});
          if (!parsed.success) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for list_cases: ${parsed.error.message}` }],
            };
          }

          const filtered = parsed.data.category
            ? cases.filter(c => c.scenarioCategory === parsed.data.category)
            : cases;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  filtered.map(c => ({
                    id: c.id,
                    title: c.title,
                    category: c.scenarioCategory,
                    expectedDisposition: c.expectedAssessment.disposition,
                    tags: c.tags,
                  })),
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_case_detail': {
          const schema = z.object({ caseId: z.string().min(1) });
          const parsed = schema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for get_case_detail: ${parsed.error.message}` }],
            };
          }

          const targetCase = cases.find(c => c.id === parsed.data.caseId);
          if (!targetCase) {
            return { isError: true, content: [{ type: 'text', text: `Case not found: ${parsed.data.caseId}` }] };
          }
          const policy = policyMap.get(targetCase.policyId);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ case: targetCase, policy }, null, 2),
              },
            ],
          };
        }

        case 'evaluate_case': {
          const schema = z.object({
            caseId: z.string().min(1),
            strategy: z.enum(['rules', 'cheap', 'tiered', 'llm', 'simulation']).default('tiered'),
            live: z.boolean().default(false),
            budgetCapUsd: z.number().finite().nonnegative().default(0.05),
          });
          const parsed = schema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for evaluate_case: ${parsed.error.message}` }],
            };
          }

          const { caseId, strategy, budgetCapUsd } = parsed.data;
          const targetCase = cases.find(c => c.id === caseId);
          if (!targetCase) {
            return { isError: true, content: [{ type: 'text', text: `Case not found: ${caseId}` }] };
          }

          const policy = policyMap.get(targetCase.policyId);
          if (!policy) {
            return { isError: true, content: [{ type: 'text', text: `Policy not found: ${targetCase.policyId}` }] };
          }

          const providerOptions = parsed.data.live ? (await resolveChatGptProviders(new ChatGptAuth())).options : {};
          const orchestrator = createEvaluationOrchestrator(strategy as StrategyName, { ...providerOptions, budgetCapUsd });
          const assessment = await orchestrator.evaluateCase(targetCase, policy);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(assessment, null, 2),
              },
            ],
          };
        }

        case 'inspect_evidence': {
          const schema = z.object({
            caseId: z.string().min(1),
            requirementId: z.string().min(1),
          });
          const parsed = schema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for inspect_evidence: ${parsed.error.message}` }],
            };
          }

          const { caseId, requirementId } = parsed.data;
          const targetCase = cases.find(c => c.id === caseId);
          if (!targetCase) {
            return { isError: true, content: [{ type: 'text', text: `Case not found: ${caseId}` }] };
          }

          const policy = policyMap.get(targetCase.policyId);
          const req = policy?.requirements.find(r => r.id === requirementId);
          if (!req) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Requirement not found: ${requirementId} in policy ${targetCase.policyId}` }],
            };
          }

          const indexer = new FhirBundleIndexer(targetCase.patientBundle);
          const types = req.category === 'diagnosis'
            ? ['Condition']
            : req.category === 'imaging_prerequisite'
            ? ['DiagnosticReport', 'Procedure']
            : ['Procedure', 'Condition', 'Observation', 'MedicationStatement'];

          const matches = types.flatMap(t =>
            indexer.findByCode(t, req.acceptableCodes ?? [], req.acceptableCodeSystems)
          );

          // Evaluate deterministic rule to see which candidates are accepted vs rejected
          const rulesEval = new DeterministicRulesEvaluator();
          const { expectedAssessment, ...caseData } = targetCase;
          const reqEval = await rulesEval.evaluateRequirement(req, {
            caseData,
            indexer,
          });

          const acceptedCitations = new Set(reqEval.status === 'satisfied' && !reqEval.contradictionDetected ? reqEval.evidence.map(c => c.resourceId) : []);

          const candidateEvidence = matches.map(m => {
            const canonicalId = `${m.resourceType}/${m.id}`;
            const isAccepted = acceptedCitations.has(canonicalId);
            return {
              resourceType: m.resourceType,
              resourceId: canonicalId,
              status: m.status,
              date: m.date,
              laterality: m.laterality,
              bodySite: m.bodySite,
              textSnippet: m.textSnippet,
              codings: m.codings,
              accepted: isAccepted,
              rejectionReason: isAccepted ? undefined : reqEval.notes,
            };
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    caseId,
                    requirementId,
                    requirementDescription: req.description,
                    acceptableCodes: req.acceptableCodes,
                    totalCandidatesCount: candidateEvidence.length,
                    acceptedCandidatesCount: candidateEvidence.filter(e => e.accepted).length,
                    evidence: candidateEvidence,
                    deterministicEvaluation: {
                      status: reqEval.status,
                      confidence: reqEval.confidence,
                      notes: reqEval.notes,
                      evidence: reqEval.evidence,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'run_counterfactual_test': {
          const schema = z.object({
            caseId: z.string().min(1),
            mutationType: z.enum([
              'shorten_therapy_duration',
              'diagnosis_non_indicated',
              'temporal_expiry',
              'clinical_negation',
              'laterality_mismatch',
              'remove_supporting_evidence',
            ]),
          });
          const parsed = schema.safeParse(args);
          if (!parsed.success) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Invalid arguments for run_counterfactual_test: ${parsed.error.message}` }],
            };
          }

          const { caseId, mutationType } = parsed.data;
          const targetCase = cases.find(c => c.id === caseId);
          if (!targetCase) {
            return { isError: true, content: [{ type: 'text', text: `Case not found: ${caseId}` }] };
          }

          const policy = policyMap.get(targetCase.policyId);
          if (!policy) {
            return { isError: true, content: [{ type: 'text', text: `Policy not found: ${targetCase.policyId}` }] };
          }

          const orchestrator = createEvaluationOrchestrator('rules');
          const tester = new CounterfactualSensitivityTester(orchestrator);
          const res = await tester.testMutation(targetCase, policy, mutationType as MutationType);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(res, null, 2),
              },
            ],
          };
        }

        case 'run_benchmark': {
          const orchestrator = createEvaluationOrchestrator('rules');
          const harness = new BenchmarkHarness({ orchestrator });
          const results = await harness.runBenchmark(cases.filter(c=>!c.tags.includes('narrative')), policies);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }

        default:
          return {
            isError: true,
            content: [{ type: 'text', text: `Unknown MCP tool requested: ${name}` }],
          };
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Internal tool execution error: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  });

  return server;
}

// Auto-run Stdio transport when launched as a standalone CLI process
const entryPoint = process.argv[1];
if (
  entryPoint &&
  (entryPoint.endsWith('mcp-server/dist/index.js') ||
    entryPoint.endsWith('mcp-server/src/index.ts') ||
    entryPoint.endsWith('openpa-mcp'))
) {
  const server = createOpenPaMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch(err => {
    process.stderr.write(`Fatal MCP error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
