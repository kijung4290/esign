import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type FieldType = "text" | "date" | "check" | "sign";

type TemplateField = {
  type: FieldType;
  name: string;
  label: string;
  required: boolean;
  placeholder: string;
  role: string;
  size: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") || "";
const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "admin1234";
const sessionTtlHours = Number(Deno.env.get("SESSION_TTL_HOURS") || "6");

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "POST 요청만 지원합니다." }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const payload = body.payload || {};
    const authHeader = request.headers.get("authorization") || "";
    const sessionToken = String(body.sessionToken || authHeader.replace(/^Bearer\s+/i, "") || "").trim();

    switch (action) {
      case "bootstrap":
        return json(await bootstrap(payload));
      case "adminLogin":
        return json(await adminLogin(payload));
      case "adminDashboard":
        return json(await adminDashboard(sessionToken));
      case "createSignatureRequest":
        return json(await createSignatureRequest(payload, sessionToken, request));
      case "markRequestViewed":
        return json(await markRequestViewed(payload));
      case "saveSignature":
        return json(await saveSignature(payload));
      case "saveTemplateConfig":
        return json(await saveTemplateConfig(payload, sessionToken));
      case "getSubmissionDetail":
        return json(await getSubmissionDetail(payload, sessionToken));
      case "verifySubmissionByCode":
        return json(await verifySubmissionByCode(payload));
      default:
        return json({ error: "알 수 없는 작업입니다." }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.";
    return json({ error: message }, 400);
  }
});

async function bootstrap(payload: Record<string, unknown>) {
  const templates = await getTemplates();
  const settings = await getSettings();
  const requestToken = stringValue(payload.requestToken);
  const templateId = stringValue(payload.templateId);
  let request = null;

  if (requestToken) {
    request = await getRequestByToken(requestToken);
    if (!request) {
      throw new Error("서명 요청 정보를 찾을 수 없습니다.");
    }
    request = await normalizeRequestState(request);
  }

  const selectedTemplateId = request ? request.template_id : templateId;
  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.id === selectedTemplateId) || null
    : null;

  return {
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      estimatedFields: parseTemplateFields(template.content).length,
    })),
    privacyPolicy: settings.PrivacyPolicy || "",
    selectedTemplate,
    request: request ? normalizeRequestPayload(request) : null,
    mode: stringValue(payload.mode) || (request ? "request" : "direct"),
  };
}

async function adminLogin(payload: Record<string, unknown>) {
  if (stringValue(payload.password) !== adminPassword) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }

  await db.from("admin_sessions").delete().lt("expires_at", new Date().toISOString());

  const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("admin_sessions")
    .insert({ actor: "admin", expires_at: expiresAt })
    .select("token, actor, expires_at")
    .single();

  if (error) throw error;

  return {
    success: true,
    sessionToken: data.token,
    expiresAt: data.expires_at,
    message: "관리자 인증이 완료되었습니다.",
  };
}

async function adminDashboard(sessionToken: string) {
  await assertAdminSession(sessionToken);

  const [templates, submissionsResult, requestsResult] = await Promise.all([
    getTemplates(),
    db.from("submissions").select("*").order("completed_at", { ascending: false }).limit(200),
    db.from("signature_requests").select("*").order("requested_at", { ascending: false }).limit(200),
  ]);

  if (submissionsResult.error) throw submissionsResult.error;
  if (requestsResult.error) throw requestsResult.error;

  return {
    templates: templates.map((template) => ({
      ...template,
      estimatedFields: parseTemplateFields(template.content).length,
    })),
    submissions: (submissionsResult.data || []).map(normalizeSubmissionPayload),
    requests: (requestsResult.data || []).map(normalizeRequestPayload),
  };
}

async function createSignatureRequest(
  payload: Record<string, unknown>,
  sessionToken: string,
  request: Request,
) {
  const session = await assertAdminSession(sessionToken);
  const templateId = stringValue(payload.templateId);
  const recipientName = stringValue(payload.recipientName);
  const expiresDays = Math.max(1, Number(payload.expiresDays || 7));
  const requestMessage = stringValue(payload.message);

  if (!templateId) {
    throw new Error("템플릿을 선택해 주세요.");
  }

  const template = await getTemplateById(templateId);
  if (!template) {
    throw new Error("선택한 템플릿을 찾을 수 없습니다.");
  }

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("signature_requests")
    .insert({
      template_id: template.id,
      template_name: template.name,
      recipient_name: recipientName,
      expires_at: expiresAt,
      request_message: requestMessage,
      created_by: session.actor || "admin",
    })
    .select("*")
    .single();

  if (error) throw error;

  await appendAuditEvent({
    request_token: data.token,
    event_type: "REQUEST_CREATED",
    actor_name: session.actor || "admin",
    details: {
      templateId: template.id,
      templateName: template.name,
      recipientName,
      expiresAt,
    },
  });

  const origin = request.headers.get("origin") || "";
  const siteUrl = stringValue(payload.siteUrl) || publicSiteUrl || origin;
  const signUrl = `${siteUrl.replace(/\/$/, "")}?req=${encodeURIComponent(data.token)}`;

  return {
    success: true,
    requestToken: data.token,
    signUrl,
    expiresAt,
    message: "요청 링크가 생성되었습니다.",
  };
}

