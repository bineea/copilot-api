import { afterEach, describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"

type ModelsLike = {
  data: Array<{
    id: string
    supported_endpoints: Array<string>
  }>
}

vi.mock("fetch-event-stream", () => {
  return {
    events: async function* () {
      yield { event: "response.created", data: "{}" }
      await Promise.resolve()
      throw new Error("stream broke")
    },
  }
})

const importServer = async () => {
  const mod = await import("~/server")
  return mod.server
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("/v1/messages route selection (streaming mid-stream failure)", () => {
  it("does not fallback to /chat/completions when /responses stream iterator throws", async () => {
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
        // Return a 200 so createResponses() goes into events(response)
        return Promise.resolve(
          new Response("event: response.created\ndata: {}\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
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

    const server = await importServer()

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

    // Should return an SSE response (not fallback JSON)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") || "").toContain("text/event-stream")

    const calls = fetchMock.mock.calls.map((c) => c[0])
    expect(calls.some((u) => u.endsWith("/responses"))).toBe(true)
    expect(calls.some((u) => u.endsWith("/chat/completions"))).toBe(false)
  })
})
