// JSON Schema sent to ycore as data in the prompt. Zod + reference/rights checks remain the publish gate.
const text = (maxLength = 1800) => ({ type: 'string', minLength: 1, maxLength });
const strings = (maxItems = 5, minItems = 1) => ({ type: 'array', minItems, maxItems, items: text(600) });
const evidence = {
  type: 'object', additionalProperties: false, required: ['item_id','item_version','locator','quote'],
  properties: { item_id: text(), item_version: { type: 'integer', minimum: 1 }, locator: text(300), quote: text(1500) }
};
const evidenceSet = { type: 'array', minItems: 1, maxItems: 10, items: evidence };
export const outputJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  required: ['summary','headline','change_summary','impact_summary','core_claim_id','importance','importance_reason','occurred_at','claims','paths','companies','stopping_message'],
  properties: {
    summary: text(300), headline: text(60), change_summary: text(300), impact_summary: text(360),
    core_claim_id: text(), importance: { enum: ['major','notable','exclude'] }, importance_reason: text(600),
    occurred_at: { anyOf: [{ type: 'string', format: 'date-time' },{ type: 'null' }] },
    claims: { type: 'array', minItems: 1, maxItems: 3, items: {
      type: 'object', additionalProperties: false, required: ['claim_id','content_type','evidence_state','text','evidence'],
      properties: { claim_id: text(80), content_type: { enum: ['fact','source_opinion','conditional_inference'] },
        evidence_state: { enum: ['primary','corroborated','unverified','conflicting','refuted'] }, text: text(), evidence: evidenceSet }
    } },
    paths: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false,
      required: ['name','mechanism','conditions','counterforces','direction','claim_ids'], properties: {
        name: text(100), mechanism: text(1600), conditions: strings(), counterforces: strings(5,0), direction: { enum: ['positive','negative','uncertain'] },
        claim_ids: { type: 'array', minItems: 1, maxItems: 12, items: text(80) }
      }
    } },
    companies: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false,
      required: ['company_id','name','business_evidence','mechanism_path','conditional_link','conditions','counterforces'],
      properties: { company_id: { type: 'string', pattern: '^(SSE|SZSE|BSE)\\.\\d{6}$' }, name: text(100),
        business_evidence: { ...evidenceSet, maxItems: 8 }, mechanism_path: { type: 'integer', minimum: 0 }, conditional_link: text(1400), conditions: strings(), counterforces: strings(5,0) }
    } },
    stopping_message: text(800)
  }
};

// Gemini's supported JSON Schema subset. Local validation retains all stricter bounds.
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (value && typeof value === 'object') {
    const schema = Object.fromEntries(Object.entries(value).filter(([key]) => !['$schema','minLength','maxLength','pattern','maxItems','minimum','format'].includes(key)).map(([key,v]) => [key,providerSchema(v)]));
    // Explicit enum types and fewer optional bounds keep Gemini's grammar small.
    if (Array.isArray(schema.enum) && !schema.type) schema.type = 'string';
    return schema;
  }
  return value;
}
export const providerOutputSchema = providerSchema(outputJsonSchema) as Record<string, unknown>;

export const reviewAreas = ['facts','time','comparison','supply_demand','causality','companies'] as const;
export const reviewJsonSchema = {
  type: 'object', additionalProperties: false, required: ['verdict','checks','issues'],
  properties: {
    verdict: { type: 'string', enum: ['pass','issues'] },
    checks: { type: 'object', additionalProperties: false, required: [...reviewAreas], properties: Object.fromEntries(reviewAreas.map(area => [area,{ type: 'string', enum: ['pass','issue','not_applicable'] }])) },
    issues: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['area','draft_excerpt','explanation'], properties: {
      area: { type: 'string', enum: [...reviewAreas] }, draft_excerpt: text(300), explanation: text(600)
    } } }
  }
};
export const providerReviewSchema = providerSchema(reviewJsonSchema) as Record<string, unknown>;
