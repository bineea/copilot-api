/* eslint-disable max-lines-per-function */
import { afterEach, describe, expect, it, vi } from "vitest"

import { initProxy } from "~/lib/proxy"
import {
  DEFAULT_PROXY_URL,
  formatProxyStartupStatus,
  resolveProxyRouteForUrl,
  resolveProxyInitOptions,
} from "~/lib/proxy-options"
import {
  createRequestLogContext,
  formatProxyRouteSummary,
  runWithRequestLogContext,
} from "~/lib/request-context"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  Reflect.deleteProperty(globalThis, Symbol.for("copilot-api.proxyLoggedFetch"))
  Reflect.deleteProperty(
    globalThis,
    Symbol.for("copilot-api.proxyLoggingOptions"),
  )
  vi.unstubAllGlobals()
})

describe("proxy selection", () => {
  it("uses the default fixed proxy when no explicit flags are set", () => {
    expect(
      resolveProxyInitOptions({
        proxyEnv: false,
        noProxy: false,
      }),
    ).toEqual({
      mode: "fixed",
      proxyUrl: DEFAULT_PROXY_URL,
    })
  })

  it("disables proxy when --no-proxy is set", () => {
    expect(
      resolveProxyInitOptions({
        proxyEnv: true,
        proxy: "https://custom.example:9000",
        noProxy: true,
      }),
    ).toEqual({ mode: "disabled" })
  })

  it("uses the explicit fixed proxy when --proxy is set", () => {
    expect(
      resolveProxyInitOptions({
        proxyEnv: false,
        proxy: "https://custom.example:9000",
        noProxy: false,
      }),
    ).toEqual({
      mode: "fixed",
      proxyUrl: "https://custom.example:9000",
    })
  })

  it("uses environment-driven proxy when --proxy-env is set", () => {
    expect(
      resolveProxyInitOptions({
        proxyEnv: true,
        noProxy: false,
      }),
    ).toEqual({ mode: "env" })
  })

  it("prefers --proxy over --proxy-env", () => {
    expect(
      resolveProxyInitOptions({
        proxyEnv: true,
        proxy: "https://custom.example:9000",
        noProxy: false,
      }),
    ).toEqual({
      mode: "fixed",
      proxyUrl: "https://custom.example:9000",
    })
  })

  it("formats the default proxy startup status clearly", () => {
    expect(
      formatProxyStartupStatus({
        mode: "fixed",
        proxyUrl: DEFAULT_PROXY_URL,
      }),
    ).toBe(
      "Proxy status: enabled (default) via https://copilot-proxy.lenovo.com:8000",
    )
  })

  it("formats environment proxy startup status clearly", () => {
    expect(
      formatProxyStartupStatus(
        { mode: "env" },
        { HTTPS_PROXY: "http://env-proxy.example:8080" },
      ),
    ).toBe(
      "Proxy status: enabled (environment) via HTTPS_PROXY=http://env-proxy.example:8080",
    )
  })

  it("formats missing environment proxy state clearly", () => {
    expect(formatProxyStartupStatus({ mode: "env" }, {})).toBe(
      "Proxy status: environment mode requested, but no HTTP_PROXY/HTTPS_PROXY is set",
    )
  })

  it("resolves fixed proxy requests as proxy route", () => {
    expect(
      resolveProxyRouteForUrl("https://api.github.com/user", {
        mode: "fixed",
        proxyUrl: DEFAULT_PROXY_URL,
      }),
    ).toEqual({
      hostname: "api.github.com",
      route: DEFAULT_PROXY_URL,
    })
  })

  it("resolves env mode without proxy variables as direct route", () => {
    expect(
      resolveProxyRouteForUrl(
        "https://api.github.com/user",
        { mode: "env" },
        {},
      ),
    ).toEqual({
      hostname: "api.github.com",
      route: "direct",
    })
  })

  it("resolves env mode with proxy variables as proxy route", () => {
    expect(
      resolveProxyRouteForUrl(
        "https://api.github.com/user",
        { mode: "env" },
        { HTTPS_PROXY: "http://env-proxy.example:8080" },
      ),
    ).toEqual({
      hostname: "api.github.com",
      route: "http://env-proxy.example:8080",
    })
  })

  it("updates proxy request logging when the proxy mode changes", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    )
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    initProxy({
      mode: "fixed",
      proxyUrl: "https://fixed-proxy.example:9000",
    })
    initProxy({ mode: "disabled" })

    const context = createRequestLogContext()
    await runWithRequestLogContext(context, async () => {
      await fetch("https://api.github.com/user")
    })

    expect(formatProxyRouteSummary(context)).toBe("api.github.com -> direct")
  })
})
