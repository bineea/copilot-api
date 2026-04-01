import {
  type AnthropicResponse,
  type AnthropicTextBlock,
} from "./anthropic-types"

function getString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === "string" ? v : undefined
}

function getNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === "number" ? v : undefined
}

function getUsage(usage: unknown): {
  input_tokens: number
  output_tokens: number
} {
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0 }
  }
  return {
    input_tokens:
      getNumber(usage, "input_tokens")
      ?? getNumber(usage, "prompt_tokens")
      ?? 0,
    output_tokens:
      getNumber(usage, "output_tokens")
      ?? getNumber(usage, "completion_tokens")
      ?? 0,
  }
}

function extractTextFromOutput(output: unknown): string {
  if (!Array.isArray(output)) return ""

  const texts: Array<string> = []

  for (const item of output) {
    if (!item || typeof item !== "object") continue

    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (!part || typeof part !== "object") continue

      const type = (part as Record<string, unknown>).type
      const text = (part as Record<string, unknown>).text
      if (type === "text" && typeof text === "string") {
        texts.push(text)
      }
    }
  }

  return texts.join("")
}

function extractText(res: Record<string, unknown>): string {
  const outputText = getString(res, "output_text")
  if (outputText) return outputText

  return extractTextFromOutput(res.output)
}

export function translateResponsesToAnthropic(
  response: Record<string, unknown>,
): AnthropicResponse {
  const id = getString(response, "id") ?? ""
  const model = getString(response, "model") ?? ""

  // usage can sit at top-level or nested under response.usage
  const nestedResponse = response.response
  const nestedUsage =
    nestedResponse && typeof nestedResponse === "object" ?
      (nestedResponse as Record<string, unknown>).usage
    : undefined
  const usage = getUsage(response.usage ?? nestedUsage)

  const text = extractText(response)
  const content: Array<AnthropicTextBlock> =
    text ? [{ type: "text", text }] : []

  const stopReasonRaw =
    getString(response, "stop_reason")
    ?? getString(response, "finish_reason")
    ?? getString(response.response ?? null, "stop_reason")
    ?? getString(response.response ?? null, "finish_reason")

  const stop_reason = stopReasonRaw === "length" ? "max_tokens" : "end_turn"

  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage,
  }
}
