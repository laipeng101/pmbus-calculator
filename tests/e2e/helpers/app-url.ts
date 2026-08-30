/**
 * 统一的应用内相对 URL 合同（v2.5.15）。
 *
 * 语义 E2E 不得直接 `page.goto('/')`：Playwright 把 '/' 相对 baseURL 根解析，
 * 会丢弃部署路径前缀（如 GitHub Pages 的 /pmbus-calculator/）。所有应用内
 * 导航必须经 `appUrl()` 生成，由目标配置通过 `E2E_APP_BASE_PATH` 声明部署
 * 前缀（根路径部署缺省为 ''，即 '/'）。
 *
 * 这是纯路径构造函数：不接受 scheme/authority，不产生含凭据的 URL；
 * 前缀与路径中的 `..` 段一律拒绝，不做重写或解析兜底。
 */

const RAW_BASE_PATH = process.env.E2E_APP_BASE_PATH ?? ''

/** 规范化部署前缀：'' → '/'；其余必须以 '/' 开头、不以 '/' 结尾去重后返回。 */
export function normalizeAppBasePath(raw: string): string {
  if (raw === '') return '/'
  if (raw.includes('..')) {
    throw new Error(`E2E_APP_BASE_PATH must not contain '..' segments: ${raw}`)
  }
  if (!raw.startsWith('/')) {
    throw new Error(`E2E_APP_BASE_PATH must start with '/': ${raw}`)
  }
  const withoutTrailing = raw.replace(/\/+$/, '')
  return withoutTrailing === '' ? '/' : `${withoutTrailing}/`
}

export interface AppPathOptions {
  /** 部署前缀，如 ''（根路径）或 '/pmbus-calculator'。 */
  basePath: string
  /** 应用内路径，以 '/' 开头；缺省为应用根。 */
  path?: string
  /** 查询串；'debug' 或 '?debug' 等价，附加在路径后。 */
  query?: string
}

/** 显式参数版本的路径构造，供单元测试与运行时共用同一实现。 */
export function buildAppPath({ basePath, path = '/', query }: AppPathOptions): string {
  if (path.includes('..')) {
    throw new Error(`app path must not contain '..' segments: ${path}`)
  }
  if (!path.startsWith('/')) {
    throw new Error(`app path must start with '/': ${path}`)
  }
  const prefix = normalizeAppBasePath(basePath)
  const withoutTrailing = prefix.replace(/\/+$/, '')
  const joined =
    path === '/' ? prefix : `${withoutTrailing}${path.startsWith('/') ? path : `/${path}`}`
  const search = query === undefined ? '' : query.startsWith('?') ? query : `?${query}`
  return `${joined}${search}`
}

/** 当前目标配置的部署前缀（'' 或以 '/' 开头、不以 '/' 结尾的原始声明值）。 */
export function appBasePath(): string {
  return RAW_BASE_PATH
}

/** 当前目标配置下的应用内 URL（相对 baseURL 的路径形式）。 */
export function appUrl(path?: string, query?: string): string {
  return buildAppPath({ basePath: RAW_BASE_PATH, path, query })
}
