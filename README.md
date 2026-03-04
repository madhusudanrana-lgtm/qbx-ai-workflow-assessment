# Agentic Workflow Exercise (Node.js and n8n-style Engine)

This exercise is designed to be completed in **approximately 2 hours**.

You are given a minimal n8n-style workflow engine, a mock LLM, and a set of offline tools.

Your task is to implement the logic for an Agent node that processes automation tickets safely and deterministically.

---
# Make sure to fork this repo and submit your responses in the forked repo
---

# What You Need to Implement

Implement the following files:

- `src/agent.js`
- `src/guardrails.js`

All other files are provided and should not require modification.

---

# Overview

The system works as follows:

1. Tickets are loaded from `data/tickets.json`
2. A workflow definition in `workflow/workflow.json` defines execution steps
3. A minimal workflow engine executes nodes in order
4. Each node receives and returns an array of items in this format:

```js
[{ json: { ... } }]
```
Your responsibility is to implement the behavior of the Agent node.

---

## Agent Responsibilities

For each ticket, your Agent must:

1. Produce a short execution plan (array of strings)

2. Use the mock LLM to determine:
  - whether a tool must be called
  - or whether a final action can be produced

3. Execute allowed tools when requested

4. Feed tool results back to the LLM if necessary

5. Produce a structured final result

---

## Guardrails and Safety Requirements

Your implementation must enforce the following:

### Prompt Injection Defense

If user_request contains patterns such as:

- "ignore previous instructions"

- "reveal secrets"

- "override policy"

- "send confidential"

The ticket must be rejected.

---

### Tool Allowlist Enforcement

Each ticket specifies:
```JSON
"context": {
  "allowed_tools": ["lookupDoc", "summarize", "sendEmailDraft"]
}
```

If the LLM requests a tool not in this list, you must not execute it.

---

### Structured JSON Validation

The LLM returns structured JSON. You must:

- Parse safely
- Validate required fields
- Retry once if malformed
- Reject if schema is invalid

---

### Bounded Execution

- Maximum tool calls per ticket: 3
- Maximum LLM attempts per ticket: 3
- Output must be deterministic

---

## Output Format

The program must write:

`output/result.json`

Format:
```JSON
{
  "results": [
    {
      "id": "T1",
      "status": "DONE" | "NEEDS_CLARIFICATION" | "REJECTED",
      "plan": ["..."],
      "tool_calls": [
        { "tool": "lookupDoc", "args": { "docId": "RPT-2026-02" } }
      ],
      "final": {
        "action": "SEND_EMAIL_DRAFT" | "REQUEST_INFO" | "REFUSE",
        "payload": {}
      },
      "safety": {
        "blocked": false,
        "reasons": []
      }
    }
  ]
}
```

## Running the Exercise

Install dependencies:
```bash
npm install
```

Run tests:

```bash
npm test
```

Run the workflow:

```bash
npm run start
```

## Notes

- Do not use external APIs.

- Do not introduce randomness.

- Keep your implementation clean and readable.

- Favor clarity and safety over complexity.

Good luck!

---

