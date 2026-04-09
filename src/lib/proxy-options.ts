import type { ProxyInitOptions } from "./proxy"

import { formatUrlForLog } from "./url"

export const DEFAULT_PROXY_URL = "https://copilot-proxy.lenovo.com:8000"

export interface ProxySelectionOptions {
  proxyEnv: boolean
  proxy?: string
  noProxy: boolean
}

export interface ProxyEnvLike {
  [key: string]: string | undefined
  HTTP_PROXY?: string
  HTTPS_PROXY?: string
  http_proxy?: string
  https_proxy?: string
}

export interface ProxyRouteInfo {
  hostname: string
  route: string
}

export function resolveProxyInitOptions(
  options: ProxySelectionOptions,
): ProxyInitOptions {
  if (options.noProxy) {
    return { mode: "disabled" }
  }

  if (options.proxy) {
    return { mode: "fixed", proxyUrl: options.proxy }
  }

  if (options.proxyEnv) {
    return { mode: "env" }
  }

  return { mode: "fixed", proxyUrl: DEFAULT_PROXY_URL }
}

export function formatProxyStartupStatus(
  options: ProxyInitOptions,
  env: ProxyEnvLike = process.env,
): string {
  switch (options.mode) {
    case "disabled": {
      return "Proxy status: disabled (`--no-proxy`)"
    }
    case "fixed": {
      const proxyUrl = formatUrlForLog(options.proxyUrl)

      return options.proxyUrl === DEFAULT_PROXY_URL ?
          `Proxy status: enabled (default) via ${proxyUrl}`
        : `Proxy status: enabled (fixed) via ${proxyUrl}`
    }
    case "env": {
      const httpsProxy = env.HTTPS_PROXY ?? env.https_proxy
      const httpProxy = env.HTTP_PROXY ?? env.http_proxy

      if (httpsProxy) {
        return `Proxy status: enabled (environment) via HTTPS_PROXY=${formatUrlForLog(httpsProxy)}`
      }

      if (httpProxy) {
        return `Proxy status: enabled (environment) via HTTP_PROXY=${formatUrlForLog(httpProxy)}`
      }

      return "Proxy status: environment mode requested, but no HTTP_PROXY/HTTPS_PROXY is set"
    }
    default: {
      return "Proxy status: unknown"
    }
  }
}

export function resolveProxyRouteForUrl(
  rawUrl: string,
  options: ProxyInitOptions,
  env: ProxyEnvLike = process.env,
): ProxyRouteInfo {
  const hostname = getHostnameForLog(rawUrl)

  if (options.mode === "disabled") {
    return { hostname, route: "direct" }
  }

  if (options.mode === "fixed") {
    return { hostname, route: formatUrlForLog(options.proxyUrl) }
  }

  const envProxyUrl = getEnvProxyUrl(env)

  return envProxyUrl ?
      { hostname, route: formatUrlForLog(envProxyUrl) }
    : { hostname, route: "direct" }
}

function getEnvProxyUrl(env: ProxyEnvLike): string | undefined {
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
}

function getHostnameForLog(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname
  } catch {
    return rawUrl
  }
}
