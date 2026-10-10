import { parseDate, isValidDateString } from './temporal.js';

export type CodingProvenanceField = 'code' | 'medicationCodeableConcept' | 'valueCodeableConcept' | 'category';

export interface IndexedCoding {
  system?: string;
  code?: string;
  display?: string;
  field?: CodingProvenanceField;
}

export interface IndexedPeriod {
  start?: string;
  end?: string;
  parsedStart?: Date | null;
  parsedEnd?: Date | null;
}

export interface IndexedResource {
  resourceType: string;
  id: string;
  status?: string;
  date?: string;
  parsedDate?: Date | null;
  period?: IndexedPeriod;
  codings: IndexedCoding[];
  textSnippet?: string;
  bodySite?: string;
  laterality?: 'left' | 'right' | 'bilateral' | 'unspecified';
  numericValue?: number;
  numericUnit?: string;
  temporalIssues: string[];
  subjectId?: string;
  raw: Record<string, unknown>;
}

export class FhirBundleIndexer {
  private resourcesByType: Map<string, IndexedResource[]> = new Map();
  private resourcesById: Map<string, IndexedResource> = new Map();
  private allResources: IndexedResource[] = [];
  public readonly duplicateResourceIds: string[] = [];
  public readonly bundlePatientId?: string;
  public readonly integrityIssues: string[] = [];

  constructor(bundle: Record<string, unknown>) {
    // Extract bundle patient ID if present
    if (bundle && typeof bundle === 'object') {
      const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
      const patientEntry = entries.find(e => (e as any)?.resource?.resourceType === 'Patient');
      const patientId = (patientEntry as any)?.resource?.id;
      if (typeof patientId === 'string' && patientId.trim()) {
        this.bundlePatientId = patientId.trim();
      }
      if (entries.filter(e => (e as any)?.resource?.resourceType === 'Patient').length !== 1) {
        this.integrityIssues.push('A single identifiable Patient resource is required.');
      }
    }
    if (!this.bundlePatientId) this.integrityIssues.push('Patient ID is missing.');
    this.indexBundle(bundle);
  }

  private indexBundle(bundle: Record<string, unknown>): void {
    if (!bundle || typeof bundle !== 'object') return;
    const entries = Array.isArray(bundle.entry) ? bundle.entry : [];

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const res = (entry as Record<string, unknown>).resource as Record<string, unknown> | undefined;
      if (!res || typeof res.resourceType !== 'string' || typeof res.id !== 'string' || !res.id.trim()) {
        this.integrityIssues.push('Bundle entry lacks a resource type or ID.');
        continue;
      }

      const indexed = this.indexResource(res);
      const typeList = this.resourcesByType.get(indexed.resourceType) || [];
      typeList.push(indexed);
      this.resourcesByType.set(indexed.resourceType, typeList);

      // Canonical key: ResourceType/id
      const canonicalKey = `${indexed.resourceType}/${indexed.id}`;
      if (this.resourcesById.has(canonicalKey)) {
        this.duplicateResourceIds.push(canonicalKey);
        this.integrityIssues.push(`Duplicate canonical resource ID: ${canonicalKey}`);
      } else {
        this.resourcesById.set(canonicalKey, indexed);
      }

      this.allResources.push(indexed);
    }

