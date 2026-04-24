import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.43.4";

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

type AuthState = {
  loggedIn: boolean;
  authorized: boolean;
  userId: string;
  email: string;
  displayName: string;
  rawUser: User | null;
  accessToken: string;
};

type TemplateSeed = {
  name: string;
  description: string;
  category: string;
  content: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publicSiteUrl = Deno.env.get("PUBLIC_SITE_URL") || "";

const adminDb = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const defaultTemplates: TemplateSeed[] = [
  {
    name: "개인정보 수집 이용 동의서",
    description: "기본 개인정보 동의 양식입니다.",
    category: "동의",
    content:
      '<section class="doc-heading"><p>CONSENT</p><h1>개인정보 수집 이용 동의서</h1></section><p>아래 내용을 확인하고 개인정보 수집 및 이용에 동의합니다.</p><table class="doc-table"><tr><th>성명</th><td>[[text:성명|required|placeholder=성명을 입력하세요]]</td></tr><tr><th>생년월일</th><td>[[text:생년월일|required|placeholder=예: 1970-01-01]]</td></tr><tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr></table><p>[[check:개인정보동의|required|label=개인정보 수집 및 이용에 동의합니다.]]</p><p>본인 서명: [[sign:본인서명|required|role=본인]]</p>',
  },
  {
    name: "프로그램 참여 신청서",
    description: "프로그램 신청에 필요한 기본 신청서입니다.",
    category: "신청",
    content:
      '<section class="doc-heading"><p>APPLICATION</p><h1>프로그램 참여 신청서</h1></section><table class="doc-table"><tr><th>프로그램명</th><td>[[text:프로그램명|required|placeholder=프로그램명을 입력하세요]]</td></tr><tr><th>참여자 성명</th><td>[[text:참여자성명|required|placeholder=성명을 입력하세요]]</td></tr><tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr></table><p>[[check:참여동의|required|label=프로그램 운영 안내와 유의사항을 확인했습니다.]]</p><p>참여자 서명: [[sign:참여자서명|required|role=참여자]]</p>',
  },
  {
    name: "서약서",
    description: "확인 및 서약이 필요한 문서용 기본 양식입니다.",
    category: "서약",
    content:
      '<section class="doc-heading"><p>PLEDGE</p><h1>서약서</h1></section><p>본인은 아래 내용을 확인하고 성실히 이행할 것을 서약합니다.</p><table class="doc-table"><tr><th>성명</th><td>[[text:성명|required|placeholder=성명을 입력하세요]]</td></tr><tr><th>작성일</th><td>[[date:작성일|required]]</td></tr></table><p>[[check:서약확인|required|label=서약 내용을 확인했습니다.]]</p><p>서명: [[sign:서약자서명|required|role=서약자]]</p>',
  },
];

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "POST 요청만 지원합니다." }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = stringValue(body.action);
    const payload = objectValue(body.payload);

    switch (action) {
      case "bootstrap":
        return json(await bootstrap(payload, request));
      case "adminDashboard":
        return json(await adminDashboard(request));
      case "createSignatureRequest":
        return json(await createSignatureRequest(payload, request));
      case "markRequestViewed":
        return json(await markRequestViewed(payload));
      case "saveSignature":
        return json(await saveSignature(payload, request));
      case "saveTemplateConfig":
        return json(await saveTemplateConfig(payload, request));
      case "getSubmissionDetail":
        return json(await getSubmissionDetail(payload, request));
      case "verifySubmissionByCode":
        return json(await verifySubmissionByCode(payload));
      default:
        return json({ error: "지원하지 않는 작업입니다." }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.";
    return json({ error: message }, 400);
  }
});

