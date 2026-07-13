import type { FeatureKind, FeaturePolicy } from '../../shared/feature-contract'
import { FEATURE_POLICIES } from '../../shared/feature-contract'

export interface FeatureCatalogItem extends FeaturePolicy {
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly availabilityLabel: string
  readonly boundaryMessage: string
}

const featureCopy: Readonly<
  Record<
    FeatureKind,
    Pick<
      FeatureCatalogItem,
      'title' | 'description' | 'icon' | 'availabilityLabel' | 'boundaryMessage'
    >
  >
> = {
  generate_measure: {
    title: '生成度量值',
    description: '根据业务指标需求生成可验证的 DAX 度量值。',
    icon: '∑',
    availabilityLabel: '阶段 3 澄清 · 阶段 4 生成',
    boundaryMessage:
      '阶段 3 将完成需求完整性确认，阶段 4 才会生成和验证 DAX。'
  },
  generate_calculated_column: {
    title: '生成计算列',
    description: '为指定表设计需要物化的逐行计算逻辑。',
    icon: 'ƒ',
    availabilityLabel: '阶段 3 澄清 · 阶段 5 生成',
    boundaryMessage:
      '阶段 3 将完成需求完整性确认，阶段 5 才会生成、验证和写入计算列。'
  },
  generate_calculated_table: {
    title: '生成计算表',
    description: '根据明确粒度、来源和用途设计计算表。',
    icon: '▦',
    availabilityLabel: '阶段 3 澄清 · 阶段 5 生成',
    boundaryMessage:
      '阶段 3 将完成需求完整性确认，阶段 5 才会生成、验证和写入计算表。'
  },
  diagnose_measure: {
    title: '诊断现有度量值',
    description: '直接选择现有度量值，分析正确性、上下文和性能风险。',
    icon: '⌕',
    availabilityLabel: '阶段 6 开放',
    boundaryMessage:
      '该功能将在阶段 6 开放，并会绕过业务需求完整性确认流程。'
  },
  assess_model: {
    title: '评估当前模型',
    description: '只读检查模型结构、关系、日期表和对象组织。',
    icon: '☷',
    availabilityLabel: '阶段 7 开放',
    boundaryMessage:
      '该功能将在阶段 7 开放，并会绕过业务需求完整性确认且保持严格只读。'
  }
}

export const FEATURE_CATALOG: readonly FeatureCatalogItem[] = FEATURE_POLICIES.map((policy) => ({
  ...policy,
  ...featureCopy[policy.kind]
}))
