const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

/**
 * runAgentForItem(ticket, config)
 *
 * config:
 *  - maxToolCalls
 *  - maxLlmAttempts
 *
 * Must return:
 * {
 *   id,
 *   status: "DONE" | "NEEDS_CLARIFICATION" | "REJECTED",
 *   plan: string[],
 *   tool_calls: { tool: string, args: object }[],
 *   final: { action: "SEND_EMAIL_DRAFT" | "REQUEST_INFO" | "REFUSE", payload: object },
 *   safety: { blocked: boolean, reasons: string[] }
 * }
 */
async function runAgentForItem(ticket, config) {
  const maxToolCalls = config?.maxToolCalls ?? 3;
  const maxLlmAttempts = config?.maxLlmAttempts ?? 3;

  const plan = [
    "Review the ticket request",
    "Check safety guardrails",
    "Call allowed tools only if needed",
    "Return a deterministic final action"
  ];

  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  const ticketId = ticket?.id || "UNKNOWN";
  const userRequest = ticket?.user_request || "";
  const allowedTools = ticket?.context?.allowed_tools || [];

  // 1) Prompt injection detection before any LLM/tool usage
  const injectionIssues = detectPromptInjection(userRequest);
  if (injectionIssues.length > 0) {
    safety.blocked = true;
    safety.reasons = injectionIssues;

    return {
      id: ticketId,
      status: "REJECTED",
      plan,
      tool_calls: [],
      final: {
        action: "REFUSE",
        payload: { reason: "Prompt injection detected." }
      },
      safety
    };
  }

  // 2) Initial messages
  const messages = [
    {
      role: "system",
      content:
        "You are a deterministic workflow agent. Return only valid JSON matching the expected schema."
    },
    {
      role: "user",
      content: userRequest
    }
  ];

  let llmAttempts = 0;
  let toolCallCount = 0;
  let parseRetryUsed = false;

  while (llmAttempts < maxLlmAttempts) {
    llmAttempts += 1;

    let llmRaw;
    try {
      llmRaw = await mockLlm(messages);
    } catch (err) {
      return {
        id: ticketId,
        status: "REJECTED",
        plan,
        tool_calls,
        final: {
          action: "REFUSE",
          payload: { reason: `LLM execution failed: ${err.message}` }
        },
        safety
      };
    }

    const parsed = safeParse(llmRaw);

    // malformed JSON -> retry once with stricter system message
    if (!parsed.ok) {
      if (!parseRetryUsed && llmAttempts < maxLlmAttempts) {
        parseRetryUsed = true;
        messages.unshift({
          role: "system",
          content:
            "Previous response was invalid JSON. Reply with strict JSON only. No extra text."
        });
        continue;
      }

      return {
        id: ticketId,
        status: "REJECTED",
        plan,
        tool_calls,
        final: {
          action: "REFUSE",
          payload: { reason: "Malformed LLM output after retry." }
        },
        safety
      };
    }

    const validation = validateLlmResponse(parsed.value);

    if (!validation.ok) {
      return {
        id: ticketId,
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

    const response = parsed.value;

    // tool call path
    if (validation.type === "tool_call") {
      const toolName = response.tool;
      const args = response.args || {};

      if (!enforceToolAllowlist(toolName, allowedTools)) {
        safety.blocked = true;
        safety.reasons.push("DISALLOWED_TOOL");

        return {
          id: ticketId,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: `Tool not allowed: ${toolName}` }
          },
          safety
        };
      }

      if (toolCallCount >= maxToolCalls) {
        return {
          id: ticketId,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: "Maximum tool calls exceeded." }
          },
          safety
        };
      }

      const toolFn = TOOL_REGISTRY[toolName];
      if (typeof toolFn !== "function") {
        return {
          id: ticketId,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: `Unknown tool requested: ${toolName}` }
          },
          safety
        };
      }

      try {
        const toolResult = await toolFn(args);

        tool_calls.push({
          tool: toolName,
          args
        });
        toolCallCount += 1;

        messages.push({
          role: "assistant",
          content: `TOOL_RESULT: ${JSON.stringify({
            tool: toolName,
            result: toolResult
          })}`
        });

        continue;
      } catch (err) {
        return {
          id: ticketId,
          status: "REJECTED",
          plan,
          tool_calls,
          final: {
            action: "REFUSE",
            payload: { reason: `Tool execution failed: ${err.message}` }
          },
          safety
        };
      }
    }

    // final path
    if (validation.type === "final") {
      const action = response.final.action;

      return {
        id: ticketId,
        status: action === "REQUEST_INFO" ? "DONE" : "DONE",
        plan,
        tool_calls,
        final: response.final,
        safety
      };
    }
  }

  return {
    id: ticketId,
    status: "REJECTED",
    plan,
    tool_calls,
    final: {
      action: "REFUSE",
      payload: { reason: "Maximum LLM attempts exceeded." }
    },
    safety
  };
}

module.exports = {
  runAgentForItem
};
/*const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

/**
 * runAgentForItem(ticket, config)
 *
 * config:
 *  - maxToolCalls
 *  - maxLlmAttempts
 *
 * Must return:
 * {
 *   id,
 *   status: "DONE" | "NEEDS_CLARIFICATION" | "REJECTED",
 *   plan: string[],
 *   tool_calls: { tool: string, args: object }[],
 *   final: { action: "SEND_EMAIL_DRAFT" | "REQUEST_INFO" | "REFUSE", payload: object },
 *   safety: { blocked: boolean, reasons: string[] }
 * }
 *
 * Behavior enforced by tests:
 * - Prompt injection in ticket.user_request => REJECTED, safety.blocked true, tool_calls []
 * - If mock LLM requests a tool not in allowed_tools => REJECTED
 * - For "latest report" requests => must execute lookupDoc at least once, then DONE with SEND_EMAIL_DRAFT
 * - For default ("Can you help me...") => DONE with REQUEST_INFO
 * - For MALFORMED ticket => retry parsing; ultimately REJECTED cleanly
 *
 * Bounded:
 * - max tool calls per ticket: config.maxToolCalls
 * - max LLM attempts per ticket: config.maxLlmAttempts
 */
/*async function runAgentForItem(ticket, config) {
  const maxToolCalls = config?.maxToolCalls ?? 3;
  const maxLlmAttempts = config?.maxLlmAttempts ?? 3;

  const plan = [];
  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  // TODO 1: prompt injection detection
  // If detected: return REJECTED before calling LLM or tools.

  // TODO 2: build initial messages array
  // Must include system + user message
  const messages = [];

  // TODO 3: agent loop (attempts bounded)
  // - call mockLlm(messages)
  // - safeParse
  // - validateLlmResponse
  // - if tool_call:
  //    - enforce allowlist
  //    - execute tool
  //    - push TOOL_RESULT: ... into messages
  // - if final: return DONE with final
  // - if malformed JSON: retry with stricter system message once (within max attempts)

  return {
    id: ticket.id,
    status: "REJECTED",
    plan: ["Not implemented"],
    tool_calls: [],
    final: { action: "REFUSE", payload: { reason: "Not implemented" } },
    safety
  };
}

module.exports = {
  runAgentForItem
};*/
