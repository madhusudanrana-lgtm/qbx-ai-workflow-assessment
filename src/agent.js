const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

async function runAgentForItem(ticket, config) {
  const maxToolCalls = config?.maxToolCalls ?? 3;
  const maxLlmAttempts = config?.maxLlmAttempts ?? 3;

  const plan = [
    "Analyze request",
    "Call LLM",
    "Execute tool if needed",
    "Return response"
  ];

  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  // 🔒 Prompt Injection Check
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

  let messages = [
    { role: "system", content: "You are a controlled agent. Respond in JSON." },
    { role: "user", content: ticket.user_request }
  ];

  let attempts = 0;
  let toolCallCount = 0;

  while (attempts < maxLlmAttempts) {
    const llmRaw = await mockLlm(messages);
    const parsed = safeParse(llmRaw);

    // Retry if JSON invalid
    if (!parsed.ok) {
      attempts++;
      continue;
    }

    const validation = validateLlmResponse(parsed.value);

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

    // 🔧 TOOL CALL
    if (validation.type === "tool_call") {
      const { tool, args } = parsed.value;

      // Allowlist check
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

      // Tool limit check
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

      const result = TOOL_REGISTRY[tool](args);

      tool_calls.push({ tool, args });
      toolCallCount++;

      // 🔥 CRITICAL STEP → enables final response
      messages.push({
        role: "assistant",
        content: `TOOL_RESULT: ${JSON.stringify(result)}`
      });

      // Do NOT increment attempts here (important fix)
      continue;
    }

    // ✅ FINAL RESPONSE
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

  // ❌ If max attempts reached
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