async function bootstrap(payload: Record<string, unknown>, request: Request) {
  const settings = await getSettings();
  const requestToken = stringValue(payload.requestToken);
  const templateId = stringValue(payload.templateId);
  const authState = await getAuthState(request);

  if (authState.authorized) {
    await ensureDefaultTemplates(authState);
  }

  let templates: Record<string, unknown>[] = [];
  let requestRow: Record<string, unknown> | null = null;
  let selectedTemplate: Record<string, unknown> | null = null;

  if (requestToken) {
    requestRow = await getRequestByToken(requestToken);
    if (!requestRow) {
      throw new Error("서명 요청 정보를 찾을 수 없습니다.");
    }
    requestRow = await normalizeRequestState(requestRow);
    selectedTemplate = await getTemplateById(stringValue(requestRow.template_id));
    if (!selectedTemplate) {
      throw new Error("요청에 연결된 양식을 찾을 수 없습니다.");
    }
    templates = [selectedTemplate];
  } else if (authState.authorized) {
    templates = await getOwnedTemplates(authState.userId);
    if (templateId) {
      selectedTemplate = templates.find((template) => stringValue(template.id) === templateId) || null;
      if (!selectedTemplate) {
        throw new Error("선택한 양식을 찾을 수 없습니다.");
      }
    }
  }

  return {
    viewer: normalizeViewer(authState),
    templates: templates.map((template) => normalizeTemplatePayload(template, false)),
    privacyPolicy: settings.PrivacyPolicy || "",
    selectedTemplate: selectedTemplate ? normalizeTemplatePayload(selectedTemplate, true) : null,
    request: requestRow ? normalizeRequestPayload(requestRow) : null,
    mode: stringValue(payload.mode) || (requestRow ? "request" : "direct"),
  };
}

async function adminDashboard(request: Request) {
  const authState = await assertAuthorizedUser(request);
  await ensureDefaultTemplates(authState);

  const [templates, submissionsResult, requestsResult] = await Promise.all([
    getOwnedTemplates(authState.userId),
    adminDb
      .from("submissions")
      .select("*")
      .eq("owner_user_id", authState.userId)
      .order("completed_at", { ascending: false })
      .limit(200),
    adminDb
      .from("signature_requests")
      .select("*")
      .eq("owner_user_id", authState.userId)
      .order("requested_at", { ascending: false })
      .limit(200),
  ]);

  if (submissionsResult.error) throw submissionsResult.error;
  if (requestsResult.error) throw requestsResult.error;

  return {
    currentUser: normalizeViewer(authState),
    templates: templates.map((template) => normalizeTemplatePayload(template, true)),
    submissions: (submissionsResult.data || []).map(normalizeSubmissionPayload),
    requests: (requestsResult.data || []).map(normalizeRequestPayload),
  };
}

async function createSignatureRequest(payload: Record<string, unknown>, request: Request) {
  const authState = await assertAuthorizedUser(request);
  const templateId = stringValue(payload.templateId);
  const recipientName = stringValue(payload.recipientName);
  const expiresDays = Math.max(1, Number(payload.expiresDays || 7));
  const requestMessage = stringValue(payload.message);

  if (!templateId) {
    throw new Error("양식을 선택해 주세요.");
  }

  const template = await getOwnedTemplateById(templateId, authState.userId);
  if (!template) {
    throw new Error("선택한 양식을 찾을 수 없습니다.");
  }

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await adminDb
    .from("signature_requests")
    .insert({
      owner_user_id: authState.userId,
      owner_email: authState.email,
      template_id: template.id,
      template_name: template.name,
      recipient_name: recipientName,
      expires_at: expiresAt,
      request_message: requestMessage,
      created_by: authState.displayName,
    })
    .select("*")
    .single();

  if (error) throw error;

  await appendAuditEvent({
    owner_user_id: authState.userId,
    owner_email: authState.email,
    request_token: data.token,
    event_type: "REQUEST_CREATED",
    actor_name: authState.displayName,
    actor_email: authState.email,
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
  const { data, error } = await adminDb
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
      owner_user_id: normalized.owner_user_id || null,
      owner_email: stringValue(normalized.owner_email),
      request_token: requestToken,
      event_type: "REQUEST_VIEWED",
      actor_name: stringValue(normalized.recipient_name) || "수신자",
      actor_email: "",
      details: {
        templateId: normalized.template_id,
        templateName: normalized.template_name,
      },
    });
  }

  return normalizeRequestPayload(data);
}

