import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('MCP Server Standalone Subprocess Protocol Test (stdio)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const serverScript = resolve(__dirname, '../dist/index.js');
    const unrelatedCwd = tmpdir();

    transport = new StdioClientTransport({
      command: 'node',
      args: [serverScript],
      cwd: unrelatedCwd,
      env: {
        ...process.env,
      },
    });

    client = new Client(
      {
        name: 'test-stdio-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('connects via stdio from an unrelated cwd and lists tools', async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(6);
    const names = res.tools.map(t => t.name);
    expect(names).toContain('evaluate_case');
    expect(names).toContain('inspect_evidence');
  });

  it('successfully evaluates a case over stdio subprocess', async () => {
    const res = await client.callTool({
      name: 'evaluate_case',
      arguments: {
        caseId: 'case-lumbar-001-meets',
        strategy: 'rules',
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(parsed.caseId).toBe('case-lumbar-001-meets');
    expect(parsed.disposition).toBe('meets_policy');
  });
});
