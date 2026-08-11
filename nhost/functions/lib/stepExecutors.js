const { gqlAdmin } = require("./db");

async function withRetry(fn, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function execLlmCall(config, ctx) {
  const prompt = interpolate(config.prompt ?? "", ctx.context);
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    // Stubbed fallback so the assignment is completable without a live key.
    // Disclosed artificial delay, as allowed by the brief.
    await new Promise((r) => setTimeout(r, 800));
    return { output: { text: `[stubbed llm response for prompt]: ${prompt.slice(0, 200)}` } };
  }

  return withRetry(async () => {
    // Example uses Groq's OpenAI-compatible chat completions endpoint.
    // Swap the URL/model for OpenRouter/Gemini as needed.
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model ?? "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "";
    return { output: { text, raw: json } };
  }, config.retries ?? 1);
}

async function execHttpRequest(config, ctx) {
  const url = interpolate(config.url ?? "", ctx.context);
  return withRetry(async () => {
    const res = await fetch(url, {
      method: config.method ?? "GET",
      headers: config.headers ?? {},
      body: config.body ? JSON.stringify(config.body) : undefined,
    });
    const text = await res.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* leave as text */
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { output: { status: res.status, body } };
  }, config.retries ?? 1);
}

async function execDbWrite(config, ctx) {
  // Writes the previous step's output (or a configured value) into
  // external_events as a simple, generic "save a result" sink.
  const payload = config.value ?? ctx.context.previous ?? {};
  const data = await gqlAdmin(
    `mutation ($orgId: uuid!, $tableName: String!, $payload: jsonb!) {
      insert_external_events_one(object: { org_id: $orgId, table_name: $tableName, payload: $payload }) { id }
    }`,
    { orgId: ctx.orgId, tableName: config.table_name ?? "workflow_output", payload }
  );
  return { output: { saved_id: data.insert_external_events_one.id } };
}

async function execNotify(config, ctx) {
  const message = interpolate(config.message ?? "Workflow notification", ctx.context);
  if (config.webhook_url) {
    await fetch(config.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    }).catch(() => {
      /* best-effort: don't fail the whole run just because Slack is down */
    });
  }
  return { output: { notified: true, message } };
}

async function execConditionalBranch(config, ctx) {
  // Evaluates a simple field/operator/value condition against the
  // previous step's output.
  const prev = ctx.context.previous;
  const field = config.field ?? "text";
  const operator = config.operator ?? "contains";
  const value = config.value ?? "";
  const fieldValue = getPath(prev, field);

  let matched = false;
  switch (operator) {
    case "contains":
      matched = String(fieldValue ?? "").toLowerCase().includes(String(value).toLowerCase());
      break;
    case "equals":
      matched = fieldValue === value;
      break;
    case "gt":
      matched = Number(fieldValue) > Number(value);
      break;
    default:
      matched = Boolean(fieldValue);
  }

  return { output: { matched, fieldValue }, branchTaken: matched ? "if" : "else" };
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function interpolate(template, context) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const val = getPath(context, path);
    return val === undefined ? "" : typeof val === "string" ? val : JSON.stringify(val);
  });
}

async function executeStep(type, config, ctx) {
  switch (type) {
    case "llm_call":
      return execLlmCall(config, ctx);
    case "http_request":
      return execHttpRequest(config, ctx);
    case "db_write":
      return execDbWrite(config, ctx);
    case "notify":
      return execNotify(config, ctx);
    case "conditional_branch":
      return execConditionalBranch(config, ctx);
    case "approval_gate":
      // Handled specially by the orchestrator (triggerWorkflowRun) - it
      // never reaches here mid-execution because the run is paused first.
      return { output: { awaiting_approval: true } };
    default:
      throw new Error(`Unknown step type: ${type}`);
  }
}

module.exports = { executeStep };
