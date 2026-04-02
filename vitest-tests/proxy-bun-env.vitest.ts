import { describe, it, expect, vi, beforeEach } from "vitest"

// 这个用例只验证：在 Bun 环境检测下，fixed proxy 会写入 env，且不会调用 undici。
vi.mock("undici", () => {
  const setGlobalDispatcher = vi.fn(function setGlobalDispatcher(_d: unknown) {
    // noop
  })
  return {
    Agent: vi.fn(function Agent(this: unknown) {
      return { dispatch: vi.fn(), close: vi.fn(), destroy: vi.fn() }
    }),
    ProxyAgent: vi.fn(function ProxyAgent(this: unknown) {
      return { dispatch: vi.fn() }
    }),
    setGlobalDispatcher,
  }
})

describe("proxy (bun env)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY

    // 在 Node(vitest) 环境下模拟 Bun 存在。
    // 使用 defineProperty 避免只读属性报错。
    Object.defineProperty(globalThis, "Bun", {
      value: { version: "test" },
      configurable: true,
    })
  })

  it("initProxy fixed should set HTTP_PROXY and HTTPS_PROXY", async () => {
    const undici = await import("undici")
    const { initProxy } = await import("~/lib/proxy")

    initProxy({
      mode: "fixed",
      proxyUrl: "http://copilot-proxy.lenovo.com:8000",
    })

    expect(process.env.HTTP_PROXY).toBe("http://copilot-proxy.lenovo.com:8000")
    expect(process.env.HTTPS_PROXY).toBe("http://copilot-proxy.lenovo.com:8000")
    expect(undici.setGlobalDispatcher).not.toHaveBeenCalled()
  })
})
