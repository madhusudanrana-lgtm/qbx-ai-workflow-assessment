const { isValidToolCall, isValidFinal } = require("./llm/schema");

function detectPromptInjection(text) {
  const patterns = [
    /ignore previous instructions/i,
    /reveal secrets/i,
    /override policy/i,
    /send confidential/i
  ];

  const detected = patterns.some((p) => p.test(text));
  return detected ? ["PROMPT_INJECTION"] : [];
}

function enforceToolAllowlist(toolName, allowedTools) {
  return Array.isArray(allowedTools) && allowedTools.includes(toolName);
}

function validateLlmResponse(obj) {
  if (isValidToolCall(obj)) return { ok: true, type: "tool_call" };
  if (isValidFinal(obj)) return { ok: true, type: "final" };

  return { ok: false, reason: "Invalid LLM response schema" };
}

module.exports = {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
};
