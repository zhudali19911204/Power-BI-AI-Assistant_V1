import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_POLICIES, getFeaturePolicy } from '../../src/shared/feature-contract'
import { FeatureHome } from '../../src/renderer/src/FeatureHome'
import { FEATURE_CATALOG } from '../../src/renderer/src/feature-catalog'

afterEach(() => {
  cleanup()
})

describe('FeatureHome 阶段 2 固定功能首页', () => {
  it('显示五个且仅五个受控功能入口', () => {
    render(<FeatureHome />)

    expect(screen.getByRole('heading', { name: '选择要使用的功能' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: /生成度量值/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /生成计算列/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /生成计算表/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /诊断现有度量值/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /评估当前模型/ })).toBeInTheDocument()
  })

  it('三类生成功能需要完整性确认，诊断和评估明确绕过', () => {
    render(<FeatureHome />)

    expect(screen.getAllByText('需要需求完整性确认')).toHaveLength(3)
    expect(screen.getAllByText('无需业务需求完整性确认')).toHaveLength(2)
    expect(FEATURE_POLICIES).toHaveLength(5)
    expect(getFeaturePolicy('generate_measure').requiresRequirements).toBe(true)
    expect(getFeaturePolicy('diagnose_measure').requiresRequirements).toBe(false)
    expect(getFeaturePolicy('assess_model').writeCapability).toBe('none')
  })

  it.each([
    ['生成度量值', '阶段 4 才会生成和验证 DAX'],
    ['生成计算列', '阶段 5 才会生成、验证和写入计算列'],
    ['生成计算表', '阶段 5 才会生成、验证和写入计算表'],
    ['诊断现有度量值', '阶段 6 开放'],
    ['评估当前模型', '阶段 7 开放']
  ])('选择“%s”时仅显示对应阶段边界', (name, boundary) => {
    render(<FeatureHome />)

    const card = screen.getByRole('button', { name: new RegExp(name) })
    fireEvent.click(card)

    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(`已选择：${name}`)
    expect(screen.getByRole('status')).toHaveTextContent(boundary)
    expect(screen.getByRole('status')).toHaveTextContent(
      '不会收集需求、调用 Provider、生成 DAX、诊断模型或执行模型写入'
    )
  })

  it('点击卡片不访问任何阶段 3 及以后能力', () => {
    const forbiddenApi = {
      startRequirements: vi.fn(),
      callProvider: vi.fn(),
      generateDax: vi.fn(),
      diagnoseMeasure: vi.fn(),
      assessModel: vi.fn(),
      writeModel: vi.fn()
    }

    render(<FeatureHome />)
    for (const feature of FEATURE_CATALOG) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(feature.title) }))
    }

    for (const operation of Object.values(forbiddenApi)) {
      expect(operation).not.toHaveBeenCalled()
    }
  })

  it('切换选择时只保留一个卡片的选中状态', () => {
    render(<FeatureHome />)

    const measure = screen.getByRole('button', { name: /生成度量值/ })
    const assessment = screen.getByRole('button', { name: /评估当前模型/ })
    fireEvent.click(measure)
    fireEvent.click(assessment)

    expect(measure).toHaveAttribute('aria-pressed', 'false')
    expect(assessment).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })
})
