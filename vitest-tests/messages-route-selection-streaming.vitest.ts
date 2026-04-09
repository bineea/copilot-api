import { describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"
import { server } from "~/server"

type ModelsLike = {
  data: Array<{
    id: string
    supported_endpoints: Array<string>
  }>
}

describe("/v1/messages route selection (streaming)", () => {
  it("does not fallback after /responses selected when stream=true", async () => {
    state.copilotToken = "test-token"
    state.models = {
      data: [
        {
          id: "gpt-5.4",
          supported_endpoints: ["/responses", "/chat/completions"],
        },
      ],
    } satisfies ModelsLike as unknown as typeof state.models

    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/responses")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "nope" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/chat/completions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }

      return Promise.reject(new Error("unexpected url"))
    })
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    const res = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 123,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    })

    // stream=true 在 upstream 报错时仍应返回错误（且不能回退到 chat）
    expect(res.status).toBe(400)

    const calls = fetchMock.mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.endsWith("/responses"))).toBe(true)
    expect(calls.some((u) => u.endsWith("/chat/completions"))).toBe(false)
  })

  it("treats omitted stream as streaming and does not fallback", async () => {
    state.copilotToken = "test-token"
    state.models = {
      data: [
        {
          id: "gpt-5.4",
          supported_endpoints: ["/responses", "/chat/completions"],
        },
      ],
    } satisfies ModelsLike as unknown as typeof state.models

    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/responses")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "nope" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        )
      }

      if (url.endsWith("/chat/completions")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }

      return Promise.reject(new Error("unexpected url"))
    })
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)

    const res = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 123,
        messages: [{ role: "user", content: "hi" }],
      }),
    })

    expect(res.status).toBe(400)

    const calls = fetchMock.mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.endsWith("/responses"))).toBe(true)
    expect(calls.some((u) => u.endsWith("/chat/completions"))).toBe(false)

    const responseCall = fetchMock.mock.calls.find((c) =>
      c[0].endsWith("/responses"),
    )

    expect(responseCall).toBeDefined()

    const [_url, init] = responseCall as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.stream).toBe(true)
  })
})
