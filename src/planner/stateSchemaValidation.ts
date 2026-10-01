import Ajv2020 from 'ajv/dist/2020';
import legacySchema from './planner_catalog_2026.schema.json';
import stateSchema from './planner_state_v22.schema.json';
import type { GraduationProfile, PlannerState as V21PlannerState } from './plannerCatalog';
import type { PlanIntent, PlannerState } from './plannerStateV22';

const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
ajv.addSchema(legacySchema, 'urn:housei-media:legacy-2026');
export const validateLegacyStateShape = ajv.compile<V21PlannerState>({ $ref: 'urn:housei-media:legacy-2026#/$defs/PlannerState' });
export const validateStateShape = ajv.compile<PlannerState>(stateSchema);
export const validatePlanIntentShape = ajv.compile<PlanIntent>({ $ref: 'urn:housei-media:planner-state:v22#/$defs/PlanIntent' });

// Recovery first validates complete structure, but not credit bounds. Domain
// recovery quarantines out-of-range numbers; it must never repair missing or
// malformed structure by casting untrusted JSON into a state/profile.
const numberOrNull = { type: ['number', 'null'] };
const mode = { enum: ['unknown', 'none', 'recognized', 'exempt'] };
const recognizedField = { type: 'object', required: ['mode', 'credits'], properties: { mode, credits: numberOrNull } };
export const validateRecognitionRecoveryShape = ajv.compile<GraduationProfile>({
  ...legacySchema.$defs.PlannerState.properties.graduationProfile,
  properties: {
    ...legacySchema.$defs.PlannerState.properties.graduationProfile.properties,
    recognizedCredits: {
      type: 'object', required: ['totalCredits', 'schoolingEquivalentCredits', 'openUniversityCredits', 'general', 'foreignLanguage', 'physicalEducation', 'professionalCourses'],
      properties: {
        totalCredits: numberOrNull, schoolingEquivalentCredits: numberOrNull, openUniversityCredits: numberOrNull,
        general: { type: 'object', required: ['humanities', 'social', 'natural'], properties: { humanities: recognizedField, social: recognizedField, natural: recognizedField }, additionalProperties: recognizedField },
        foreignLanguage: { type: 'object', required: ['mode', 'credits', 'language', 'schoolingEquivalentCredits'], properties: { mode, credits: numberOrNull, language: { enum: ['english', 'german', 'french', 'unknown'] }, schoolingEquivalentCredits: numberOrNull } },
        physicalEducation: recognizedField,
        professionalCourses: { type: 'array', items: { type: 'object', required: ['id', 'name', 'credits', 'offeringId', 'courseId', 'mappingId'], properties: { id: { type: 'string' }, name: { type: 'string' }, credits: { type: 'number' }, offeringId: { type: ['string', 'null'] }, courseId: { type: ['string', 'null'] }, mappingId: { type: ['string', 'null'] } } } },
      },
    },
  },
});
