import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponsesNonStreamingResponse,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const payloadRaw = await c.req.json<Record<string, unknown>>()

  // /responses 上游不支持 max_tokens（使用 max_output_tokens）
  if (Object.hasOwn(payloadRaw, "max_tokens")) {
    delete payloadRaw.max_tokens
  }

  const payload = payloadRaw as ResponsesPayload

  // 避免泄露敏感内容，只输出摘要
  try {
    consola.debug("/v1/responses request:", {
      model: payload.model,
      stream: payload.stream ?? false,
      hasInput: payload.input !== undefined,
      hasTools: payload.tools !== undefined && payload.tools !== null,
    })
  } catch {
    // ignore logging failures
  }

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createResponses(payload)

  if (isNonStreaming(response)) {
    return c.json(response)
  }

  // 更严格的 SSE 响应头：OpenAI 风格客户端通常依赖这些头判断是否为事件流。
  c.header("Content-Type", "text/event-stream; charset=utf-8")
  c.header("Cache-Control", "no-cache, no-transform")
  c.header("Connection", "keep-alive")
  // 避免反向代理（如 Nginx）缓冲 SSE
  c.header("X-Accel-Buffering", "no")

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of response) {
        if (!event.data) {
          continue
        }

        if (event.data === "[DONE]") {
          break
        }

        // 完全透传：不重建 message，避免丢失 id/retry 等字段。
        await stream.writeSSE(event as SSEMessage)
      }
    } catch {
      // 最佳努力：告知客户端并结束
      try {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: {
              message: "Upstream SSE aborted.",
              type: "error",
            },
          }),
        })
      } catch {
        // ignore
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesNonStreamingResponse => Object.hasOwn(response, "id")