async function saveSignature(payload: Record<string, unknown>, request: Request) {
  const requestToken = stringValue(payload.requestToken);
  const formData = objectValue(payload.formData);
  const signatures = objectValue(payload.signatures);
  const fieldSummary = Array.isArray(payload.fieldSummary) ? payload.fieldSummary : [];

  let activeRequest: Record<string, unknown> | null = null;
  let template: Record<string, unknown> | null = null;
  let ownerUserId = "";
  let ownerEmail = "";

  if (requestToken) {
    activeRequest = await getRequestByToken(requestToken);
    if (!activeRequest) throw new Error("서명 요청 정보를 찾을 수 없습니다.");

    activeRequest = await normalizeRequestState(activeRequest);
    if (activeRequest.status === "COMPLETED") throw new Error("이미 완료된 요청입니다.");
    if (activeRequest.status === "EXPIRED") throw new Error("만료된 요청입니다.");

    ownerUserId = stringValue(activeRequest.owner_user_id);
    ownerEmail = stringValue(activeRequest.owner_email);
    template = await getTemplateById(stringValue(activeRequest.template_id));
  } else {
    const authState = await assertAuthorizedUser(request);
    ownerUserId = authState.userId;
    ownerEmail = authState.email;
    template = await getOwnedTemplateById(stringValue(payload.templateId), authState.userId);
  }

  if (!template) {
    throw new Error("양식을 찾을 수 없습니다.");
  }
  if (!ownerUserId) {
    throw new Error("문서 소유자 정보를 확인할 수 없습니다. 새 링크를 다시 생성해 주세요.");
  }

  validateSubmission(template, formData, signatures);

  const completedAt = new Date().toISOString();
  const signerName =
    stringValue(payload.signerName) ||
    stringValue(activeRequest?.recipient_name) ||
    deriveSignerName(formData);

  const { data: submission, error } = await adminDb
    .from("submissions")
    .insert({
      owner_user_id: ownerUserId,
      owner_email: ownerEmail,
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
    await adminDb
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
    owner_user_id: ownerUserId,
    owner_email: ownerEmail,
    request_token: requestToken || null,
    event_type: "DOCUMENT_COMPLETED",
    actor_name: signerName,
    actor_email: "",
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

async function saveTemplateConfig(payload: Record<string, unknown>, request: Request) {
  const authState = await assertAuthorizedUser(request);
  const name = stringValue(payload.name);
  const content = stringValue(payload.content);
  const requestedId = stringValue(payload.id);

  if (!name || !content) {
    throw new Error("양식명과 본문 HTML은 필수입니다.");
  }

  const category = stringValue(payload.category) || "일반 문서";
  const description = stringValue(payload.description);
  const updatedAt = new Date().toISOString();
  let data: Record<string, unknown> | null = null;

  if (requestedId) {
    const existing = await getOwnedTemplateById(requestedId, authState.userId);
    if (!existing) {
      throw new Error("수정할 양식을 찾을 수 없습니다.");
    }

    const response = await adminDb
      .from("templates")
      .update({
        name,
        description,
        category,
        content,
        updated_at: updatedAt,
      })
      .eq("id", requestedId)
      .eq("owner_user_id", authState.userId)
      .select("*")
      .single();

    if (response.error) throw response.error;
    data = response.data;
  } else {
    const response = await adminDb
      .from("templates")
      .insert({
        id: crypto.randomUUID(),
        owner_user_id: authState.userId,
        owner_email: authState.email,
        name,
        description,
        category,
        content,
        updated_at: updatedAt,
      })
      .select("*")
      .single();

    if (response.error) throw response.error;
    data = response.data;
  }

  if (!data) {
    throw new Error("양식을 저장하지 못했습니다.");
  }

  await appendAuditEvent({
    owner_user_id: authState.userId,
    owner_email: authState.email,
    request_token: null,
    event_type: requestedId ? "TEMPLATE_UPDATED" : "TEMPLATE_CREATED",
    actor_name: authState.displayName,
    actor_email: authState.email,
    details: {
      templateId: data.id,
      templateName: data.name,
      fieldCount: parseTemplateFields(stringValue(data.content)).length,
    },
  });

  return {
    success: true,
    template: normalizeTemplatePayload(data, true),
    message: requestedId ? "양식이 수정되었습니다." : "새 양식이 추가되었습니다.",
  };
}

async function getSubmissionDetail(payload: Record<string, unknown>, request: Request) {
  const authState = await assertAuthorizedUser(request);
  const submissionId = stringValue(payload.submissionId);
  if (!submissionId) throw new Error("제출 문서 ID가 없습니다.");

  const { data, error } = await adminDb
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("owner_user_id", authState.userId)
    .single();

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

  const { data, error } = await adminDb
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

async function getAuthState(request: Request): Promise<AuthState> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    return {
      loggedIn: false,
      authorized: false,
      userId: "",
      email: "",
      displayName: "",
      rawUser: null,
      accessToken: "",
    };
  }

  const { data, error } = await adminDb.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error("로그인 세션이 유효하지 않습니다. 다시 로그인해 주세요.");
  }

  const email = stringValue(data.user.email).toLowerCase();
  if (!email) {
    throw new Error("이메일 정보를 읽을 수 없는 계정입니다.");
  }

  const { data: allowedUser, error: allowedError } = await adminDb
    .from("admin_users")
    .select("email, display_name, is_active")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (allowedError) throw allowedError;

  return {
    loggedIn: true,
    authorized: Boolean(allowedUser),
    userId: data.user.id,
    email,
    displayName:
      stringValue(allowedUser?.display_name) ||
      stringValue(data.user.user_metadata?.full_name) ||
      stringValue(data.user.user_metadata?.name) ||
      email,
    rawUser: data.user,
    accessToken,
  };
}

async function assertAuthorizedUser(request: Request) {
  const authState = await getAuthState(request);
  if (!authState.loggedIn) {
    throw new Error("관리자 작업은 로그인 후 사용할 수 있습니다.");
  }
  if (!authState.authorized) {
    throw new Error("허용된 사용자만 관리자 화면에 접근할 수 있습니다. admin_users 테이블에 이메일을 먼저 등록해 주세요.");
  }
  return authState;
}

async function ensureDefaultTemplates(authState: AuthState) {
  const { count, error } = await adminDb
    .from("templates")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", authState.userId);

  if (error) throw error;
  if ((count || 0) > 0) return;

  const now = new Date().toISOString();
  const rows = defaultTemplates.map((template) => ({
    id: crypto.randomUUID(),
    owner_user_id: authState.userId,
    owner_email: authState.email,
    name: template.name,
    description: template.description,
    category: template.category,
    content: template.content,
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await adminDb.from("templates").insert(rows);
  if (insertError) throw insertError;
}

async function getOwnedTemplates(userId: string) {
  const { data, error } = await adminDb
    .from("templates")
    .select("*")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getOwnedTemplateById(templateId: string, userId: string) {
  const { data, error } = await adminDb
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getTemplateById(templateId: string) {
  const { data, error } = await adminDb
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getSettings() {
  const { data, error } = await adminDb.from("app_settings").select("key, value");
  if (error) throw error;
  return Object.fromEntries((data || []).map((row) => [row.key, row.value]));
}

async function getRequestByToken(requestToken: string) {
  const { data, error } = await adminDb
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
    const { data, error } = await adminDb
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
  const { error } = await adminDb.from("audit_logs").insert(payload);
  if (error) throw error;
}

async function assignVerificationCode(submissionId: string) {
  for (let i = 0; i < 5; i += 1) {
    const code = `ES-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
    const { error } = await adminDb
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
    throw new Error(`필수 항목이 비어 있습니다: ${missing.map((field) => field.label).join(", ")}`);
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
        : '<span class="submitted-empty">서명 없음</span>';
    }
    if (field.type === "check") {
      return formData[field.name] === true
        ? '<span class="submitted-check">확인됨</span>'
        : '<span class="submitted-empty">미확인</span>';
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

function normalizeViewer(authState: AuthState) {
  return {
    loggedIn: authState.loggedIn,
    authorized: authState.authorized,
    userId: authState.userId,
    email: authState.email,
    displayName: authState.displayName,
  };
}

function normalizeTemplatePayload(row: Record<string, unknown>, includeContent: boolean) {
  const payload: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    description: row.description || "",
    category: row.category || "",
    estimatedFields: parseTemplateFields(stringValue(row.content)).length,
  };

  if (includeContent) {
    payload.content = row.content || "";
  }

  return payload;
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
    createdBy: row.created_by || "",
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

function extractAccessToken(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const apikey = request.headers.get("apikey") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === apikey) return "";
  return token;
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