async function markRequestViewed(payload: Record<string, unknown>) {
  const requestToken = stringValue(payload.requestToken);
  if (!requestToken) throw new Error("요청 토큰이 없습니다.");

  const current = await getRequestByToken(requestToken);
  if (!current) throw new Error("서명 요청 정보를 찾을 수 없습니다.");

  const normalized = await normalizeRequestState(current);
  if (normalized.status === "COMPLETED" || normalized.status === "EXPIRED") {
    return normalizeRequestPayload(normalized);
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("signature_requests")
    .update({
      status: normalized.status === "SENT" ? "VIEWED" : normalized.status,
      opened_at: normalized.opened_at || now,
      last_accessed_at: now,
      access_count: Number(normalized.access_count || 0) + 1,
    })
    .eq("token", requestToken)
    .select("*")
    .single();

  if (error) throw error;

  if (normalized.status === "SENT") {
    await appendAuditEvent({
      request_token: requestToken,
      event_type: "REQUEST_VIEWED",
      actor_name: normalized.recipient_name || "수신자",
      details: { templateId: normalized.template_id, templateName: normalized.template_name },
    });
  }

  return normalizeRequestPayload(data);
}

async function saveSignature(payload: Record<string, unknown>) {
  const templateId = stringValue(payload.templateId);
  const templateName = stringValue(payload.templateName);
  const requestToken = stringValue(payload.requestToken);
  const formData = objectValue(payload.formData);
  const signatures = objectValue(payload.signatures);
  const fieldSummary = Array.isArray(payload.fieldSummary) ? payload.fieldSummary : [];

  if (!templateId || !templateName) {
    throw new Error("문서 정보가 누락되었습니다.");
  }

  const template = await getTemplateById(templateId);
  if (!template) {
    throw new Error("템플릿을 찾을 수 없습니다.");
  }

  let activeRequest = null;
  if (requestToken) {
    activeRequest = await getRequestByToken(requestToken);
    if (!activeRequest) throw new Error("서명 요청 정보를 찾을 수 없습니다.");

    activeRequest = await normalizeRequestState(activeRequest);
    if (activeRequest.status === "COMPLETED") throw new Error("이미 완료된 요청입니다.");
    if (activeRequest.status === "EXPIRED") throw new Error("만료된 요청입니다.");
  }

  validateSubmission(template, formData, signatures);

  const completedAt = new Date().toISOString();
  const signerName =
    stringValue(payload.signerName) ||
    (activeRequest ? activeRequest.recipient_name : "") ||
    deriveSignerName(formData);

  const { data: submission, error } = await db
    .from("submissions")
    .insert({
      request_token: requestToken || null,
      template_id: template.id,
      template_name: template.name,
      signer_name: signerName,
      signer_email: "",
      form_data: formData,
      signatures,
      field_summary: fieldSummary,
      mode: stringValue(payload.mode) || (requestToken ? "request" : "direct"),
      completed_at: completedAt,
      template_content_snapshot: template.content,
    })
    .select("*")
    .single();

  if (error) throw error;

  const verificationCode = await assignVerificationCode(submission.id);

  if (activeRequest) {
    const now = new Date().toISOString();
    await db
      .from("signature_requests")
      .update({
        status: "COMPLETED",
        opened_at: activeRequest.opened_at || now,
        completed_at: now,
        last_accessed_at: now,
        access_count: Number(activeRequest.access_count || 0) + 1,
      })
      .eq("token", requestToken);
  }

  await appendAuditEvent({
    request_token: requestToken || null,
    event_type: "DOCUMENT_COMPLETED",
    actor_name: signerName,
    details: {
      templateId: template.id,
      templateName: template.name,
      verificationCode,
    },
  });

  const summary = buildSubmissionSummary(template, formData, signatures);
  return {
    success: true,
    completedAt,
    signerName,
    summary,
    verificationCode,
    requestStatus: activeRequest ? "COMPLETED" : null,
  };
}

async function saveTemplateConfig(payload: Record<string, unknown>, sessionToken: string) {
  const session = await assertAdminSession(sessionToken);
  const name = stringValue(payload.name);
  const content = stringValue(payload.content);
  const requestedId = stringValue(payload.id);

  if (!name || !content) {
    throw new Error("템플릿 이름과 본문 HTML은 필수입니다.");
  }

  const category = stringValue(payload.category) || "일반 문서";
  const description = stringValue(payload.description);
  const templateId = requestedId || await generateNextTemplateId();
  const values = {
    id: templateId,
    name,
    description,
    category,
    content,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("templates")
    .upsert(values, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throw error;

  await appendAuditEvent({
    request_token: null,
    event_type: requestedId ? "TEMPLATE_UPDATED" : "TEMPLATE_CREATED",
    actor_name: session.actor || "admin",
    details: {
      templateId: data.id,
      templateName: data.name,
      fieldCount: parseTemplateFields(data.content).length,
    },
  });

  return {
    success: true,
    template: data,
    message: requestedId ? "템플릿이 수정되었습니다." : "새 템플릿이 추가되었습니다.",
  };
}

async function getSubmissionDetail(payload: Record<string, unknown>, sessionToken: string) {
  await assertAdminSession(sessionToken);
  const submissionId = stringValue(payload.submissionId);
  if (!submissionId) throw new Error("제출 문서 ID가 없습니다.");

  const { data, error } = await db.from("submissions").select("*").eq("id", submissionId).single();
  if (error || !data) throw new Error("제출 문서를 찾을 수 없습니다.");

  const template = {
    id: data.template_id,
    name: data.template_name,
    content: data.template_content_snapshot,
  };
  const previewHtml = buildSubmissionPreviewHtml(template, data);

  return {
    submission: normalizeSubmissionPayload(data),
    previewHtml,
    verificationUrl: buildVerificationUrl(data.verification_code),
    qrUrl: buildQrUrl(buildVerificationUrl(data.verification_code)),
  };
}

async function verifySubmissionByCode(payload: Record<string, unknown>) {
  const verificationCode = stringValue(payload.verificationCode).toUpperCase();
  if (!verificationCode) throw new Error("검증번호를 입력해 주세요.");

  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("verification_code", verificationCode)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      verified: false,
      verificationCode,
      message: "일치하는 완료 문서를 찾지 못했습니다.",
    };
  }

  return {
    verified: true,
    verificationCode,
    message: "완료 이력이 확인된 정상 문서입니다.",
    meta: normalizeSubmissionPayload(data),
  };
}

async function assertAdminSession(sessionToken: string) {
  if (!sessionToken) throw new Error("관리자 인증이 필요합니다.");

  const { data, error } = await db
    .from("admin_sessions")
    .select("token, actor, expires_at")
    .eq("token", sessionToken)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("관리자 인증이 만료되었습니다. 다시 로그인해 주세요.");

  return data;
}

async function getTemplates() {
  const { data, error } = await db.from("templates").select("*").order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getTemplateById(templateId: string) {
  const { data, error } = await db.from("templates").select("*").eq("id", templateId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getSettings() {
  const { data, error } = await db.from("app_settings").select("key, value");
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.key, row.value]));
}

async function getRequestByToken(requestToken: string) {
  const { data, error } = await db
    .from("signature_requests")
    .select("*")
    .eq("token", requestToken)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function normalizeRequestState(request: Record<string, unknown>) {
  const status = stringValue(request.status);
  const expiresAt = new Date(stringValue(request.expires_at));

  if (
    status !== "COMPLETED" &&
    status !== "EXPIRED" &&
    expiresAt.getTime() < Date.now()
  ) {
    const { data, error } = await db
      .from("signature_requests")
      .update({ status: "EXPIRED" })
      .eq("token", stringValue(request.token))
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  return request;
}

async function appendAuditEvent(payload: Record<string, unknown>) {
  const { error } = await db.from("audit_logs").insert(payload);
  if (error) throw error;
}

async function generateNextTemplateId() {
  const templates = await getTemplates();
  const max = templates.reduce((current, template) => {
    const match = String(template.id || "").match(/^T(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `T${String(max + 1).padStart(3, "0")}`;
}

async function assignVerificationCode(submissionId: string) {
  for (let i = 0; i < 5; i += 1) {
    const code = `ES-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
    const { error } = await db
      .from("submissions")
      .update({ verification_code: code })
      .eq("id", submissionId);

    if (!error) return code;
    if (!String(error.message || "").includes("duplicate")) throw error;
  }
  throw new Error("검증번호 생성에 실패했습니다.");
}

function validateSubmission(
  template: Record<string, unknown>,
  formData: Record<string, unknown>,
  signatures: Record<string, unknown>,
) {
  const fields = parseTemplateFields(stringValue(template.content));
  const missing = fields.filter((field) => {
    if (!field.required) return false;
    if (field.type === "sign") return !stringValue(signatures[field.name]);
    if (field.type === "check") return formData[field.name] !== true;
    return !stringValue(formData[field.name]);
  });

  if (missing.length) {
    throw new Error(`필수 항목이 누락되었습니다: ${missing.map((field) => field.label).join(", ")}`);
  }
}

function buildSubmissionSummary(
  template: Record<string, unknown>,
  formData: Record<string, unknown>,
  signatures: Record<string, unknown>,
) {
  const fields = parseTemplateFields(stringValue(template.content)).filter((field) => field.required);
  const completedFieldCount = fields.filter((field) => {
    if (field.type === "sign") return Boolean(stringValue(signatures[field.name]));
    if (field.type === "check") return formData[field.name] === true;
    return Boolean(stringValue(formData[field.name]));
  }).length;

  return {
    requiredFieldCount: fields.length,
    completedFieldCount,
  };
}

function buildSubmissionPreviewHtml(template: Record<string, unknown>, submission: Record<string, unknown>) {
  const formData = objectValue(submission.form_data);
  const signatures = objectValue(submission.signatures);
  const verificationCode = stringValue(submission.verification_code);
  const completedAt = formatDateTime(stringValue(submission.completed_at));
  const content = stringValue(template.content).replace(/\[\[(text|date|check|sign):([^\]]+)\]\]/g, (_, type, raw) => {
    const field = parseFieldSpec(type as FieldType, raw);
    if (field.type === "sign") {
      const signature = stringValue(signatures[field.name]);
      return signature
        ? `<span class="submitted-signature"><img src="${escapeHtml(signature)}" alt="${escapeHtml(field.label)} 서명"></span>`
        : `<span class="submitted-empty">서명 없음</span>`;
    }
    if (field.type === "check") {
      return formData[field.name] === true
        ? `<span class="submitted-check">확인함</span>`
        : `<span class="submitted-empty">미확인</span>`;
    }
    return `<span class="submitted-value">${escapeHtml(stringValue(formData[field.name])) || "-"}</span>`;
  });

  return `
    <article class="submitted-document">
      ${content}
      <footer class="verification-footer">
        <div><strong>완료 일시</strong><span>${escapeHtml(completedAt)}</span></div>
        <div><strong>검증 번호</strong><span>${escapeHtml(verificationCode)}</span></div>
      </footer>
    </article>
  `;
}

function parseTemplateFields(content: string): TemplateField[] {
  const fields: TemplateField[] = [];
  const pattern = /\[\[(text|date|check|sign):([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    fields.push(parseFieldSpec(match[1] as FieldType, match[2]));
  }
  return fields;
}

function parseFieldSpec(type: FieldType, rawSpec: string): TemplateField {
  const parts = rawSpec.split("|").map((part) => part.trim()).filter(Boolean);
  const name = parts.shift() || "";
  const options = new Map<string, string>();
  let required = false;

  for (const part of parts) {
    if (part === "required") required = true;
    if (part === "optional") required = false;
    const eqIndex = part.indexOf("=");
    if (eqIndex > -1) {
      options.set(part.slice(0, eqIndex), part.slice(eqIndex + 1));
    }
  }

  return {
    type,
    name,
    label: options.get("label") || name,
    required,
    placeholder: options.get("placeholder") || "",
    role: options.get("role") || "",
    size: options.get("size") || "medium",
  };
}

function normalizeRequestPayload(row: Record<string, unknown>) {
  return {
    requestToken: row.token,
    templateId: row.template_id,
    templateName: row.template_name,
    recipientName: row.recipient_name || "",
    status: row.status,
    requestedAt: row.requested_at,
    openedAt: row.opened_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count || 0,
    message: row.request_message || "",
  };
}

function normalizeSubmissionPayload(row: Record<string, unknown>) {
  return {
    id: row.id,
    requestToken: row.request_token,
    templateId: row.template_id,
    templateName: row.template_name,
    signerName: row.signer_name || "",
    signerEmail: row.signer_email || "",
    completedAt: row.completed_at,
    verificationCode: row.verification_code,
    mode: row.mode,
  };
}

function deriveSignerName(formData: Record<string, unknown>) {
  const preferred = ["성명", "강사명", "참여자성명", "확인자", "이름"];
  for (const key of preferred) {
    if (stringValue(formData[key])) return stringValue(formData[key]);
  }
  const firstKey = Object.keys(formData).find((key) => stringValue(formData[key]));
  return firstKey ? stringValue(formData[firstKey]) : "이름 미상";
}

function buildVerificationUrl(code: string) {
  if (!code) return "";
  const baseUrl = publicSiteUrl || "";
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}?verify=${encodeURIComponent(code)}` : "";
}

function buildQrUrl(url: string) {
  return url ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}` : "";
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
