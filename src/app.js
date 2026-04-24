(function () {
  const config = window.ESIGN_CONFIG || {};
  const state = {
    templates: [],
    selectedTemplate: null,
    request: null,
    fields: [],
    adminSessionToken: localStorage.getItem("esign_admin_session") || "",
    adminData: null,
    currentSignatureFieldId: "",
    activeSignatureTab: "draw",
    isDrawing: false,
    canvas: null,
    ctx: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindGlobalEvents();
    initSignaturePad();

    const params = new URLSearchParams(location.search);
    const requestToken = params.get("req") || "";
    const verificationCode = params.get("verify") || "";

    await loadBootstrap({ requestToken });

    if (requestToken && state.selectedTemplate) {
      await openDocument(state.selectedTemplate, state.request);
      await api("markRequestViewed", { requestToken }).catch(showError);
      return;
    }

    if (verificationCode) {
      showScreen("verify-screen");
      $("#verify-code").value = verificationCode;
      await runVerification(verificationCode);
      return;
    }

    showScreen("home-screen");
  }

  function bindGlobalEvents() {
    document.body.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        const action = actionButton.dataset.action;
        if (action === "home") {
          history.replaceState({}, "", location.pathname);
          showScreen("home-screen");
        }
        if (action === "admin") openAdmin();
        if (action === "verify") showScreen("verify-screen");
      }
    });

    $("#verify-inline-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = $("#verify-inline-code").value.trim();
      showScreen("verify-screen");
      $("#verify-code").value = code;
      await runVerification(code);
    });

    $("#verify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await runVerification($("#verify-code").value.trim());
    });

    $("#submit-signature").addEventListener("click", submitSignature);
    $("#admin-login").addEventListener("submit", adminLogin);
    $("#admin-logout").addEventListener("click", adminLogout);
    $("#request-form").addEventListener("submit", createRequestLink);
    $("#copy-generated-link").addEventListener("click", copyGeneratedLink);
    $("#template-form").addEventListener("submit", saveTemplate);
    $("#new-template").addEventListener("click", clearTemplateForm);
    $("#template-picker").addEventListener("change", fillTemplateForm);

    $$(".tab").forEach((button) => {
      button.addEventListener("click", () => switchAdminTab(button.dataset.tab));
    });

    $("#close-signature").addEventListener("click", closeSignatureModal);
    $("#cancel-signature").addEventListener("click", closeSignatureModal);
    $("#clear-signature").addEventListener("click", clearSignatureCanvas);
    $("#apply-signature").addEventListener("click", applySignature);
    $("#typed-name").addEventListener("input", renderTypedPreview);
    $("#close-detail").addEventListener("click", () => $("#detail-modal").classList.add("hidden"));
    $("#print-detail").addEventListener("click", () => window.print());

    $("[data-sign-tab='draw']").addEventListener("click", () => switchSignatureTab("draw"));
    $("[data-sign-tab='type']").addEventListener("click", () => switchSignatureTab("type"));
  }

  async function loadBootstrap(extraPayload) {
    showLoading(true);
    try {
      const result = await api("bootstrap", extraPayload || {});
      state.templates = result.templates || [];
      state.selectedTemplate = result.selectedTemplate || null;
      state.request = result.request || null;
      renderTemplates();
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  function renderTemplates() {
    const grid = $("#template-grid");
    grid.innerHTML = "";

    if (!state.templates.length) {
      grid.innerHTML = '<div class="panel">등록된 양식이 없습니다.</div>';
      return;
    }

    state.templates.forEach((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "template-card";
      button.innerHTML = `
        <div>
          <span class="tag">${escapeHtml(template.category || "문서")}</span>
          <h3>${escapeHtml(template.name)}</h3>
          <p>${escapeHtml(template.description || "")}</p>
        </div>
        <span class="muted">입력 항목 ${template.estimatedFields || 0}개</span>
      `;
      button.addEventListener("click", async () => {
        await loadBootstrap({ templateId: template.id, mode: "direct" });
        if (state.selectedTemplate) {
          await openDocument(state.selectedTemplate, null);
        }
      });
      grid.appendChild(button);
    });
  }

  async function openDocument(template, request) {
    state.selectedTemplate = template;
    state.request = request || null;
    state.fields = parseTemplateFields(template.content);

    $("#document-title").textContent = template.name;
    $("#document-meta").textContent = request
      ? `${request.recipientName || "수신자"} · 만료일 ${formatDateTime(request.expiresAt)}`
      : "직접 작성 모드";

    const alert = $("#request-alert");
    if (request && request.message) {
      alert.textContent = request.message;
      alert.classList.remove("hidden");
    } else {
      alert.classList.add("hidden");
    }

    $("#document-paper").innerHTML = renderTemplateContent(template.content);
    bindDocumentFields();
    updateProgress();
    showScreen("document-screen");
  }

  function renderTemplateContent(content) {
    let index = 0;
    return content.replace(/\[\[(text|date|check|sign):([^\]]+)\]\]/g, () => {
      const field = state.fields[index];
      index += 1;
      if (!field) return "";

      const requiredText = field.required ? "필수" : "선택";
      const sizeClass = `size-${field.size || "medium"}`;

      if (field.type === "text" || field.type === "date") {
        const type = field.type === "date" ? "date" : "text";
        return `
          <span class="field-anchor">
            <input class="doc-field ${sizeClass}" type="${type}" data-field-id="${field.id}"
              placeholder="${escapeHtml(field.placeholder)}" aria-label="${escapeHtml(field.label)} ${requiredText}">
          </span>
        `;
      }

      if (field.type === "check") {
        return `
          <label class="check-field" data-check-wrap="${field.id}">
            <input type="checkbox" data-field-id="${field.id}">
            <span>${escapeHtml(field.label)} <small>(${requiredText})</small></span>
          </label>
        `;
      }

      return `
        <button class="sign-button" type="button" data-field-id="${field.id}">
          <span>${escapeHtml(field.role || field.label)} 서명</span>
          <small>(${requiredText})</small>
        </button>
      `;
    });
  }

  function bindDocumentFields() {
    state.fields.forEach((field) => {
      const element = document.querySelector(`[data-field-id="${field.id}"]`);
      field.element = element;

      if (!element) return;

      if (field.type === "text" || field.type === "date") {
        element.addEventListener("input", () => {
          field.value = element.value;
          element.classList.toggle("complete", isFieldComplete(field));
          updateProgress();
        });
      }

      if (field.type === "check") {
        element.addEventListener("change", () => {
          field.value = element.checked;
          const wrap = document.querySelector(`[data-check-wrap="${field.id}"]`);
          wrap.classList.toggle("complete", isFieldComplete(field));
          updateProgress();
        });
      }

      if (field.type === "sign") {
        element.addEventListener("click", () => openSignatureModal(field.id));
      }
    });
  }

  function updateProgress() {
    const requiredFields = state.fields.filter((field) => field.required);
    const completed = requiredFields.filter(isFieldComplete).length;
    const percent = requiredFields.length ? Math.round((completed / requiredFields.length) * 100) : 100;

    $("#progress-bar").style.width = `${percent}%`;
    $("#progress-text").textContent = `필수 항목 ${completed} / ${requiredFields.length}`;

    const list = $("#field-list");
    list.innerHTML = "";
    requiredFields.forEach((field) => {
      const item = document.createElement("div");
      item.className = `field-item ${isFieldComplete(field) ? "complete" : ""}`;
      item.innerHTML = `<span>${escapeHtml(field.label)}</span><strong>${isFieldComplete(field) ? "완료" : "대기"}</strong>`;
      if (field.element) {
        item.addEventListener("click", () => field.element.scrollIntoView({ behavior: "smooth", block: "center" }));
      }
      list.appendChild(item);
    });
  }

  async function submitSignature() {
    const pending = state.fields.filter((field) => field.required && !isFieldComplete(field));
    if (pending.length) {
      pending[0].element?.scrollIntoView({ behavior: "smooth", block: "center" });
      alert(`필수 항목을 작성해 주세요: ${pending[0].label}`);
      return;
    }

    const formData = {};
    const signatures = {};
    const fieldSummary = [];

    state.fields.forEach((field) => {
      if (field.type === "sign") {
        signatures[field.name] = field.value || "";
      } else if (field.type === "check") {
        formData[field.name] = Boolean(field.value);
      } else {
        formData[field.name] = field.value || "";
      }

      fieldSummary.push({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required,
        isComplete: isFieldComplete(field),
      });
    });

    showLoading(true);
    try {
      const result = await api("saveSignature", {
        requestToken: state.request ? state.request.requestToken : "",
        templateId: state.selectedTemplate.id,
        templateName: state.selectedTemplate.name,
        signerName: deriveSignerName(formData),
        formData,
        signatures,
        fieldSummary,
        mode: state.request ? "request" : "direct",
      });
      renderSuccess(result);
      showScreen("success-screen");
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  function renderSuccess(result) {
    $("#success-copy").textContent = `검증번호 ${result.verificationCode || "-"}로 제출 이력을 확인할 수 있습니다.`;
    $("#success-summary").innerHTML = [
      ["문서", state.selectedTemplate?.name || "-"],
      ["서명자", result.signerName || "-"],
      ["완료 일시", formatDateTime(result.completedAt)],
      ["필수 항목", `${result.summary?.completedFieldCount || 0} / ${result.summary?.requiredFieldCount || 0}`],
      ["검증번호", result.verificationCode || "-"],
    ].map(([label, value]) => `
      <div class="summary-item">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
  }

  function initSignaturePad() {
    state.canvas = $("#signature-canvas");
    state.ctx = state.canvas.getContext("2d");

    const start = (event) => {
      state.isDrawing = true;
      const point = canvasPoint(event);
      state.ctx.beginPath();
      state.ctx.moveTo(point.x, point.y);
    };

    const move = (event) => {
      if (!state.isDrawing) return;
      const point = canvasPoint(event);
      state.ctx.lineTo(point.x, point.y);
      state.ctx.stroke();
    };

    const stop = () => {
      state.isDrawing = false;
    };

    state.canvas.addEventListener("mousedown", start);
    state.canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    state.canvas.addEventListener("touchstart", (event) => {
      event.preventDefault();
      start(event.touches[0]);
    }, { passive: false });
    state.canvas.addEventListener("touchmove", (event) => {
      event.preventDefault();
      move(event.touches[0]);
    }, { passive: false });
    state.canvas.addEventListener("touchend", stop);
  }

  function resizeSignatureCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = state.canvas.offsetWidth || 600;
    const height = state.canvas.offsetHeight || 240;
    state.canvas.width = width * ratio;
    state.canvas.height = height * ratio;
    state.ctx.setTransform(1, 0, 0, 1, 0, 0);
    state.ctx.scale(ratio, ratio);
    state.ctx.lineWidth = 3;
    state.ctx.lineJoin = "round";
    state.ctx.lineCap = "round";
    state.ctx.strokeStyle = "#111827";
    state.ctx.clearRect(0, 0, width, height);
  }

  function canvasPoint(event) {
    const rect = state.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function openSignatureModal(fieldId) {
    const field = state.fields.find((item) => item.id === fieldId);
    if (!field) return;
    state.currentSignatureFieldId = fieldId;
    $("#signature-title").textContent = `${field.role || field.label} 서명`;
    $("#typed-name").value = deriveSignerName(collectFormData());
    $("#signature-modal").classList.remove("hidden");
    switchSignatureTab(field.value ? "type" : "draw");
    setTimeout(() => {
      resizeSignatureCanvas();
      renderTypedPreview();
    }, 40);
  }

  function closeSignatureModal() {
    $("#signature-modal").classList.add("hidden");
    state.currentSignatureFieldId = "";
    clearSignatureCanvas();
  }

  function switchSignatureTab(tab) {
    state.activeSignatureTab = tab;
    $$(".signature-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.signTab === tab);
    });
    $("#draw-panel").classList.toggle("active", tab === "draw");
    $("#type-panel").classList.toggle("active", tab === "type");
    if (tab === "draw") setTimeout(resizeSignatureCanvas, 20);
    if (tab === "type") renderTypedPreview();
  }

  function clearSignatureCanvas() {
    if (!state.canvas || !state.ctx) return;
    const width = state.canvas.width / Math.max(window.devicePixelRatio || 1, 1);
    const height = state.canvas.height / Math.max(window.devicePixelRatio || 1, 1);
    state.ctx.clearRect(0, 0, width, height);
  }

  function renderTypedPreview() {
    $("#typed-preview").textContent = $("#typed-name").value.trim() || "서명";
  }

  function applySignature() {
    const field = state.fields.find((item) => item.id === state.currentSignatureFieldId);
    if (!field) return;

    let dataUrl = "";
    if (state.activeSignatureTab === "draw") {
      if (isCanvasBlank()) {
        alert("서명을 그려 주세요.");
        return;
      }
      dataUrl = state.canvas.toDataURL("image/png");
    } else {
      const name = $("#typed-name").value.trim();
      if (!name) {
        alert("서명에 사용할 이름을 입력해 주세요.");
        return;
      }
      dataUrl = buildTypedSignatureDataUrl(name);
    }

    field.value = dataUrl;
    field.signedAt = new Date().toISOString();
    field.element.classList.add("complete");
    field.element.innerHTML = `<img src="${dataUrl}" alt="서명"><span>${escapeHtml(field.role || field.label)}</span>`;
    updateProgress();
    closeSignatureModal();
  }

  function isCanvasBlank() {
    const blank = document.createElement("canvas");
    blank.width = state.canvas.width;
    blank.height = state.canvas.height;
    return blank.toDataURL() === state.canvas.toDataURL();
  }

  function buildTypedSignatureDataUrl(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 860;
    canvas.height = 280;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'italic 82px Georgia, "Times New Roman", serif';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);
    ctx.strokeStyle = "rgba(17,24,39,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(160, 206);
    ctx.lineTo(700, 206);
    ctx.stroke();
    return canvas.toDataURL("image/png");
  }

  async function openAdmin() {
    showScreen("admin-screen");
    if (state.adminSessionToken) {
      $("#admin-login").classList.add("hidden");
      $("#admin-workspace").classList.remove("hidden");
      await loadAdminDashboard();
    } else {
      $("#admin-login").classList.remove("hidden");
      $("#admin-workspace").classList.add("hidden");
    }
  }

  async function adminLogin(event) {
    event.preventDefault();
    showLoading(true);
    try {
      const result = await api("adminLogin", { password: $("#admin-password").value });
      state.adminSessionToken = result.sessionToken;
      localStorage.setItem("esign_admin_session", state.adminSessionToken);
      $("#admin-password").value = "";
      await openAdmin();
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  function adminLogout() {
    state.adminSessionToken = "";
    localStorage.removeItem("esign_admin_session");
    openAdmin();
  }

  async function loadAdminDashboard() {
    showLoading(true);
    try {
      state.adminData = await api("adminDashboard", {}, true);
      renderAdminData();
    } catch (error) {
      state.adminSessionToken = "";
      localStorage.removeItem("esign_admin_session");
      showError(error);
      await openAdmin();
    } finally {
      showLoading(false);
    }
  }

  function renderAdminData() {
    renderAdminTemplateSelects();
    renderRequests();
    renderSubmissions();
  }

  function renderAdminTemplateSelects() {
    const templates = state.adminData?.templates || [];
    const requestSelect = $("#request-template");
    const picker = $("#template-picker");

    requestSelect.innerHTML = templates.map((template) =>
      `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`
    ).join("");

    picker.innerHTML = [
      '<option value="">새 양식 작성</option>',
      ...templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`),
    ].join("");

    if (templates.length) {
      picker.value = templates[0].id;
      fillTemplateForm();
    }
  }

  function renderRequests() {
    const rows = state.adminData?.requests || [];
    $("#request-list").innerHTML = rows.length ? rows.map((row) => `
      <div class="table-row">
        <div>
          <strong>${escapeHtml(row.templateName)}</strong>
          <span class="muted">${escapeHtml(row.recipientName || "수신자 미지정")} · ${formatDateTime(row.requestedAt)} · 만료 ${formatDateTime(row.expiresAt)}</span>
        </div>
        <span class="status ${escapeHtml(row.status)}">${statusLabel(row.status)}</span>
      </div>
    `).join("") : '<p class="muted">생성된 요청이 없습니다.</p>';
  }

  function renderSubmissions() {
    const rows = state.adminData?.submissions || [];
    $("#submission-list").innerHTML = rows.length ? rows.map((row) => `
      <div class="table-row">
        <div>
          <strong>${escapeHtml(row.templateName)}</strong>
          <span class="muted">${escapeHtml(row.signerName || "이름 미상")} · ${formatDateTime(row.completedAt)} · ${escapeHtml(row.verificationCode || "-")}</span>
        </div>
        <button class="btn secondary" type="button" data-submission-id="${escapeHtml(row.id)}">보기</button>
      </div>
    `).join("") : '<p class="muted">제출된 문서가 없습니다.</p>';

    $$("[data-submission-id]").forEach((button) => {
      button.addEventListener("click", () => openSubmissionDetail(button.dataset.submissionId));
    });
  }

  async function createRequestLink(event) {
    event.preventDefault();
    showLoading(true);
    try {
      const result = await api("createSignatureRequest", {
        templateId: $("#request-template").value,
        recipientName: $("#request-recipient").value,
        expiresDays: $("#request-expires").value,
        message: $("#request-message").value,
        siteUrl: currentSiteUrl(),
      }, true);

      $("#generated-link").value = result.signUrl;
      $("#request-link-result").classList.remove("hidden");
      await loadAdminDashboard();
      switchAdminTab("requests");
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  async function copyGeneratedLink() {
    const value = $("#generated-link").value;
    if (!value) return;
    await navigator.clipboard.writeText(value).catch(() => {
      $("#generated-link").select();
      document.execCommand("copy");
    });
    $("#copy-generated-link").textContent = "복사됨";
    setTimeout(() => {
      $("#copy-generated-link").textContent = "복사";
    }, 1200);
  }

  function fillTemplateForm() {
    const id = $("#template-picker").value;
    const template = (state.adminData?.templates || []).find((item) => item.id === id);
    if (!template) {
      clearTemplateForm();
      return;
    }
    $("#template-id").value = template.id;
    $("#template-name").value = template.name || "";
    $("#template-category").value = template.category || "";
    $("#template-description").value = template.description || "";
    $("#template-content").value = template.content || "";
  }

  function clearTemplateForm() {
    $("#template-picker").value = "";
    $("#template-id").value = "";
    $("#template-name").value = "";
    $("#template-category").value = "";
    $("#template-description").value = "";
    $("#template-content").value = "";
  }

  async function saveTemplate(event) {
    event.preventDefault();
    showLoading(true);
    try {
      await api("saveTemplateConfig", {
        id: $("#template-id").value,
        name: $("#template-name").value,
        category: $("#template-category").value,
        description: $("#template-description").value,
        content: $("#template-content").value,
      }, true);
      await loadAdminDashboard();
      await loadBootstrap();
      alert("양식이 저장되었습니다.");
      switchAdminTab("templates");
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  async function openSubmissionDetail(submissionId) {
    showLoading(true);
    try {
      const detail = await api("getSubmissionDetail", { submissionId }, true);
      $("#detail-preview").innerHTML = `
        ${detail.previewHtml}
        <div class="summary-grid">
          <div class="summary-item"><strong>검증 링크</strong><span>${escapeHtml(detail.verificationUrl || "-")}</span></div>
          ${detail.qrUrl ? `<div class="summary-item"><strong>QR</strong><img src="${detail.qrUrl}" alt="검증 QR"></div>` : ""}
        </div>
      `;
      $("#detail-modal").classList.remove("hidden");
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  function switchAdminTab(tab) {
    $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${tab}`));
  }

  async function runVerification(code) {
    const resultBox = $("#verify-result");
    if (!code) {
      resultBox.className = "verify-result fail";
      resultBox.textContent = "검증번호를 입력해 주세요.";
      return;
    }

    showLoading(true);
    try {
      const result = await api("verifySubmissionByCode", { verificationCode: code });
      if (result.verified) {
        resultBox.className = "verify-result success";
        resultBox.innerHTML = `
          <strong>${escapeHtml(result.message)}</strong><br>
          문서: ${escapeHtml(result.meta.templateName)}<br>
          서명자: ${escapeHtml(result.meta.signerName || "-")}<br>
          완료일: ${escapeHtml(formatDateTime(result.meta.completedAt))}
        `;
      } else {
        resultBox.className = "verify-result fail";
        resultBox.textContent = result.message;
      }
    } catch (error) {
      resultBox.className = "verify-result fail";
      resultBox.textContent = error.message || "검증 중 오류가 발생했습니다.";
    } finally {
      showLoading(false);
    }
  }

  async function api(action, payload, admin) {
    if (!config.API_URL || config.API_URL.includes("YOUR_PROJECT_REF")) {
      throw new Error("src/config.js의 API_URL을 Supabase Edge Function 주소로 설정해 주세요.");
    }
    if (!config.ANON_KEY || config.ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")) {
      throw new Error("src/config.js의 ANON_KEY를 Supabase anon public key로 설정해 주세요.");
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: config.ANON_KEY,
      Authorization: `Bearer ${config.ANON_KEY}`,
    };

    const response = await fetch(config.API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action,
        payload: payload || {},
        sessionToken: admin ? state.adminSessionToken : "",
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || "요청 처리에 실패했습니다.");
    }
    return data;
  }

  function parseTemplateFields(content) {
    const fields = [];
    const pattern = /\[\[(text|date|check|sign):([^\]]+)\]\]/g;
    let match;
    let index = 0;
    while ((match = pattern.exec(content)) !== null) {
      fields.push(parseFieldSpec(match[1], match[2], index));
      index += 1;
    }
    return fields;
  }

  function parseFieldSpec(type, rawSpec, index) {
    const parts = rawSpec.split("|").map((part) => part.trim()).filter(Boolean);
    const name = parts.shift() || `field_${index}`;
    const options = {};
    let required = false;
    parts.forEach((part) => {
      if (part === "required") required = true;
      if (part === "optional") required = false;
      const eqIndex = part.indexOf("=");
      if (eqIndex > -1) {
        options[part.slice(0, eqIndex)] = part.slice(eqIndex + 1);
      }
    });
    return {
      id: `field-${index}`,
      type,
      name,
      label: options.label || name,
      required,
      placeholder: options.placeholder || "",
      role: options.role || "",
      size: options.size || "medium",
      value: type === "check" ? false : "",
      element: null,
    };
  }

  function isFieldComplete(field) {
    if (field.type === "check") return field.value === true;
    return Boolean(String(field.value || "").trim());
  }

  function collectFormData() {
    const formData = {};
    state.fields.forEach((field) => {
      if (field.type !== "sign") formData[field.name] = field.value;
    });
    return formData;
  }

  function deriveSignerName(formData) {
    const preferred = ["성명", "강사명", "참여자성명", "확인자", "이름"];
    for (const key of preferred) {
      if (formData[key]) return String(formData[key]).trim();
    }
    const first = Object.values(formData).find((value) => String(value || "").trim());
    return first ? String(first).trim() : "";
  }

  function showScreen(id) {
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    $(`#${id}`).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showLoading(visible) {
    $("#loading").classList.toggle("hidden", !visible);
  }

  function showError(error) {
    alert(error && error.message ? error.message : String(error));
  }

  function currentSiteUrl() {
    return location.href.split(/[?#]/)[0].replace(/index\.html$/i, "").replace(/\/$/, "");
  }

  function statusLabel(status) {
    return {
      SENT: "요청",
      VIEWED: "열람",
      COMPLETED: "완료",
      EXPIRED: "만료",
    }[status] || status || "-";
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