    // Sort allResources chronologically (oldest first, missing dates at end)
    this.allResources.sort((a, b) => {
      const timeA = a.parsedDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const timeB = b.parsedDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    });
  }

  private indexResource(raw: Record<string, unknown>): IndexedResource {
    const resourceType = raw.resourceType as string;
    const id = String(raw.id);
    const status = typeof raw.status === 'string' ? raw.status : undefined;
    const codings: IndexedCoding[] = [];
    const temporalIssues: string[] = [];

    const extractCodingsFromField = (field: unknown, provenanceField: CodingProvenanceField) => {
      if (!field || typeof field !== 'object') return;
      // Handle CodeableConcept or array of CodeableConcepts
      const arrayCandidates = Array.isArray(field) ? field : [field];
      for (const item of arrayCandidates) {
        if (!item || typeof item !== 'object') continue;
        const cc = item as { coding?: Array<{ system?: string; code?: string; display?: string }> };
        if (Array.isArray(cc.coding)) {
          for (const c of cc.coding) {
            if (c && typeof c === 'object') {
              codings.push({
                system: typeof c.system === 'string' ? c.system : undefined,
                code: typeof c.code === 'string' ? c.code : undefined,
                display: typeof c.display === 'string' ? c.display : undefined,
                field: provenanceField,
              });
            }
          }
        }
      }
    };

    extractCodingsFromField(raw.code, 'code');
    extractCodingsFromField(raw.medicationCodeableConcept, 'medicationCodeableConcept');
    extractCodingsFromField(raw.valueCodeableConcept, 'valueCodeableConcept');
    extractCodingsFromField(raw.category, 'category');

    // Extract dates & periods
    let dateStr: string | undefined;
    let periodObj: IndexedPeriod | undefined;

    const parsePeriod = (pObj: unknown): IndexedPeriod | undefined => {
      if (!pObj || typeof pObj !== 'object') return undefined;
      const p = pObj as { start?: string; end?: string };
      if ((p.start != null && !isValidDateString(p.start)) || (p.end != null && !isValidDateString(p.end))) {
        temporalIssues.push('Invalid clinical period endpoint');
      }
      const start = typeof p.start === 'string' && isValidDateString(p.start) ? p.start : undefined;
      const end = typeof p.end === 'string' && isValidDateString(p.end) ? p.end : undefined;
      if (!start && !end) return undefined;
      
      const parsedStart = start ? parseDate(start) : null;
      const parsedEnd = end ? parseDate(end) : null;

      // Reject reversed periods (start > end)
      if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
        temporalIssues.push('Reversed clinical period');
        return undefined;
      }

      return {
        start,
        end,
        parsedStart,
        parsedEnd,
      };
    };

    if (raw.performedPeriod) periodObj = parsePeriod(raw.performedPeriod);
    else if (raw.effectivePeriod) periodObj = parsePeriod(raw.effectivePeriod);
    else if (raw.onsetPeriod) periodObj = parsePeriod(raw.onsetPeriod);
    else if (raw.period) periodObj = parsePeriod(raw.period);

    if (typeof raw.onsetDateTime === 'string' && isValidDateString(raw.onsetDateTime)) dateStr = raw.onsetDateTime;
    else if (typeof raw.effectiveDateTime === 'string' && isValidDateString(raw.effectiveDateTime)) dateStr = raw.effectiveDateTime;
    else if (typeof raw.performedDateTime === 'string' && isValidDateString(raw.performedDateTime)) dateStr = raw.performedDateTime;
    else if (typeof raw.authoredOn === 'string' && isValidDateString(raw.authoredOn)) dateStr = raw.authoredOn;
    else if (typeof raw.issued === 'string' && isValidDateString(raw.issued)) dateStr = raw.issued;
    else if (typeof raw.recordedDate === 'string' && isValidDateString(raw.recordedDate)) dateStr = raw.recordedDate;
    else if (typeof raw.date === 'string' && isValidDateString(raw.date)) dateStr = raw.date;
    else if (periodObj) {
      dateStr = periodObj.end || periodObj.start;
    }
    for (const field of ['onsetDateTime', 'effectiveDateTime', 'performedDateTime', 'authoredOn', 'issued', 'recordedDate', 'date']) {
      if (raw[field] != null && (typeof raw[field] !== 'string' || !isValidDateString(raw[field] as string))) {
        temporalIssues.push(`Invalid ${field}`);
      }
    }
    // A report's publication date is not proof of the examination date.
    if (resourceType === 'DiagnosticReport') {
      dateStr = typeof raw.effectiveDateTime === 'string' && isValidDateString(raw.effectiveDateTime)
        ? raw.effectiveDateTime : periodObj?.end || periodObj?.start;
    }

    // Extract patient subject reference
    let subjectId: string | undefined;
    const subjRef = (raw.subject as any)?.reference || (raw.patient as any)?.reference;
    if (typeof subjRef === 'string') {
      const match = /(?:^|\/)Patient\/([^/?#]+)$/.exec(subjRef.trim());
      if (match) subjectId = match[1];
    }

    // Extract numeric values from observations
    let numericValue: number | undefined;
    let numericUnit: string | undefined;
    if (raw.valueQuantity && typeof raw.valueQuantity === 'object') {
      const vq = raw.valueQuantity as { value?: unknown; unit?: unknown; code?: unknown };
      if (typeof vq.value === 'number' && Number.isFinite(vq.value)) {
        numericValue = vq.value;
      }
      if (typeof vq.code === 'string' || typeof vq.unit === 'string') {
        numericUnit = (vq.code ?? vq.unit) as string;
      }
    } else if (typeof raw.valueInteger === 'number' && Number.isFinite(raw.valueInteger)) {
      numericValue = raw.valueInteger;
    }

    // Extract narrative text snippets
    let textSnippet: string | undefined;
    const snippets: string[] = [];

    if (raw.text && typeof raw.text === 'object') {
      const div = (raw.text as { div?: string }).div;
      if (typeof div === 'string') {
        const clean = div.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean) snippets.push(clean);
      }
    }

    if (Array.isArray(raw.note)) {
      for (const n of raw.note) {
        if (n && typeof n.text === 'string') {
          const clean = n.text.trim();
          if (clean) snippets.push(clean);
        }
      }
    }

    if (typeof raw.conclusion === 'string' && raw.conclusion.trim()) {
      snippets.push(raw.conclusion.trim());
    }

    if (snippets.length > 0) {
      textSnippet = snippets.join(' | ');
    }

    // Extract body site & laterality
    let bodySite: string | undefined;
    let laterality: 'left' | 'right' | 'bilateral' | 'unspecified' | undefined;

    const examineBodySite = (bs: unknown) => {
      if (!bs || typeof bs !== 'object') return;
      const cc = bs as { text?: string; coding?: Array<{ code?: string; display?: string }> };
      const text = (cc.text || cc.coding?.[0]?.display || cc.coding?.[0]?.code || '').toLowerCase();
      if (!text) return;
      bodySite = text;

      if (/\b(left|lt)\b/i.test(text)) laterality = 'left';
      else if (/\b(right|rt)\b/i.test(text)) laterality = 'right';
      else if (/\b(bilateral|both)\b/i.test(text)) laterality = 'bilateral';
    };

    examineBodySite(raw.bodySite);
    if (!laterality && textSnippet) {
      const lower = textSnippet.toLowerCase();
      if (/\b(left knee|left leg|left lower extremity)\b/i.test(lower)) laterality = 'left';
      else if (/\b(right knee|right leg|right lower extremity)\b/i.test(lower)) laterality = 'right';
      else if (/\b(bilateral knees|bilateral lower extremities)\b/i.test(lower)) laterality = 'bilateral';
    }

    return {
      resourceType,
      id,
      status,
      date: dateStr,
      parsedDate: parseDate(dateStr),
      period: periodObj,
      codings,
      textSnippet,
      bodySite,
      laterality,
      numericValue,
      numericUnit,
      temporalIssues,
      subjectId,
      raw,
    };
  }

  public getResources(resourceType: string): IndexedResource[] {
    return this.resourcesByType.get(resourceType) || [];
  }

  public getAllResources(): IndexedResource[] {
    return [...this.allResources];
  }

  public getResourceById(refOrId: string): IndexedResource | undefined {
    if (!refOrId) return undefined;
    if (refOrId.includes('/')) {
      if (this.duplicateResourceIds.includes(refOrId)) return undefined;
      return this.resourcesById.get(refOrId);
    }
    // Bare ID lookup: search across all resources
    const matches = this.allResources.filter(resource => resource.id === refOrId);
    // If ambiguous (multiple resources share the same bare ID), fail safely
    if (matches.length === 1) return matches[0];
    return undefined;
  }

  public findByCode(
    resourceType: string,
    codes: string[],
    systems?: string[],
    allowedFields: CodingProvenanceField[] = ['code', 'medicationCodeableConcept']
  ): IndexedResource[] {
    const list = this.getResources(resourceType);
    const codeSet = new Set(codes.map(c => c.toUpperCase().replace(/\./g, '')));
    const systemSet = systems?.length ? new Set(systems) : undefined;

    return list.filter(item => {
      // Enforce patient-subject matching: if this resource specifies a subject and bundle has a patient, they must match
      if (this.bundlePatientId && item.subjectId !== this.bundlePatientId) {
        return false;
      }

      return item.codings.some(c => {
        if (!c.code) return false;
        // Never allow 'category' or other non-clinical fields to substitute for clinical concepts
        if (c.field && !allowedFields.includes(c.field)) return false;

        const normalized = c.code.toUpperCase().replace(/\./g, '');
        if (!codeSet.has(normalized)) return false;

        // If policy specifies acceptableCodeSystems, coding MUST provide a matching system
        if (systemSet) {
          if (!c.system || !systemSet.has(c.system)) return false;
        }

        return true;
      });
    });
  }
}
