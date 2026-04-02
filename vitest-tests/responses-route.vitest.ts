import { describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"
import { server } from "~/server"

describe("/v1/responses route", () => {
  it("route is mounted (not 404)", async () => {
    state.copilotToken = "test-token"

    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "resp_1", object: "response" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await server.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", input: "hi" }),
    })

    expect(res.status).not.toBe(404)
  })

  it("proxies non-streaming responses", async () => {
    state.copilotToken = "test-token"

    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "resp_1", object: "response" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await server.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", input: "hi", max_tokens: 123 }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ id: "resp_1" })
    expect(fetchMock).toHaveBeenCalled()

    // 转发到 Copilot /responses 时不应包含 max_tokens（上游不支持）
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(typeof init.body).toBe("string")
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty("max_tokens")
  })

  it("streams SSE when stream=true and sets strict SSE headers", async () => {
    state.copilotToken = "test-token"

    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(
          'event: response.created\ndata: {"type":"response.created"}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await server.request("/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", input: "hi", stream: true }),
    })

    expect(res.status).toBe(200)

    const contentType = res.headers.get("content-type") || ""
    expect(contentType).toContain("text/event-stream")

    // Hono 的 streamSSE 可能会覆盖/重写部分头；这里只断言关键的 event-stream 与 no-cache。
    expect(res.headers.get("cache-control") || "").toContain("no-cache")
    expect(res.headers.get("connection") || "").toContain("keep-alive")
  })
})
