import { describe, expect, it, vi } from "vitest"

import { state } from "~/lib/state"
import { server } from "~/server"

type ModelsLike = {
  data: Array<{
    id: string
    supported_endpoints: Array<string>
  }>
}

describe("/v1/messages routes to /responses", () => {
  it("does not send max_tokens to Copilot /responses", async () => {
    state.copilotToken = "test-token"
    const models = {
      data: [
        {
          id: "gpt-5.4",
          supported_endpoints: ["/responses"],
        },
      ],
    } satisfies ModelsLike

    state.models = models as unknown as typeof state.models

    const fetchMock = vi.fn(() => {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "resp_1", object: "response" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetchMock)

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
    expect(fetchMock).toHaveBeenCalled()

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(typeof init.body).toBe("string")
    const body = JSON.parse(init.body as string) as Record<string, unknown>

    expect(body).not.toHaveProperty("max_tokens")
    expect(body).toMatchObject({ max_output_tokens: 123 })
  })
})
