import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("undici", () => {
  const Agent = vi.fn(function Agent(this: unknown) {
    return { dispatch: vi.fn(), close: vi.fn(), destroy: vi.fn() }
  })

  const ProxyAgent = vi.fn(function ProxyAgent(this: unknown) {
    return { dispatch: vi.fn() }
  })

  const setGlobalDispatcher = vi.fn(function setGlobalDispatcher(_d: unknown) {
    // noop
  })

  return {
    Agent,
    ProxyAgent,
    setGlobalDispatcher,
  }
})

vi.mock("proxy-from-env", () => {
  return {
    getProxyForUrl: vi.fn(() => undefined),
  }
})

describe("proxy", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("initProxy disabled should call setGlobalDispatcher to force direct", async () => {
    const undici = await import("undici")
    const { initProxy } = await import("~/lib/proxy")

    // @ts-expect-error: 测试环境下显式移除 Bun 以走 node 分支
    delete globalThis.Bun

    initProxy({ mode: "disabled" })

    expect(undici.setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("initProxy fixed should call setGlobalDispatcher", async () => {
    const undici = await import("undici")
    const { initProxy } = await import("~/lib/proxy")

    // 由于测试环境是 node，确保走到 setGlobalDispatcher 路径
    // @ts-expect-error: 测试环境下显式移除 Bun 以走 node 分支
    delete globalThis.Bun

    initProxy({
      mode: "fixed",
      proxyUrl: "https://copilot-proxy.lenovo.com:8000",
    })

    expect(undici.setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })

  it("initProxy env should call setGlobalDispatcher", async () => {
    const undici = await import("undici")
    const { initProxy } = await import("~/lib/proxy")

    // @ts-expect-error: 测试环境下显式移除 Bun 以走 node 分支
    delete globalThis.Bun

    initProxy({ mode: "env" })

    expect(undici.setGlobalDispatcher).toHaveBeenCalledTimes(1)
  })
})
