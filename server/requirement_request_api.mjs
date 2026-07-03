import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultRuntimeDir = path.join(rootDir, ".easy_exam_runtime");
const defaultDbPath = path.join(defaultRuntimeDir, "requirement_requests.sqlite3");
const requirementScript = path.join(__dirname, "requirement_request_db.py");

function defaultJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function defaultReadBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
}

function parseJsonSafe(buffer) {
  try {
    return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || ""));
  } catch {
    return null;
  }
}

function decodeSegment(value) {
  return decodeURIComponent(value || "");
}

function normalizeSource(value, fallback = "dify") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function createRequirementRequestHandler(options = {}) {
  const dbPath = options.dbPath || process.env.REQUIREMENT_DB_PATH || defaultDbPath;
  const pythonBin = options.pythonBin || process.env.CODEX_PYTHON || process.env.PYTHON || "python3";
  const json = options.json || defaultJson;
  const readBody = options.readBody || defaultReadBody;

  async function runRequirementStore(action, payload = {}) {
    const child = spawn(pythonBin, [requirementScript, dbPath, action], {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.end(JSON.stringify(payload));
    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `需求操作失败：${action}`);
    }
    return JSON.parse(stdout || "null");
  }

  async function readJson(req) {
    return parseJsonSafe(await readBody(req)) || {};
  }

  async function runStoreOrBadRequest(res, action, payload) {
    try {
      return await runRequirementStore(action, payload);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }

  return async function handleRequirementRequest(req, res, url = new URL(req.url, "http://127.0.0.1")) {
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/api/ai/requirements/dispatch") {
      const payload = await readJson(req);
      const intent = String(payload.intent || "collecting").trim();
      const requestId = payload.requestId || payload.request_id || "";

      if (intent === "customer_confirmed") {
        if (!requestId) {
          json(res, 400, { error: "requestId is required for customer_confirmed intent" });
          return true;
        }
        const requirement = await runStoreOrBadRequest(res, "confirm", {
          requestId,
          customerReply: payload.customerReply || payload.customer_reply || payload.customer_summary || "",
          conversationId: payload.conversationId || payload.conversation_id || "",
        });
        if (!requirement) return true;
        json(res, 200, { ok: true, action: "customer_confirmed", requirement });
        return true;
      }

      if (intent === "change_request") {
        if (!requestId) {
          json(res, 400, { error: "requestId is required for change_request intent" });
          return true;
        }
        const requirement = await runStoreOrBadRequest(res, "change", {
          requestId,
          customerMessage: payload.customerMessage || payload.customer_message || payload.customer_summary || "",
          changes: payload.changes || payload.requirement || {},
          analysisCandidates: payload.analysisCandidates || payload.analysis_candidates || null,
        });
        if (!requirement) return true;
        json(res, 200, { ok: true, action: "change_request", requirement });
        return true;
      }

      const requirement = await runRequirementStore("upsert", {
        requestId,
        customer: payload.customer || {},
        requirement: payload.requirement || {},
        message: payload.message || "",
        source: normalizeSource(payload.source),
        analysisCandidates: payload.analysisCandidates || payload.analysis_candidates || null,
      });
      json(res, 200, { ok: true, action: "upsert", requirement });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/ai/requirements/upsert") {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("upsert", {
        requestId: payload.requestId || payload.request_id,
        customer: payload.customer || {},
        requirement: payload.requirement || {},
        message: payload.message || "",
        source: normalizeSource(payload.source),
        analysisCandidates: payload.analysisCandidates || payload.analysis_candidates || null,
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const aiGetMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)$/);
    if (req.method === "GET" && aiGetMatch) {
      const requirement = await runRequirementStore("get", {
        requestId: decodeSegment(aiGetMatch[1]),
      });
      json(res, requirement ? 200 : 404, requirement ? { ok: true, requirement } : { error: "Not found" });
      return true;
    }

    const confirmMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)\/customer-confirmed$/);
    if (req.method === "POST" && confirmMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("confirm", {
        requestId: decodeSegment(confirmMatch[1]),
        customerReply: payload.customerReply || payload.customer_reply || "",
        conversationId: payload.conversationId || payload.conversation_id || "",
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const changeMatch = pathname.match(/^\/api\/ai\/requirements\/([^/]+)\/change-request$/);
    if (req.method === "POST" && changeMatch) {
      const payload = await readJson(req);
      const requirement = await runRequirementStore("change", {
        requestId: decodeSegment(changeMatch[1]),
        customerMessage: payload.customerMessage || payload.customer_message || "",
        changes: payload.changes || {},
        analysisCandidates: payload.analysisCandidates || payload.analysis_candidates || null,
      });
      json(res, 200, { ok: true, requirement });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/requirements") {
      const requirements = await runRequirementStore("list");
      json(res, 200, { requirements });
      return true;
    }

    const staffGetMatch = pathname.match(/^\/api\/requirements\/([^/]+)$/);
    if (req.method === "GET" && staffGetMatch) {
      const requirement = await runRequirementStore("get", {
        requestId: decodeSegment(staffGetMatch[1]),
      });
      json(res, requirement ? 200 : 404, requirement ? requirement : { error: "Not found" });
      return true;
    }

    const readyMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/mark-ready$/);
    if (req.method === "POST" && readyMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "mark_ready", {
        requestId: decodeSegment(readyMatch[1]),
        reviewer: payload.reviewer || "",
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const clarificationMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/request-clarification$/);
    if (req.method === "POST" && clarificationMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "request_clarification", {
        requestId: decodeSegment(clarificationMatch[1]),
        reviewer: payload.reviewer || "",
        message: payload.message || "",
        questions: Array.isArray(payload.questions) ? payload.questions : [],
        missingFields: Array.isArray(payload.missingFields) ? payload.missingFields : [],
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const reviewedMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/mark-reviewed$/);
    if (req.method === "POST" && reviewedMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "mark_reviewed", {
        requestId: decodeSegment(reviewedMatch[1]),
        reviewer: payload.reviewer || "",
        message: payload.message || "",
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const linkTaskMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/link-task$/);
    if (req.method === "POST" && linkTaskMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "link_task", {
        requestId: decodeSegment(linkTaskMatch[1]),
        taskId: payload.taskId || payload.task_id || "",
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const acceptChangeMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/change-requests\/([^/]+)\/accept$/);
    if (req.method === "POST" && acceptChangeMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "accept_change", {
        requestId: decodeSegment(acceptChangeMatch[1]),
        changeId: decodeSegment(acceptChangeMatch[2]),
        reviewer: payload.reviewer || "",
        message: payload.message || "",
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    const rejectChangeMatch = pathname.match(/^\/api\/requirements\/([^/]+)\/change-requests\/([^/]+)\/reject$/);
    if (req.method === "POST" && rejectChangeMatch) {
      const payload = await readJson(req);
      const requirement = await runStoreOrBadRequest(res, "reject_change", {
        requestId: decodeSegment(rejectChangeMatch[1]),
        changeId: decodeSegment(rejectChangeMatch[2]),
        reviewer: payload.reviewer || "",
        reason: payload.reason || payload.message || "",
      });
      if (!requirement) return true;
      json(res, 200, { ok: true, requirement });
      return true;
    }

    return false;
  };
}

export const handleRequirementRequest = createRequirementRequestHandler();
