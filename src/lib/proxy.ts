import consola from "consola"
import { getProxyForUrl } from "proxy-from-env"
import { Agent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici"

import { formatUrlForLog } from "./url"

export type ProxyInitOptions =
  | { mode: "env" }
  | { mode: "fixed"; proxyUrl: string }
  | { mode: "disabled" }

export function initProxyFromEnv(): void {
  initProxy({ mode: "env" })
}

export function initProxy(opts: ProxyInitOptions): void {
  if (opts.mode === "disabled") {
    if (typeof Bun !== "undefined") {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      consola.debug("Bun proxy disabled (cleared HTTP_PROXY/HTTPS_PROXY)")
      return
    }

    // Node/undici: force direct by overriding any default proxy behavior.
    setGlobalDispatcher(new Agent())
    consola.debug("HTTP proxy disabled (forced direct dispatcher)")
    return
  }

  if (typeof Bun !== "undefined") {
    // Bun 下无法通过 undici 的 setGlobalDispatcher 影响全局 fetch。
    // 采取等效策略：通过环境变量让 Bun 的网络栈走代理。
    if (opts.mode === "fixed") {
      // 同时设置 HTTP_PROXY 和 HTTPS_PROXY（你的偏好）
      process.env.HTTP_PROXY = opts.proxyUrl
      process.env.HTTPS_PROXY = opts.proxyUrl
      consola.debug(
        `Bun proxy configured via env: ${formatUrlForLog(opts.proxyUrl)}`,
      )
    } else {
      const current = process.env.HTTPS_PROXY
      consola.debug(
        `Bun proxy mode=${opts.mode} (env-driven). Current HTTPS_PROXY=${current ? formatUrlForLog(current) : ""}`,
      )
    }
    return
  }

  try {
    const direct = new Agent()
    const proxies = new Map<string, ProxyAgent>()
    const fixedProxyUrl = opts.mode === "fixed" ? opts.proxyUrl : undefined

    // We only need a minimal dispatcher that implements `dispatch` at runtime.
    // Typing the object as `Dispatcher` forces TypeScript to require many
    // additional methods. Instead, keep a plain object and cast when passing
    // to `setGlobalDispatcher`.
    const dispatcher = {
      dispatch(
        options: Dispatcher.DispatchOptions,
        handler: Dispatcher.DispatchHandler,
      ) {
        try {
          const origin =
            typeof options.origin === "string" ?
              new URL(options.origin)
            : (options.origin as URL)
          const proxyUrl =
            fixedProxyUrl
            ?? (() => {
              const get = getProxyForUrl as unknown as (
                u: string,
              ) => string | undefined
              const raw = get(origin.toString())
              return raw && raw.length > 0 ? raw : undefined
            })()
          if (!proxyUrl) {
            consola.debug(`HTTP proxy bypass: ${origin.hostname}`)
            return (direct as unknown as Dispatcher).dispatch(options, handler)
          }
          let agent = proxies.get(proxyUrl)
          if (!agent) {
            agent = new ProxyAgent(proxyUrl)
            proxies.set(proxyUrl, agent)
          }
          consola.debug(
            `HTTP proxy route: ${origin.hostname} via ${formatUrlForLog(proxyUrl)}`,
          )
          return (agent as unknown as Dispatcher).dispatch(options, handler)
        } catch {
          return (direct as unknown as Dispatcher).dispatch(options, handler)
        }
      },
      close() {
        return direct.close()
      },
      destroy() {
        return direct.destroy()
      },
    }

    setGlobalDispatcher(dispatcher as unknown as Dispatcher)
    consola.debug(
      fixedProxyUrl ?
        `HTTP proxy configured: fixed (${formatUrlForLog(fixedProxyUrl)})`
      : "HTTP proxy configured from environment (per-URL)",
    )
  } catch (err) {
    consola.debug("Proxy setup skipped:", err)
  }
}
