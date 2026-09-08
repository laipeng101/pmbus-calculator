// One exact network contract for deterministic smoke and hosted real acceptance.
export {
  CLOUDFLARE_BEACON_URL,
  CLOUDFLARE_RUM_URL,
  CLOUDFLARE_RUM_ORIGIN,
  PAGES_REPOSITORY_URL,
  PAGES_REPOSITORY_NAME,
  RELEASE_CSP,
  PAGES_CSP,
  parseCsp,
  isAllowedPagesRequest,
} from '../../../scripts/pages-network-policy.mjs'
