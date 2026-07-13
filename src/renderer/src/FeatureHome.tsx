import { useState } from 'react'
import type { FeatureKind } from '../../shared/feature-contract'
import { FEATURE_CATALOG, type FeatureCatalogItem } from './feature-catalog'
import './feature-home.css'

function FeatureCard({
  feature,
  selected,
  onSelect
}: {
  readonly feature: FeatureCatalogItem
  readonly selected: boolean
  readonly onSelect: (kind: FeatureKind) => void
}): React.JSX.Element {
  const descriptionId = `feature-description-${feature.kind}`
  const policyId = `feature-policy-${feature.kind}`

  return (
    <button
      type="button"
      className={`feature-home-card ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      aria-describedby={`${descriptionId} ${policyId}`}
      onClick={() => onSelect(feature.kind)}
    >
      <span className="feature-home-card-heading">
        <span className="feature-home-icon" aria-hidden="true">
          {feature.icon}
        </span>
        <span className="feature-home-availability">{feature.availabilityLabel}</span>
      </span>
      <strong>{feature.title}</strong>
      <span id={descriptionId} className="feature-home-description">
        {feature.description}
      </span>
      <span id={policyId} className="feature-home-policy">
        {feature.requiresRequirements ? '需要需求完整性确认' : '无需业务需求完整性确认'}
      </span>
    </button>
  )
}

export function FeatureHome(): React.JSX.Element {
  const [selectedKind, setSelectedKind] = useState<FeatureKind | null>(null)
  const selectedFeature = FEATURE_CATALOG.find((feature) => feature.kind === selectedKind) ?? null

  return (
    <section className="feature-home" aria-labelledby="feature-home-heading">
      <header className="feature-home-header">
        <div>
          <p className="section-kicker">阶段 2 · 固定功能路由</p>
          <h2 id="feature-home-heading">选择要使用的功能</h2>
          <p>当前阶段只验证功能入口和 Provider 配置，后续业务流程尚未启用。</p>
        </div>
        <span className="feature-home-readonly-badge">不会修改模型</span>
      </header>

      <div className="feature-home-grid" aria-label="Power BI 智能助手功能">
        {FEATURE_CATALOG.map((feature) => (
          <FeatureCard
            key={feature.kind}
            feature={feature}
            selected={selectedKind === feature.kind}
            onSelect={setSelectedKind}
          />
        ))}
      </div>

      <div
        className={`feature-home-boundary ${selectedFeature ? 'has-selection' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="feature-home-boundary-icon" aria-hidden="true">
          {selectedFeature ? '✓' : 'i'}
        </span>
        <div>
          <strong>
            {selectedFeature ? `已选择：${selectedFeature.title}` : '请选择一个功能入口'}
          </strong>
          <p>
            {selectedFeature
              ? selectedFeature.boundaryMessage
              : '选择后会显示对应的开发阶段，本阶段不会启动任何业务任务。'}
          </p>
          {selectedFeature && (
            <small>
              阶段 2 不会收集需求、调用 Provider、生成 DAX、诊断模型或执行模型写入。
            </small>
          )}
        </div>
      </div>
    </section>
  )
}
