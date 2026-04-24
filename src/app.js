(function () {
  const config = window.ESIGN_CONFIG || {};
  const FIELD_TYPE_META = {
    text: { icon: "T", label: "입력칸" },
    date: { icon: "D", label: "날짜" },
    check: { icon: "✓", label: "체크" },
    sign: { icon: "S", label: "서명" },
  };

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
    templateEditorSavedRange: null,
    activeTemplateInlineFieldId: "",
    templateFieldMode: "create",
    templateFieldEditId: "",
    isSyncingTemplateEditor: false,
    templateEditorDirty: false,
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
    $("#save-template-top").addEventListener("click", () => saveTemplate());
    $("#new-template").addEventListener("click", clearTemplateForm);
    $("#template-picker").addEventListener("change", fillTemplateForm);
    $("#template-content").addEventListener("input", handleTemplateHtmlInput);
    $("#template-live-editor").addEventListener("input", handleLiveTemplateEditorInput);
    $("#template-live-editor").addEventListener("keyup", saveTemplateEditorSelection);
    $("#template-live-editor").addEventListener("mouseup", saveTemplateEditorSelection);
    $("#template-live-editor").addEventListener("focus", saveTemplateEditorSelection);
    $("#template-live-editor").addEventListener("paste", handleLiveTemplateEditorPaste);
    $("#template-name").addEventListener("input", markTemplateDirty);
    $("#template-category").addEventListener("input", markTemplateDirty);
    $("#template-description").addEventListener("input", markTemplateDirty);
    $("#edit-selected-field").addEventListener("click", editSelectedTemplateInlineField);
    $("#delete-selected-field").addEventListener("click", deleteSelectedTemplateInlineField);
    $("#template-selection-size").addEventListener("change", (event) => applySelectedTemplateFieldSize(event.target.value));
    $("#template-field-form").addEventListener("submit", submitTemplateFieldForm);
    $("#close-template-field").addEventListener("click", closeTemplateFieldModal);
    $("#cancel-template-field").addEventListener("click", closeTemplateFieldModal);
    $("#template-field-type").addEventListener("change", updateTemplateFieldModalVisibility);
    ["template-field-label", "template-field-name", "template-field-placeholder", "template-field-role", "template-field-size", "template-field-required"].forEach((id) => {
      $(`#${id}`).addEventListener("input", updateTemplateFieldTagPreview);
      $(`#${id}`).addEventListener("change", updateTemplateFieldTagPreview);
    });

    $$("[data-snippet]").forEach((button) => {
      button.addEventListener("click", () => insertTemplateSnippet(button.dataset.snippet));
    });
    $$("[data-field-type]").forEach((button) => {
      button.addEventListener("click", () => openTemplateFieldModal(button.dataset.fieldType, "create"));
    });
    $$("[data-starter]").forEach((button) => {
      button.addEventListener("click", () => applyTemplateStarter(button.dataset.starter));
    });

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
    $("#template-id-display").value = template.id;
    $("#template-name").value = template.name || "";
    $("#template-category").value = template.category || "";
    $("#template-description").value = template.description || "";
    $("#template-content").value = template.content || "";
    renderTemplateLiveEditorFromContent(template.content || "");
    setTemplateDirty(false);
  }

  function clearTemplateForm() {
    $("#template-picker").value = "";
    $("#template-id").value = "";
    $("#template-id-display").value = "";
    $("#template-name").value = "";
    $("#template-category").value = "";
    $("#template-description").value = "";
    const starter = getTemplateStarter("consent");
    $("#template-content").value = starter;
    renderTemplateLiveEditorFromContent(starter);
    setTemplateDirty(true);
  }

  async function saveTemplate(event) {
    if (event) event.preventDefault();
    syncTemplateLiveEditorToHtml();
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
      setTemplateDirty(false);
      alert("양식이 저장되었습니다.");
      switchAdminTab("templates");
    } catch (error) {
      showError(error);
    } finally {
      showLoading(false);
    }
  }

  function renderTemplateLiveEditorFromContent(content) {
    const editor = $("#template-live-editor");
    const html = String(content || "");
    const records = getTemplateFieldRecords(html);
    let cursor = 0;
    let nextHtml = "";

    records.forEach((record) => {
      nextHtml += html.slice(cursor, record.start);
      nextHtml += renderTemplateInlineFieldHtml(record.field);
      cursor = record.end;
    });
    nextHtml += html.slice(cursor);

    state.isSyncingTemplateEditor = true;
    editor.innerHTML = nextHtml.trim();
    state.isSyncingTemplateEditor = false;
    selectTemplateInlineField("");
    bindTemplateInlineFieldEvents();
    updateTemplateEditorMeta();
    saveTemplateEditorSelection();
  }

  function bindTemplateInlineFieldEvents() {
    const editor = $("#template-live-editor");
    editor.querySelectorAll(".template-inline-field").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectTemplateInlineField(element.dataset.templateInlineFieldId);
      });
      element.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openTemplateFieldModal(element.dataset.fieldType || "text", "edit", element.dataset.templateInlineFieldId);
      });
    });
  }

  function getTemplateFieldRecords(content) {
    const records = [];
    const pattern = /\[\[(text|date|check|sign):([^\]]+)\]\]/g;
    let match;
    let index = 0;
    while ((match = pattern.exec(content || "")) !== null) {
      records.push({
        key: `field-record-${index}-${match.index}`,
        type: match[1],
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
        field: parseFieldSpec(match[1], match[2], index),
      });
      index += 1;
    }
    return records;
  }

  function renderTemplateInlineFieldHtml(field) {
    const id = `template-field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const meta = FIELD_TYPE_META[field.type] || FIELD_TYPE_META.text;
    const label = field.type === "sign" ? (field.role || field.label || field.name) : (field.label || field.name);
    return `
      <span class="template-inline-field template-field-size-${normalizeFieldSize(field.size)}"
        contenteditable="false"
        data-template-inline-field-id="${id}"
        data-field-type="${escapeHtml(field.type)}"
        data-field-name="${escapeHtml(field.name)}"
        data-field-label="${escapeHtml(field.label)}"
        data-field-placeholder="${escapeHtml(field.placeholder || "")}"
        data-field-role="${escapeHtml(field.role || "")}"
        data-field-required="${field.required ? "true" : "false"}"
        data-field-size="${escapeHtml(normalizeFieldSize(field.size))}"
        title="클릭해서 선택, 더블클릭해서 설정 수정">
        <span class="template-inline-field-icon">${escapeHtml(meta.icon)}</span>
        <span class="template-inline-field-copy">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(meta.label)} · ${field.required ? "필수" : "선택"}</span>
        </span>
      </span>
    `;
  }

  function handleLiveTemplateEditorInput() {
    if (state.isSyncingTemplateEditor) return;
    saveTemplateEditorSelection();
    syncTemplateLiveEditorToHtml({ skipRender: true });
    bindTemplateInlineFieldEvents();
    setTemplateDirty(true);
    updateTemplateEditorMeta();
  }

  function handleLiveTemplateEditorPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData("text/plain");
    insertTemplateEditorFragment(escapeHtml(text).replace(/\r?\n/g, "<br>"));
  }

  function handleTemplateHtmlInput() {
    if (state.isSyncingTemplateEditor) return;
    renderTemplateLiveEditorFromContent($("#template-content").value || "");
    setTemplateDirty(true);
  }

  function syncTemplateLiveEditorToHtml(options = {}) {
    const editor = $("#template-live-editor");
    const htmlEditor = $("#template-content");
    if (!editor || !htmlEditor) return;

    const clone = editor.cloneNode(true);
    clone.querySelectorAll(".template-inline-field").forEach((element) => {
      element.replaceWith(clone.ownerDocument.createTextNode(buildFieldTagFromElement(element)));
    });
    clone.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));

    state.isSyncingTemplateEditor = true;
    htmlEditor.value = cleanupTemplateEditorHtml(clone.innerHTML);
    state.isSyncingTemplateEditor = false;

    if (!options.skipRender) updateTemplateEditorMeta();
  }

  function cleanupTemplateEditorHtml(html) {
    return String(html || "")
      .replace(/\sdata-template-inline-field-id="[^"]*"/g, "")
      .replace(/\sdata-field-[a-z-]+="[^"]*"/g, "")
      .replace(/\sclass="template-inline-field[^"]*"/g, "")
      .trim();
  }

  function saveTemplateEditorSelection() {
    const editor = $("#template-live-editor");
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentNode;
    if (node === editor || editor.contains(node)) {
      state.templateEditorSavedRange = range.cloneRange();
    }
  }

  function getTemplateEditorInsertionRange() {
    const editor = $("#template-live-editor");
    let range = state.templateEditorSavedRange;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const selection = window.getSelection();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }

  function insertTemplateEditorFragment(html) {
    const range = getTemplateEditorInsertionRange();
    const container = document.createElement("div");
    container.innerHTML = html;
    const fragment = document.createDocumentFragment();
    let lastNode = null;
    while (container.firstChild) {
      lastNode = container.firstChild;
      fragment.appendChild(lastNode);
    }
    range.deleteContents();
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      state.templateEditorSavedRange = range.cloneRange();
    }
    handleLiveTemplateEditorInput();
  }

  function insertTemplateSnippet(type) {
    const snippets = {
      heading: '<h2 style="margin:24px 0 12px;font-size:22px;color:#111827;">새 제목</h2><p style="margin:0 0 16px;line-height:1.8;color:#374151;">내용을 입력하세요.</p>',
      paragraph: '<p style="margin:16px 0;line-height:1.8;color:#374151;">문단 내용을 입력하세요.</p>',
      notice: '<div style="margin:20px 0;padding:16px 18px;border-radius:16px;border:1px solid #dbeafe;background:#eff6ff;color:#1e3a8a;line-height:1.8;">중요 안내 문구를 입력하세요.</div>',
      table: '<table style="width:100%;border-collapse:collapse;margin:16px 0;"><tbody><tr><th style="width:30%;padding:12px;background:#f3f4f6;border:1px solid #d1d5db;text-align:left;">항목</th><td style="padding:12px;border:1px solid #d1d5db;">내용을 입력하세요.</td></tr></tbody></table>',
    };
    insertTemplateEditorFragment(snippets[type] || snippets.paragraph);
  }

  function applyTemplateStarter(type) {
    const html = getTemplateStarter(type);
    $("#template-content").value = html;
    renderTemplateLiveEditorFromContent(html);
    setTemplateDirty(true);
  }

  function getTemplateStarter(type) {
    const starters = {
      consent: '<section class="doc-heading"><p>CONSENT</p><h1>개인정보 수집 이용 동의서</h1></section><p>아래 내용을 확인하고 개인정보 수집 및 이용에 동의합니다.</p><table class="doc-table"><tr><th>성명</th><td>[[text:성명|required|placeholder=성명을 입력하세요]]</td></tr><tr><th>생년월일</th><td>[[text:생년월일|required|placeholder=예: 1970-01-01]]</td></tr><tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr></table><p>[[check:개인정보동의|required|label=개인정보 수집 및 이용에 동의합니다.]]</p><p>본인 서명: [[sign:본인서명|required|role=본인]]</p>',
      application: '<section class="doc-heading"><p>APPLICATION</p><h1>프로그램 참여 신청서</h1></section><table class="doc-table"><tr><th>프로그램명</th><td>[[text:프로그램명|required|placeholder=프로그램명]]</td></tr><tr><th>참여자 성명</th><td>[[text:참여자성명|required|placeholder=성명]]</td></tr><tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr></table><p>[[check:참여동의|required|label=프로그램 운영 안내와 유의사항을 확인했습니다.]]</p><p>참여자 서명: [[sign:참여자서명|required|role=참여자]]</p>',
      pledge: '<section class="doc-heading"><p>PLEDGE</p><h1>서약서</h1></section><p>본인은 아래 내용을 확인하고 성실히 이행할 것을 서약합니다.</p><table class="doc-table"><tr><th>성명</th><td>[[text:성명|required|placeholder=성명]]</td></tr><tr><th>작성일</th><td>[[date:작성일|required]]</td></tr></table><p>[[check:서약확인|required|label=서약 내용을 확인했습니다.]]</p><p>서명: [[sign:서약자서명|required|role=서약자]]</p>',
    };
    return starters[type] || starters.consent;
  }

  function openTemplateFieldModal(type, mode = "create", inlineFieldId = "") {
    const element = inlineFieldId ? getTemplateInlineFieldElement(inlineFieldId) : null;
    const current = element ? getTemplateInlineFieldConfig(element) : getDefaultFieldConfig(type);
    state.templateFieldMode = mode;
    state.templateFieldEditId = inlineFieldId || "";

    $("#template-field-modal-title").textContent = mode === "edit" ? "입력칸 설정 수정" : "입력칸 추가";
    $("#template-field-type").value = current.type;
    $("#template-field-label").value = current.label || "";
    $("#template-field-name").value = current.name || "";
    $("#template-field-placeholder").value = current.placeholder || "";
    $("#template-field-role").value = current.role || "";
    $("#template-field-size").value = normalizeFieldSize(current.size);
    $("#template-field-required").checked = current.required !== false;
    updateTemplateFieldModalVisibility();
    updateTemplateFieldTagPreview();
    $("#template-field-modal").classList.remove("hidden");
    $("#template-field-label").focus();
  }

  function closeTemplateFieldModal() {
    $("#template-field-modal").classList.add("hidden");
    state.templateFieldMode = "create";
    state.templateFieldEditId = "";
  }

  function updateTemplateFieldModalVisibility() {
    const type = $("#template-field-type").value;
    $("#template-field-placeholder-wrap").classList.toggle("hidden", type === "check" || type === "sign" || type === "date");
    $("#template-field-role-wrap").classList.toggle("hidden", type !== "sign");
    if (type === "sign" && !$("#template-field-role").value.trim()) $("#template-field-role").value = "본인";
    updateTemplateFieldTagPreview();
  }

  function submitTemplateFieldForm(event) {
    event.preventDefault();
    const field = readTemplateFieldForm();
    if (!field.label) {
      alert("표시 이름을 입력해 주세요.");
      return;
    }
    if (state.templateFieldMode === "edit") {
      const element = getTemplateInlineFieldElement(state.templateFieldEditId);
      if (element) updateTemplateInlineFieldElement(element, field);
    } else {
      const temp = document.createElement("span");
      updateTemplateInlineFieldElement(temp, field);
      insertTemplateEditorFragment(temp.outerHTML + " ");
    }
    closeTemplateFieldModal();
    handleLiveTemplateEditorInput();
  }

  function readTemplateFieldForm() {
    const label = $("#template-field-label").value.trim();
    const type = $("#template-field-type").value;
    return {
      id: "",
      type,
      label,
      name: buildSafeFieldName($("#template-field-name").value.trim() || label || "필드"),
      placeholder: $("#template-field-placeholder").value.trim(),
      role: $("#template-field-role").value.trim(),
      size: normalizeFieldSize($("#template-field-size").value),
      required: $("#template-field-required").checked,
    };
  }

  function updateTemplateFieldTagPreview() {
    const preview = $("#template-field-tag-preview");
    if (preview) preview.textContent = buildFieldTagFromConfig(readTemplateFieldForm());
  }

  function getDefaultFieldConfig(type) {
    const labels = { text: "성명", date: "작성일", check: "동의", sign: "본인서명" };
    return {
      type,
      label: labels[type] || "입력칸",
      name: labels[type] || "입력칸",
      placeholder: type === "text" ? `${labels[type] || "내용"}을 입력하세요` : "",
      role: type === "sign" ? "본인" : "",
      size: type === "sign" ? "wide" : "medium",
      required: true,
    };
  }

  function updateTemplateInlineFieldElement(element, field) {
    const normalized = Object.assign(getDefaultFieldConfig(field.type), field);
    const id = element.dataset.templateInlineFieldId || `template-field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const meta = FIELD_TYPE_META[normalized.type] || FIELD_TYPE_META.text;
    const label = normalized.type === "sign" ? (normalized.role || normalized.label || normalized.name) : (normalized.label || normalized.name);
    element.className = `template-inline-field template-field-size-${normalizeFieldSize(normalized.size)}`;
    element.contentEditable = "false";
    element.dataset.templateInlineFieldId = id;
    element.dataset.fieldType = normalized.type;
    element.dataset.fieldName = normalized.name;
    element.dataset.fieldLabel = normalized.label;
    element.dataset.fieldPlaceholder = normalized.placeholder || "";
    element.dataset.fieldRole = normalized.role || "";
    element.dataset.fieldRequired = normalized.required ? "true" : "false";
    element.dataset.fieldSize = normalizeFieldSize(normalized.size);
    element.title = "클릭해서 선택, 더블클릭해서 설정 수정";
    element.innerHTML = `
      <span class="template-inline-field-icon">${escapeHtml(meta.icon)}</span>
      <span class="template-inline-field-copy">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(meta.label)} · ${normalized.required ? "필수" : "선택"}</span>
      </span>
    `;
  }

  function getTemplateInlineFieldElement(id) {
    return id ? $(`#template-live-editor .template-inline-field[data-template-inline-field-id="${escapeSelector(id)}"]`) : null;
  }

  function getSelectedTemplateInlineField() {
    return getTemplateInlineFieldElement(state.activeTemplateInlineFieldId);
  }

  function getTemplateInlineFieldConfig(element) {
    return {
      type: element.dataset.fieldType || "text",
      name: buildSafeFieldName(element.dataset.fieldName || element.dataset.fieldLabel || "필드"),
      label: element.dataset.fieldLabel || element.dataset.fieldName || "필드",
      placeholder: element.dataset.fieldPlaceholder || "",
      role: element.dataset.fieldRole || "",
      required: element.dataset.fieldRequired !== "false",
      size: normalizeFieldSize(element.dataset.fieldSize),
    };
  }

  function selectTemplateInlineField(id) {
    state.activeTemplateInlineFieldId = id || "";
    $$("#template-live-editor .template-inline-field").forEach((element) => {
      element.classList.toggle("is-selected", element.dataset.templateInlineFieldId === id);
    });
    renderTemplateSelectionToolbar();
  }

  function renderTemplateSelectionToolbar() {
    const toolbar = $("#template-selection-toolbar");
    const element = getSelectedTemplateInlineField();
    toolbar.classList.toggle("active", Boolean(element));
    if (!element) return;
    const field = getTemplateInlineFieldConfig(element);
    const meta = FIELD_TYPE_META[field.type] || FIELD_TYPE_META.text;
    $("#template-selection-title").textContent = field.type === "sign" ? (field.role || field.label) : field.label;
    $("#template-selection-detail").textContent = `${meta.label} · ${field.required ? "필수" : "선택"} · ${getFieldSizeLabel(field.size)}`;
    $("#template-selection-size").value = normalizeFieldSize(field.size);
  }

  function editSelectedTemplateInlineField() {
    const element = getSelectedTemplateInlineField();
    if (element) openTemplateFieldModal(element.dataset.fieldType || "text", "edit", element.dataset.templateInlineFieldId);
  }

  function deleteSelectedTemplateInlineField() {
    const element = getSelectedTemplateInlineField();
    if (!element) return;
    element.remove();
    selectTemplateInlineField("");
    handleLiveTemplateEditorInput();
  }

  function applySelectedTemplateFieldSize(size) {
    const element = getSelectedTemplateInlineField();
    if (!element) return;
    const field = getTemplateInlineFieldConfig(element);
    field.size = normalizeFieldSize(size);
    updateTemplateInlineFieldElement(element, field);
    selectTemplateInlineField(element.dataset.templateInlineFieldId);
    handleLiveTemplateEditorInput();
  }

  function buildFieldTagFromElement(element) {
    return buildFieldTagFromConfig(getTemplateInlineFieldConfig(element));
  }

  function buildFieldTagFromConfig(field) {
    const name = buildSafeFieldName(field.name || field.label || "필드");
    const parts = [name, field.required === false ? "optional" : "required"];
    if (field.type === "text" && field.placeholder) parts.push(`placeholder=${sanitizeFieldOption(field.placeholder)}`);
    if (field.type === "check" && field.label) parts.push(`label=${sanitizeFieldOption(field.label)}`);
    if (field.type === "sign" && field.role) parts.push(`role=${sanitizeFieldOption(field.role)}`);
    const size = normalizeFieldSize(field.size);
    if (size !== "medium") parts.push(`size=${size}`);
    return `[[${field.type}:${parts.join("|")}]]`;
  }

  function buildSafeFieldName(value) {
    return String(value || "필드").trim().replace(/[|\[\]=]/g, "").replace(/\s+/g, "_");
  }

  function sanitizeFieldOption(value) {
    return String(value || "").replace(/[|\[\]]/g, "").trim();
  }

  function normalizeFieldSize(value) {
    return ["small", "medium", "wide", "full"].includes(value) ? value : "medium";
  }

  function getFieldSizeLabel(value) {
    return { small: "작게", medium: "보통", wide: "넓게", full: "한 줄 전체" }[normalizeFieldSize(value)];
  }

  function updateTemplateEditorMeta() {
    const records = Array.from($("#template-live-editor").querySelectorAll(".template-inline-field")).map((element, index) => ({
      key: element.dataset.templateInlineFieldId,
      index,
      type: element.dataset.fieldType || "text",
      field: getTemplateInlineFieldConfig(element),
      element,
    }));
    const required = records.filter((record) => record.field.required).length;
    const sign = records.filter((record) => record.type === "sign").length;
    $("#template-field-count").textContent = `필드 ${records.length}개`;
    $("#template-required-count").textContent = `필수 ${required}개`;
    $("#template-optional-count").textContent = `선택 ${records.length - required}개`;
    $("#template-sign-count").textContent = `서명 ${sign}개`;
    renderTemplateFieldList(records);
  }

  function renderTemplateFieldList(records) {
    const list = $("#template-field-list");
    if (!records.length) {
      list.innerHTML = '<div class="empty-state">입력칸을 추가하면 여기에서 한 번에 관리할 수 있습니다.</div>';
      return;
    }
    list.innerHTML = records.map((record) => {
      const meta = FIELD_TYPE_META[record.type] || FIELD_TYPE_META.text;
      return `
        <article class="template-field-item ${state.activeTemplateInlineFieldId === record.key ? "is-highlighted" : ""}" data-template-list-key="${escapeHtml(record.key)}">
          <div class="template-field-item-head">
            <div class="template-field-item-title">
              <strong>${escapeHtml(record.field.label || record.field.name)}</strong>
              <span>저장용 이름: ${escapeHtml(record.field.name)}</span>
            </div>
            <div class="template-field-item-tags">
              <span class="template-chip">${escapeHtml(meta.label)}</span>
              <span class="template-chip">${record.field.required ? "필수" : "선택"}</span>
              <span class="template-chip">${getFieldSizeLabel(record.field.size)}</span>
            </div>
          </div>
          <div class="template-field-actions">
            <button class="mini-btn" type="button" data-locate-field="${escapeHtml(record.key)}">위치 보기</button>
            <button class="mini-btn" type="button" data-edit-field="${escapeHtml(record.key)}">설정 수정</button>
            <button class="mini-btn danger" type="button" data-delete-field="${escapeHtml(record.key)}">삭제</button>
          </div>
        </article>
      `;
    }).join("");
    $$("[data-locate-field]").forEach((button) => {
      button.addEventListener("click", () => locateTemplateInlineField(button.dataset.locateField));
    });
    $$("[data-edit-field]").forEach((button) => {
      button.addEventListener("click", () => openTemplateFieldModal("text", "edit", button.dataset.editField));
    });
    $$("[data-delete-field]").forEach((button) => {
      button.addEventListener("click", () => {
        selectTemplateInlineField(button.dataset.deleteField);
        deleteSelectedTemplateInlineField();
      });
    });
  }

  function locateTemplateInlineField(id) {
    const element = getTemplateInlineFieldElement(id);
    if (!element) return;
    selectTemplateInlineField(id);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function setTemplateDirty(dirty) {
    state.templateEditorDirty = dirty;
    const badge = $("#template-editor-status");
    if (!badge) return;
    badge.classList.toggle("dirty", dirty);
    badge.textContent = dirty ? "수정 중" : "저장된 상태";
  }

  function markTemplateDirty() {
    setTemplateDirty(true);
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

  function escapeSelector(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }
})();
