const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

/**
 * Main agent execution
 */
async function runAgentForItem(ticket, config) {
  const maxToolCalls = config?.maxToolCalls ?? 3;
  const maxLlmAttempts = config?.maxLlmAttempts ?? 3;

  const plan = ["Process ticket"];
  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  // 1. Prompt Injection Check
  const injection = detectPromptInjection(ticket.user_request);
  if (injection.length > 0) {
    return {
      id: ticket.id,
      status: "REJECTED",
      plan,
      tool_calls: [],
      final: {
        action: "REFUSE",
        payload: { reason: "Prompt injection detected" }
      },
      safety: { blocked: true, reasons: injection }
    };
  }

  // 2. Prepare LLM messages
  let messages = [
    { role: "system", content: "You are a controlled agent. Respond in JSON." },
    { role: "user", content: ticket.user_request }
  ];

  let toolCallCount = 0;
  let attempts = 0;

  // 3. Agent Loop
  while (attempts < maxLlmAttempts) {
    const llmRaw = await mockLlm(messages);
    const parsed = safeParse(llmRaw);

    // Retry if malformed JSON
    if (!parsed.ok) {
      attempts++;
      continue;
    }

    const validation = validateLlmResponse(parsed.value);

    // Invalid schema → reject
    if (!validation.ok) {
      return {
        id: ticket.id,
        status: "REJECTED",
        plan,
        tool_calls,
        final: {
          action: "REFUSE",
          payload: { reason: validation.reason }
        },
        safety
      };
    }

    // TOOL CALL
    if (validation.type === "tool_call") {
      const { tool, args } = parsed.value;

      // Check allowlist
      if (!enforceToolAllowlist(tool, ticket.context.allowed_tools)) {
        return {
          id: ticket.id,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: "Tool not allowed" }
          },
          safety
        };
      }

      // Limit tool calls
      if (toolCallCount >= maxToolCalls) {
        return {
          id: ticket.id,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: "Tool call limit exceeded" }
          },
          safety
        };
      }

      try {
        const result = TOOL_REGISTRY[tool](args);

        tool_calls.push({ tool, args });
        toolCallCount++;

        // 🔥 IMPORTANT: Feed result back to LLM
        messages.push({
          role: "assistant",
          content: `TOOL_RESULT: ${JSON.stringify(result)}`
        });

      } catch (error) {
        return {
          id: ticket.id,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: "Tool execution failed" }
          },
          safety
        };
      }

      attempts++;
      continue;
    }

    // FINAL RESPONSE
    if (validation.type === "final") {
      return {
        id: ticket.id,
        status: "DONE",
        plan,
        tool_calls,
        final: parsed.value.final,
        safety
      };
    }
  }

  // Max attempts reached
  return {
    id: ticket.id,
    status: "REJECTED",
    plan,
    tool_calls,
    final: {
      action: "REFUSE",
      payload: { reason: "Max attempts reached" }
    },
    safety
  };
}

module.exports = {
  runAgentForItem
};
