import { describe, expect, it } from 'vitest'
import { buildAppPath, normalizeAppBasePath } from './e2e/helpers/app-url'

// v2.5.15 URL 合同矩阵：同一份语义 spec 必须在根路径部署与
// /pmbus-calculator/ 前缀部署下产生正确的应用内路径。
describe('normalizeAppBasePath', () => {
  it('空字符串表示根路径部署', () => {
    expect(normalizeAppBasePath('')).toBe('/')
  })

  it('补全末尾斜线并保留路径前缀', () => {
    expect(normalizeAppBasePath('/pmbus-calculator')).toBe('/pmbus-calculator/')
    expect(normalizeAppBasePath('/pmbus-calculator/')).toBe('/pmbus-calculator/')
  })

  it('拒绝相对前缀与 .. 段', () => {
    expect(() => normalizeAppBasePath('pmbus-calculator')).toThrow("must start with '/'")
    expect(() => normalizeAppBasePath('/pmbus/../evil')).toThrow("'..'")
  })
})

describe('buildAppPath', () => {
  it('根路径 base 下应用首页解析为同一根目录', () => {
    expect(buildAppPath({ basePath: '' })).toBe('/')
    expect(buildAppPath({ basePath: '/', path: '/' })).toBe('/')
  })

  it('带前缀 base 保留 /pmbus-calculator/ 前缀与末尾斜线', () => {
    expect(buildAppPath({ basePath: '/pmbus-calculator' })).toBe('/pmbus-calculator/')
    expect(buildAppPath({ basePath: '/pmbus-calculator/' })).toBe('/pmbus-calculator/')
  })

  it('debug 入口保留前缀且 query 含 debug', () => {
    expect(buildAppPath({ basePath: '/pmbus-calculator', query: 'debug' })).toBe(
      '/pmbus-calculator/?debug',
    )
    expect(buildAppPath({ basePath: '', query: '?debug' })).toBe('/?debug')
    expect(buildAppPath({ basePath: '/pmbus-calculator', query: '?a=1&b=2' })).toBe(
      '/pmbus-calculator/?a=1&b=2',
    )
  })

  it('子路径拼接不产生双斜线', () => {
    expect(buildAppPath({ basePath: '/pmbus-calculator', path: '/assets/x.js' })).toBe(
      '/pmbus-calculator/assets/x.js',
    )
    expect(buildAppPath({ basePath: '/', path: '/assets/x.js' })).toBe('/assets/x.js')
  })

  it('拒绝非法路径形态', () => {
    expect(() => buildAppPath({ basePath: '', path: 'assets/x.js' })).toThrow("must start with '/'")
    expect(() => buildAppPath({ basePath: '', path: '/../escape' })).toThrow("'..'")
  })
})
