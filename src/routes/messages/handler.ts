import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { HTTPError } from "~/lib/error"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createResponses } from "~/services/copilot/create-responses"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateResponsesToAnthropic } from "./responses-non-stream-translation"
import { translateResponsesEventToAnthropicEvents } from "./responses-stream-translation"
import {
  translateChunkToAnthropicEvents,
  translateErrorToAnthropicErrorEvent,
} from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  // 避免泄露敏感内容与过大日志：只输出摘要
  consola.debug("Anthropic request meta:", {
    model: anthropicPayload.model,
    stream: anthropicPayload.stream,
    max_tokens: anthropicPayload.max_tokens,
    hasTools: Boolean(anthropicPayload.tools?.length),
    messageCount: anthropicPayload.messages.length,
  })

  const openAIPayload = translateToOpenAI(anthropicPayload)
  consola.debug("Translated OpenAI request meta:", {
    model: openAIPayload.model,
    stream: openAIPayload.stream,
    max_tokens: openAIPayload.max_tokens,
    hasTools: Boolean(openAIPayload.tools?.length),
    messageCount: openAIPayload.messages.length,
  })

  const selectedModel = state.models?.data.find(
    (model) => model.id === openAIPayload.model,
  )

  const supportedEndpoints = selectedModel?.supported_endpoints ?? []
  const canUseResponses = supportedEndpoints.includes("/responses")
  const canUseChatCompletions = supportedEndpoints.includes("/chat/completions")

  if (state.manualApprove) {
    await awaitApproval()
  }

  if (canUseResponses) {
    try {
      return await handleCopilotResponses(c, openAIPayload)
    } catch (err) {
      if (openAIPayload.stream) {
        // streaming 一旦开始就不允许 fallback（否则可能导致双响应/破坏 SSE 协议）
        throw err
      }

      if (!canUseChatCompletions) {
        throw err
      }

      if (!shouldFallbackFromResponses(err)) {
        throw err
      }

      consola.warn("Copilot /responses 失败，回退到 /chat/completions", {
        model: openAIPayload.model,
        stream: openAIPayload.stream ?? false,
        reason: getResponsesFailureReason(err),
      })
    }
  }

  // Fallback / default: chat/completions
  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isNonStreamingResponses = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is Record<string, unknown> => Object.hasOwn(response, "id")

const shouldFallbackFromResponses = (err: unknown) => {
  if (err instanceof HTTPError) {
    const status = err.response.status
    // 认证/权限/限流不回退，避免掩盖问题
    if (status === 401 || status === 403 || status === 429) {
      return false
    }
    // 4xx（除 401/403/429）优先认为是“该模型/参数在 /responses 不兼容”，允许回退
    if (status >= 400 && status < 500) {
      return true
    }
    // 5xx：上游不稳定时允许回退到另一个端点
    if (status >= 500) {
      return true
    }
    return false
  }

  // 非 HTTPError：在 non-stream 情况下认为 /responses 不可用/不稳定，允许回退
  if (err instanceof Error) {
    return true
  }

  return false
}

const getResponsesFailureReason = (err: unknown) => {
  if (err instanceof HTTPError) {
    return {
      status: err.response.status,
      statusText: err.response.statusText,
    }
  }

  return {
    message: err instanceof Error ? err.message : String(err),
  }
}

async function handleCopilotResponses(
  c: Context,
  openAIPayload: Parameters<typeof createChatCompletions>[0],
) {
  const responsesPayload = {
    model: openAIPayload.model,
    input: openAIPayload.messages,
    stream: openAIPayload.stream,
    temperature: openAIPayload.temperature ?? null,
    top_p: openAIPayload.top_p ?? null,
    // Copilot /responses tends to use max_output_tokens
    max_output_tokens: openAIPayload.max_tokens ?? null,
    tools: openAIPayload.tools ?? null,
    tool_choice: openAIPayload.tool_choice ?? null,
    user: openAIPayload.user ?? null,
  }

  const response = await createResponses(responsesPayload)

  if (isNonStreamingResponses(response)) {
    consola.debug(
      "Non-streaming response from Copilot /responses:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateResponsesToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot /responses")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    try {
      for await (const rawEvent of response) {
        consola.debug("Copilot /responses raw stream event meta:", {
          event: rawEvent.event,
          hasData: Boolean(rawEvent.data),
          dataLen: rawEvent.data?.length ?? 0,
        })
        if (!rawEvent.data) {
          continue
        }

        if (rawEvent.data === "[DONE]") {
          break
        }

        let evt: Record<string, unknown>
        try {
          evt = JSON.parse(rawEvent.data) as Record<string, unknown>
        } catch {
          consola.warn("Failed to parse Copilot /responses event JSON", {
            event: rawEvent.event,
            dataLen: rawEvent.data.length,
          })
          continue
        }

        const events = translateResponsesEventToAnthropicEvents(
          evt,
          streamState,
        )

        for (const event of events) {
          consola.debug("Translated Anthropic event:", JSON.stringify(event))
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          })
        }
      }
    } catch (err) {
      consola.warn("Copilot /responses 流式传输中断", {
        model: openAIPayload.model,
        reason: getResponsesFailureReason(err),
      })

      // 最佳努力：通知客户端流异常并终止（不同客户端可能依赖终止事件）
      try {
        const errorEvent = translateErrorToAnthropicErrorEvent()
        await stream.writeSSE({
          event: errorEvent.type,
          data: JSON.stringify(errorEvent),
        })
      } catch {
        // ignore
      }

      try {
        await stream.writeSSE({
          event: "message_stop",
          data: JSON.stringify({ type: "message_stop" }),
        })
      } catch {
        // ignore
      }
    }
  })
}
