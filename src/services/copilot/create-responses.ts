import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export interface ResponsesPayload {
  model: string
  // We keep this intentionally loose because Copilot's /responses shape may vary.
  // We'll pass through only what we construct.
  input?: unknown
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  max_output_tokens?: number | null
  max_tokens?: number | null
  tools?: unknown
  tool_choice?: unknown
  user?: string | null
}

export type ResponsesNonStreamingResponse = Record<string, unknown>

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers: {
      ...copilotHeaders(state),
      // Best-effort initiator header (mirrors create-chat-completions).
      "X-Initiator": "user",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesNonStreamingResponse
}
