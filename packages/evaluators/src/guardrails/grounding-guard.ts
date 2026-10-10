import type { EvidenceCitation, FhirBundleIndexer, IndexedResource } from '@openpa/core';

export interface GroundingVerificationResult {
  isValid: boolean;
  totalCitations: number;
  validCitations: number;
  ungroundedCitations: Array<{
    citation: EvidenceCitation;
    reason: string;
  }>;
}

export class GroundingGuardrail {
  /**
   * Evaluates citation grounding against the underlying FHIR indexer.
   * Checks resource existence, type matching, timestamp consistency, snippet authenticity,
   * and supported JSONPath expressions.
   */
  public static verifyCitations(
    citations: EvidenceCitation[],
    indexer: FhirBundleIndexer
  ): GroundingVerificationResult {
    const ungrounded: Array<{ citation: EvidenceCitation; reason: string }> = [];
    let validCount = 0;

    for (const citation of citations) {
      if (!citation.resourceId || typeof citation.resourceId !== 'string') {
        ungrounded.push({ citation, reason: 'Citation has missing or invalid resourceId' });
        continue;
      }

      const found = indexer.getResourceById(citation.resourceId);
      if (!found) {
        ungrounded.push({
          citation,
          reason: `Resource pointer '${citation.resourceId}' not found in bundle or is ambiguous across types`,
        });
        continue;
      }

      // 1. Verify resource type
      if (citation.resourceType && citation.resourceType !== found.resourceType) {
        ungrounded.push({
          citation,
          reason: `Resource type mismatch: cited '${citation.resourceType}' but bundle resource is '${found.resourceType}'`,
        });
        continue;
      }

      // 2. Verify timestamp
      if (citation.date) {
        const citedDate = citation.date.trim();
        const matchesDate =
          found.date === citedDate ||
          found.period?.start === citedDate ||
          found.period?.end === citedDate;

        if (!matchesDate) {
          ungrounded.push({
            citation,
            reason: `Date mismatch: cited date '${citation.date}' does not match record date '${found.date}'`,
          });
          continue;
        }
      }

      // 3. Verify text snippet
      if (citation.textSnippet !== undefined) {
        const snippet = citation.textSnippet.trim();
        if (!snippet) {
          ungrounded.push({ citation, reason: 'Empty text snippet provided in citation' });
          continue;
        }

        const snippetFound = this.checkSnippetInResource(snippet, found);
        if (!snippetFound) {
          ungrounded.push({
            citation,
            reason: `Snippet '${snippet}' was not found in clinical narrative, notes, or codings of '${found.resourceType}/${found.id}'`,
          });
          continue;
        }
      }

      // 4. Verify jsonPath if provided
      if (citation.jsonPath) {
        const pathMatches = this.verifyJsonPath(citation.jsonPath, citation.textSnippet, found.raw);
        if (!pathMatches.success) {
          ungrounded.push({
            citation,
            reason: pathMatches.reason ?? `Failed JSONPath verification: ${citation.jsonPath}`,
          });
          continue;
        }
      }

      validCount++;
    }

    return {
      isValid: ungrounded.length === 0,
      totalCitations: citations.length,
      validCitations: validCount,
      ungroundedCitations: ungrounded,
    };
  }

  private static checkSnippetInResource(snippet: string, resource: IndexedResource): boolean {
    const lowerSnippet = snippet.toLowerCase();

    // Check indexed textSnippet
    if (resource.textSnippet && resource.textSnippet.toLowerCase().includes(lowerSnippet)) {
      return true;
    }

    // Check codings displays
    if (resource.codings.some(c => c.display && c.display.toLowerCase().includes(lowerSnippet))) {
      return true;
    }

    // Check raw text div
    const div = (resource.raw.text as { div?: string } | undefined)?.div;
    if (typeof div === 'string' && div.toLowerCase().includes(lowerSnippet)) {
      return true;
    }

    // Check notes
    if (Array.isArray(resource.raw.note)) {
      const notes = resource.raw.note as Array<{ text?: string }>;
      if (notes.some(n => typeof n.text === 'string' && n.text.toLowerCase().includes(lowerSnippet))) {
        return true;
      }
    }

    // Check conclusion
    if (typeof resource.raw.conclusion === 'string' && resource.raw.conclusion.toLowerCase().includes(lowerSnippet)) {
      return true;
    }

    return false;
  }

  private static verifyJsonPath(
    jsonPath: string,
    expectedSnippet: string | undefined,
    rawObj: Record<string, unknown>
  ): { success: boolean; reason?: string } {
    // Basic JSONPath resolver for dot notation e.g. "$.status" or "code.coding[0].code"
    const cleaned = jsonPath.replace(/^\$\.?/, '');
    const segments = cleaned.split('.').filter(Boolean);

    let current: unknown = rawObj;
    for (const segment of segments) {
      if (current == null || typeof current !== 'object') {
        return { success: false, reason: `JSONPath '${jsonPath}' cannot resolve segment '${segment}'` };
      }

      // Handle array indexing e.g. "coding[0]"
      const arrayMatch = segment.match(/^([a-zA-Z0-9_-]+)\[(\d+)\]$/);
      if (arrayMatch) {
        const prop = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        const arr = (current as Record<string, unknown>)[prop];
        if (!Array.isArray(arr) || index >= arr.length) {
          return { success: false, reason: `Array index out of bounds or not an array: '${segment}'` };
        }
        current = arr[index];
      } else {
        current = (current as Record<string, unknown>)[segment];
      }
    }

    if (current === undefined) {
      return { success: false, reason: `JSONPath '${jsonPath}' resolved to undefined` };
    }

    if (expectedSnippet) {
      const strVal = typeof current === 'string' ? current : JSON.stringify(current);
      if (!strVal.toLowerCase().includes(expectedSnippet.toLowerCase())) {
        return {
          success: false,
          reason: `Resolved JSONPath value does not contain expected snippet '${expectedSnippet}'`,
        };
      }
    }

    return { success: true };
  }
}
