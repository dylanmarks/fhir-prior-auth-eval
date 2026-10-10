import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createOpenPaMcpServer } from '../src/index.js';

describe('Model Context Protocol (MCP) Server Protocol Integration', () => {
  let client: Client;
  let serverTransport: InMemoryTransport;
  let clientTransport: InMemoryTransport;

  beforeAll(async () => {
    const server = createOpenPaMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      {
        name: 'test-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists all 6 supported tools with valid schemas', async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(6);

    const toolNames = res.tools.map(t => t.name);
    expect(toolNames).toContain('list_cases');
    expect(toolNames).toContain('get_case_detail');
    expect(toolNames).toContain('evaluate_case');
    expect(toolNames).toContain('inspect_evidence');
    expect(toolNames).toContain('run_counterfactual_test');
    expect(toolNames).toContain('run_benchmark');
  });

  it('calls list_cases without filter and returns full case catalogue', async () => {
    const res = await client.callTool({ name: 'list_cases', arguments: {} });
    expect(res.isError).toBeFalsy();
    const content = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(22);
  });

  it('calls list_cases with category filter', async () => {
    const res = await client.callTool({
      name: 'list_cases',
      arguments: { category: 'lumbar_mri' },
    });
    expect(res.isError).toBeFalsy();
    const content = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(content.length).toBe(3);
    for (const c of content) {
      expect(c.category).toBe('lumbar_mri');
    }
  });

  it('rejects list_cases with invalid category', async () => {
    const res = await client.callTool({
      name: 'list_cases',
      arguments: { category: 'cardiology_bypass' },
    });
    expect(res.isError).toBe(true);
  });

  it('calls get_case_detail for a valid case ID', async () => {
    const res = await client.callTool({
      name: 'get_case_detail',
      arguments: { caseId: 'case-lumbar-001-meets' },
    });
    expect(res.isError).toBeFalsy();
    const content = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(content.case.id).toBe('case-lumbar-001-meets');
    expect(content.policy.id).toBe('policy-lumbar-mri-v1');
    expect(content.case.patientBundle.resourceType).toBe('Bundle');
  });

  it('returns an error when get_case_detail is called with nonexistent ID', async () => {
    const res = await client.callTool({
      name: 'get_case_detail',
      arguments: { caseId: 'non-existent-case-id' },
    });
    expect(res.isError).toBe(true);
  });

  it('evaluates case via evaluate_case with rules strategy', async () => {
    const res = await client.callTool({
      name: 'evaluate_case',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        strategy: 'rules',
      },
    });
    expect(res.isError).toBeFalsy();
    const assessment = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(assessment.disposition).toBe('meets_policy');
    expect(assessment.totalCostUsd).toBe(0);
    expect(assessment.requirements.length).toBe(2);
  });

  it('rejects evaluate_case with invalid strategy', async () => {
    const res = await client.callTool({
      name: 'evaluate_case',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        strategy: 'frontier_magic_ai',
      },
    });
    expect(res.isError).toBe(true);
  });

  it('rejects evaluate_case with negative budgetCapUsd', async () => {
    const res = await client.callTool({
      name: 'evaluate_case',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        budgetCapUsd: -0.1,
      },
    });
    expect(res.isError).toBe(true);
  });

  it('inspects evidence via inspect_evidence tool', async () => {
    const res = await client.callTool({
      name: 'inspect_evidence',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        requirementId: 'req-radiculopathy',
      },
    });
    expect(res.isError).toBeFalsy();
    const evidenceReport = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(evidenceReport.caseId).toBe('case-lumbar-001-meets');
    expect(evidenceReport.requirementId).toBe('req-radiculopathy');
    expect(evidenceReport.totalCandidatesCount).toBeGreaterThan(0);
    expect(evidenceReport.acceptedCandidatesCount).toBeGreaterThan(0);
    expect(evidenceReport.evidence[0].resourceType).toBe('Condition');
    expect(evidenceReport.evidence[0].accepted).toBe(true);
  });

  it('runs counterfactual adversarial test mutation', async () => {
    const res = await client.callTool({
      name: 'run_counterfactual_test',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        mutationType: 'shorten_therapy_duration',
      },
    });
    expect(res.isError).toBeFalsy();
    const result = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(result.baselineDisposition).toBe('meets_policy');
    expect(result.mutatedDisposition).toBe('needs_information');
    expect(result.flippedCorrectly).toBe(true);
  });

  it('runs batch benchmark via run_benchmark tool', async () => {
    const res = await client.callTool({
      name: 'run_benchmark',
      arguments: {},
    });
    expect(res.isError).toBeFalsy();
    const benchmark = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(benchmark.totalCases).toBe(10);
    expect(benchmark.dispositionAccuracy).toBe(1.0);
  });

  it('does not label wrong-side cited evidence as accepted', async () => {
    const res = await client.callTool({name:'inspect_evidence',arguments:{caseId:'case-knee-003-laterality',requirementId:'req-plain-radiograph'}});
    const report = JSON.parse((res.content as Array<{text:string}>)[0].text);
    expect(report.acceptedCandidatesCount).toBe(0);
    expect(report.evidence[0].rejectionReason).toContain('Laterality mismatch');
  });

  it('exposes narrative cases and honest unconfigured tier fallback', async () => {
    const res = await client.callTool({name:'evaluate_case',arguments:{caseId:'case-narrative-dev-progress',strategy:'tiered'}});
    const result = JSON.parse((res.content as Array<{text:string}>)[0].text);
    expect(result.disposition).toBe('requires_clinical_review');
    expect(result.executionTrace.some((s:any)=>s.model==='unconfigured-jev')).toBe(true);
  });

  it('handles unknown tool invocations with isError response', async () => {
    const res = await client.callTool({
      name: 'unregistered_tool',
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });
});
