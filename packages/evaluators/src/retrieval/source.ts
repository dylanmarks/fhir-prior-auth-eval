import {
  type SourceDescriptor,
  type SourceRecordRef,
  type SourceRecord,
  type SearchPage,
  hashCanonicalJson,
} from '@openpa/core';

export interface EvidenceSource {
  readonly descriptor: SourceDescriptor;
  search(input: {
    patientId: string;
    resourceType: string;
    cursor?: string;
    pageSize: number;
    signal?: AbortSignal;
  }): Promise<SearchPage>;
  read(input: {
    patientId: string;
    reference: SourceRecordRef;
    signal?: AbortSignal;
  }): Promise<SourceRecord>;
}

export class InMemoryEvidenceSource implements EvidenceSource {
  public readonly descriptor: SourceDescriptor;
  private readonly records: Array<Record<string, unknown>>;

  constructor(descriptor: SourceDescriptor, records: Array<Record<string, unknown>> = []) {
    this.descriptor = descriptor;
    this.records = records;
  }

  public async search(input: {
    patientId: string;
    resourceType: string;
    cursor?: string;
    pageSize: number;
    signal?: AbortSignal;
  }): Promise<SearchPage> {
    if (input.signal?.aborted) {
      throw new Error('Search aborted');
    }

    if (this.descriptor.availability === 'unavailable') {
      throw new Error(`Source ${this.descriptor.id} is currently unavailable`);
    }

    // Filter records matching resourceType. Note: wrong-patient records may be stored
    // in the source store to test that the retriever filters them out during read/search.
    const matching = this.records.filter(r => r.resourceType === input.resourceType);

    // Decode cursor (format: "offset:<number>")
    let offset = 0;
    if (input.cursor) {
      if (!input.cursor.startsWith('offset:')) {
        throw new Error(`Malformed cursor: ${input.cursor}`);
      }
      offset = parseInt(input.cursor.slice(7), 10);
      if (Number.isNaN(offset) || offset < 0) {
        throw new Error(`Invalid cursor offset: ${input.cursor}`);
      }
    }

    const pageSize = Math.max(1, input.pageSize);
    const slice = matching.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < matching.length ? `offset:${nextOffset}` : undefined;

    const references: SourceRecordRef[] = slice.map(res => {
      const resourceType = String(res.resourceType);
      const id = String(res.id);
      return {
        sourceId: this.descriptor.id,
        resourceType,
        resourceId: `${resourceType}/${id}`,
        contentHash: hashCanonicalJson(res),
      };
    });

    return {
      references,
      nextCursor,
      totalCount: matching.length,
    };
  }

  public async read(input: {
    patientId: string;
    reference: SourceRecordRef;
    signal?: AbortSignal;
  }): Promise<SourceRecord> {
    if (input.signal?.aborted) {
      throw new Error('Read aborted');
    }

    if (this.descriptor.availability === 'unavailable') {
      throw new Error(`Source ${this.descriptor.id} is currently unavailable`);
    }

    const record = this.records.find(r => {
      const rType = String(r.resourceType);
      const rId = `${rType}/${r.id}`;
      return rType === input.reference.resourceType && rId === input.reference.resourceId;
    });

    if (!record) {
      throw new Error(`Resource ${input.reference.resourceId} not found in source ${this.descriptor.id}`);
    }

    // Extract patient ID from subject or patient reference
    let patientId = input.patientId;
    const subjectRef = (record.subject as { reference?: string })?.reference ??
      (record.patient as { reference?: string })?.reference;
    if (typeof subjectRef === 'string') {
      const parts = subjectRef.split('/');
      patientId = parts[parts.length - 1];
    }

    return {
      reference: {
        sourceId: this.descriptor.id,
        resourceType: String(record.resourceType),
        resourceId: input.reference.resourceId,
        contentHash: hashCanonicalJson(record),
      },
      patientId,
      resource: record,
    };
  }
}
