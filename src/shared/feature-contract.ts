export type FeatureKind =
  | 'generate_measure'
  | 'generate_calculated_column'
  | 'generate_calculated_table'
  | 'diagnose_measure'
  | 'assess_model'

export type FeatureTarget = 'none' | 'table' | 'measure'

export type FeatureWriteCapability =
  | 'none'
  | 'measure'
  | 'calculatedColumn'
  | 'calculatedTable'

export interface FeaturePolicy {
  readonly kind: FeatureKind
  readonly requiresRequirements: boolean
  readonly requiresTarget: FeatureTarget
  readonly writeCapability: FeatureWriteCapability
}

export const FEATURE_POLICIES = [
  {
    kind: 'generate_measure',
    requiresRequirements: true,
    requiresTarget: 'none',
    writeCapability: 'measure'
  },
  {
    kind: 'generate_calculated_column',
    requiresRequirements: true,
    requiresTarget: 'table',
    writeCapability: 'calculatedColumn'
  },
  {
    kind: 'generate_calculated_table',
    requiresRequirements: true,
    requiresTarget: 'none',
    writeCapability: 'calculatedTable'
  },
  {
    kind: 'diagnose_measure',
    requiresRequirements: false,
    requiresTarget: 'measure',
    writeCapability: 'none'
  },
  {
    kind: 'assess_model',
    requiresRequirements: false,
    requiresTarget: 'none',
    writeCapability: 'none'
  }
] as const satisfies readonly FeaturePolicy[]

export function getFeaturePolicy(kind: FeatureKind): FeaturePolicy {
  const policy = FEATURE_POLICIES.find((candidate) => candidate.kind === kind)

  if (!policy) {
    throw new Error(`Unknown feature kind: ${kind}`)
  }

  return policy
}
