import { describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"
import { server } from "~/server"

type ModelsLike = {
  data: Array<{
    id: string
    supported_endpoints: Array<string>
  }>
}

describe("/v1/messages route selection", () => {
  it("prefers /responses when available", async () => {
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
          new Response(JSON.stringify({ id: "resp_1", object: "response" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "unexpected" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock as typeof fetch)

    const res = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 123,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
    })

    expect(res.status).toBe(200)

    const calls = fetchMock.mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.endsWith("/responses"))).toBe(true)
    expect(calls.some((u) => u.endsWith("/chat/completions"))).toBe(false)

    const [_url, init] = fetchMock.mock.calls.find((c) =>
      c[0].endsWith("/responses"),
    ) as [string, RequestInit]

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty("max_tokens")
    expect(body).toMatchObject({ max_output_tokens: 123 })
  })
})

describe("/v1/messages route selection fallback", () => {
  it("falls back to /chat/completions when /responses fails", async () => {
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
          new Response(
            JSON.stringify({
              error: { message: "model not supported", code: "unsupported" },
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      }

      if (url.endsWith("/chat/completions")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "chatcmpl_1",
              object: "chat.completion",
              created: 0,
              model: "gpt-5.4",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  message: { role: "assistant", content: "ok" },
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        )
      }

      return Promise.reject(new Error("unexpected url"))
    })
    vi.stubGlobal("fetch", fetchMock as typeof fetch)

    const res = await server.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_tokens: 123,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
    })

    expect(res.status).toBe(200)

    const calls = fetchMock.mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.endsWith("/responses"))).toBe(true)
    expect(calls.some((u) => u.endsWith("/chat/completions"))).toBe(true)
  })
})
