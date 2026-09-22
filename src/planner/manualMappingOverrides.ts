import overrideData from '../data/planner_manual_mapping_overrides_2026.json';
import type { PlannerCatalog } from './plannerCatalog';

type OverrideEntry = {
  ruleId: string;
  approvedPattern: string;
  targetCourseName: string;
  offeringIds: string[];
  mappingIds: string[];
  reason: string;
};

type OverrideLedger = {
  schemaVersion: 1;
  academicYear: 2026;
  provenance: 'manual_curated';
  officialVerified: false;
  approvedBy: string;
  overrides: OverrideEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string');
}

function parseLedger(value: unknown): OverrideLedger {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.academicYear !== 2026
    || value.provenance !== 'manual_curated'
    || value.officialVerified !== false
    || typeof value.approvedBy !== 'string'
    || !Array.isArray(value.overrides)) {
    throw new Error('Manual mapping override ledger is invalid.');
  }
  for (const entry of value.overrides) {
    if (!isRecord(entry)
      || typeof entry.ruleId !== 'string'
      || typeof entry.approvedPattern !== 'string'
      || typeof entry.targetCourseName !== 'string'
      || !stringArray(entry.offeringIds)
      || !stringArray(entry.mappingIds)
      || typeof entry.reason !== 'string') {
      throw new Error('Manual mapping override entry is invalid.');
    }
  }
  return value as OverrideLedger;
}

export const manualMappingOverrideLedger = parseLedger(overrideData);

/** Apply only explicitly approved offering-to-mapping edges; never rewrite offering identity. */
export function applyManualMappingOverrides(input: PlannerCatalog): PlannerCatalog {
  const offerings = new Map(input.offerings.map(offering => [offering.id, offering]));
  const mappingIds = new Set(input.mappings.map(mapping => mapping.mappingId));
  const claimedOfferingIds = new Set<string>();
  const replacements = new Map<string, PlannerCatalog['offerings'][number]>();

  for (const override of manualMappingOverrideLedger.overrides) {
    for (const mappingId of override.mappingIds) {
      if (!mappingIds.has(mappingId)) throw new Error(`Manual override references unknown mapping: ${mappingId}`);
    }
    for (const offeringId of override.offeringIds) {
      if (claimedOfferingIds.has(offeringId)) throw new Error(`Manual override duplicates offering: ${offeringId}`);
      claimedOfferingIds.add(offeringId);
      const offering = offerings.get(offeringId);
      if (!offering) throw new Error(`Manual override references unknown offering: ${offeringId}`);
      if (offering.resolutionStatus !== 'manual_review' || offering.mappingIds.length !== 0) {
        throw new Error(`Manual override no longer applies cleanly: ${offeringId}`);
      }
      replacements.set(offeringId, {
        ...offering,
        resolutionStatus: 'matched',
        mappingIds: [...override.mappingIds],
      });
    }
  }

  const patchedOfferings = input.offerings.map(offering => replacements.get(offering.id) ?? offering);
  const coverage = input.metadata.catalogCoverage;
  const matchedOfferingCount = patchedOfferings.filter(offering => offering.resolutionStatus === 'matched').length;
  const manualReviewOfferingCount = patchedOfferings.filter(offering => offering.resolutionStatus === 'manual_review').length;
  const outsideMappingScopeOfferingCount = patchedOfferings.filter(offering => offering.resolutionStatus === 'outside_mapping_scope').length;

  return {
    ...input,
    offerings: patchedOfferings,
    metadata: {
      ...input.metadata,
      unresolvedOfferingCount: manualReviewOfferingCount + outsideMappingScopeOfferingCount,
      catalogCoverage: {
        ...coverage,
        mappingEdgeCount: patchedOfferings.reduce((sum, offering) => sum + offering.mappingIds.length, 0),
        matchedOfferingCount,
        manualReviewOfferingCount,
        outsideMappingScopeOfferingCount,
      },
    },
  };
}
