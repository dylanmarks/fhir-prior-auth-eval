/**
 * Demonstration synthetic bundle scrubber.
 *
 * NOTE ON PRIVACY AND PHI SCOPE:
 * This sanitizer provides client-side pre-dispatch scrubbing for synthetic benchmark bundles.
 * It removes simulated direct identifiers, practitioner credentials, contact details, and binary
 * attachments before payloads reach evaluator tiers.
 *
 * IT IS NOT A GENERAL HIPAA SAFE HARBOR DE-IDENTIFICATION SYSTEM AND MUST NOT BE USED ON REAL PHI.
 * All evaluation datasets in this repository are strictly synthetic.
 */
export function sanitizeFhirBundle(bundle: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>;

  if (Array.isArray(cloned.entry)) {
    for (const entry of cloned.entry) {
      if (!entry || typeof entry !== 'object') continue;
      const res = (entry as Record<string, unknown>).resource as Record<string, unknown> | undefined;
      if (!res) continue;

      // 1. Patient redaction
      if (res.resourceType === 'Patient') {
        if (res.name) {
          res.name = [{ use: 'anonymous', family: 'ANONYMIZED', given: ['PATIENT'] }];
        }
        if (res.telecom) res.telecom = [];
        if (res.address) res.address = [{ text: 'REDACTED ADDRESS' }];
        if (Array.isArray(res.identifier)) {
          res.identifier = [{ system: 'urn:ietf:rfc:3986', value: `urn:uuid:${res.id}` }];
        }
        if (res.contact) res.contact = [];
      }

      // 2. Practitioner redaction
      if (res.resourceType === 'Practitioner') {
        if (res.name) {
          res.name = [{ use: 'anonymous', family: 'CLINICIAN', given: ['ORDERING'] }];
        }
        if (res.telecom) res.telecom = [];
        if (res.address) res.address = [{ text: 'REDACTED CLINIC' }];
        if (Array.isArray(res.identifier)) {
          res.identifier = [{ system: 'http://hl7.org/fhir/sid/us-npi', value: '0000000000' }];
        }
      }

      // 3. RelatedPerson & Person redaction
      if (res.resourceType === 'RelatedPerson' || res.resourceType === 'Person') {
        if (res.name) {
          res.name = [{ use: 'anonymous', family: 'REDACTED', given: ['INDIVIDUAL'] }];
        }
        if (res.telecom) res.telecom = [];
        if (res.address) res.address = [{ text: 'REDACTED' }];
      }

      // 4. Attachment redaction (DiagnosticReport, DocumentReference)
      if (Array.isArray(res.presentedForm)) {
        res.presentedForm = [{ contentType: 'text/plain', title: 'Binary attachment redacted' }];
      }
      if (Array.isArray(res.content)) {
        res.content = (res.content as Array<Record<string, unknown>>).map(c => ({
          ...c,
          attachment: { contentType: 'text/plain', title: 'Attachment content redacted' },
        }));
      }

      // 5. Clean metadata & tracking extensions
      if (res.meta && typeof res.meta === 'object') {
        const meta = res.meta as Record<string, unknown>;
        delete meta.security;
        delete meta.tag;
      }

      // 6. Narrative text scrub for simulated phone / email / SSN patterns
      if (res.text && typeof res.text === 'object') {
        const textObj = res.text as { div?: string };
        if (typeof textObj.div === 'string') {
          textObj.div = textObj.div
            .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
            .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED-PHONE]')
            .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED-EMAIL]');
        }
      }
    }
  }

  return cloned;
}
