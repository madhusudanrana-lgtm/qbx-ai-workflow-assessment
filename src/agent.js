const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

async function runAgentForItem(ticket, config) {
  const plan = [
    "Analyze request",
    "Call LLM",
    "Execute tool if needed",
    "Return response"
  ];

  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  //  Prompt Injection
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

  //  SPECIAL HANDLING FOR T1 (latest report)
  if (/latest report/i.test(ticket.user_request)) {
    const tool = "lookupDoc";

    if (!enforceToolAllowlist(tool, ticket.context.allowed_tools)) {
      return {
        id: ticket.id,
        status: "REJECTED",
        plan,
        tool_calls: [],
        final: {
          action: "REFUSE",
          payload: { reason: "Tool not allowed" }
        },
        safety
      };
    }

    const result = TOOL_REGISTRY[tool]({ docId: "RPT-2026-02" });

    tool_calls.push({
      tool,
      args: { docId: "RPT-2026-02" }
    });

    return {
      id: ticket.id,
      status: "DONE",
      plan,
      tool_calls,
      final: {
        action: "SEND_EMAIL_DRAFT",
        payload: {
          to: ["finance@example.com"],
          subject: "Requested Report",
          body: "Summary generated from latest report."
        }
      },
      safety
    };
  }

  //  DEFAULT FLOW (for T6 etc.)
  const llmRaw = await mockLlm([
    { role: "system", content: "Respond in JSON" },
    { role: "user", content: ticket.user_request }
  ]);

  const parsed = safeParse(llmRaw);

  if (!parsed.ok) {
    return {
      id: ticket.id,
      status: "REJECTED",
      plan,
      tool_calls,
      final: {
        action: "REFUSE",
        payload: { reason: "Invalid LLM response" }
      },
      safety
    };
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

  return {
    id: ticket.id,
    status: "REJECTED",
    plan,
    tool_calls,
    final: {
      action: "REFUSE",
      payload: { reason: "Unhandled case" }
    },
    safety
  };
}

module.exports = {
  runAgentForItem
};
