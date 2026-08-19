/* global window, document, fetch */

const PHASES = ["T0", "T1", "T2", "T3", "T4", "T5"];
const PHASE_LABELS = {
  T0: ["之前已经确定的事", "压缩之前，目标、要求或限制是什么？"],
  T1: ["发生过压缩吗？", "这里有没有明确的上下文压缩？"],
  T2: ["第一次跑偏", "压缩之后，第一次忘记或改错的内容是什么？"],
  T3: ["真的做错了吗？", "有没有按错误方向判断或行动？"],
  T4: ["造成后果了吗？", "有没有测试、代码、工具或返工能证明后果？"],
  T5: ["后来怎么纠正？", "用户或系统后来怎样发现并修正？"],
};
const CLASSIFICATIONS = [
  ["CONFIRMED_COMPACTION_DRIFT", "明确是：压缩后忘了或改错方向"],
  ["PROBABLE_COMPACTION_DRIFT", "可能是：压缩后忘了或改错方向"],
  ["DRIFT_NEAR_MISS", "差点跑偏，但及时纠正了"],
  ["ORDINARY_REASONING_ERROR", "不是压缩，是普通判断错误"],
  ["VALID_PLAN_UPDATE", "这是主动改变计划，不是错误"],
  ["TOOL_FAILURE", "是工具或环境出问题"],
  ["AMBIGUOUS_REQUIREMENT", "要求本身说不清"],
  ["UNRESOLVED", "看到了问题，但还不能确定原因"],
  ["UNASSESSABLE", "证据不够，无法判断"],
];
const FLAGS = [
  ["compaction_caused", "压缩是原因？"],
  ["wrong_action", "发生了错误行动？"],
  ["engineering_consequence", "有工程后果？"],
  ["ordinary_reasoning_better_explanation", "普通推理更能解释？"],
];
const FLAG_OPTIONS = [["", "请选择"], ["YES", "是"], ["NO", "否"], ["UNCERTAIN", "不确定"]];

const refs = {
  loading: document.getElementById("loading-state"),
  error: document.getElementById("error-state"),
  errorCopy: document.getElementById("error-copy"),
  content: document.getElementById("review-content"),
  itemList: document.getElementById("item-list"),
  queueEmpty: document.getElementById("queue-empty"),
  queueSearch: document.getElementById("queue-search"),
  saveStatus: document.getElementById("save-status"),
  queueTotal: document.getElementById("queue-total"),
  progressCount: document.getElementById("progress-count"),
  progressPercent: document.getElementById("progress-percent"),
  progressFill: document.getElementById("progress-fill"),
  filterAllCount: document.getElementById("filter-all-count"),
  filterPositiveCount: document.getElementById("filter-positive-count"),
  filterNearCount: document.getElementById("filter-near-count"),
  filterNegativeCount: document.getElementById("filter-negative-count"),
  itemKicker: document.getElementById("item-kicker"),
  itemTitle: document.getElementById("item-title"),
  itemSubtitle: document.getElementById("item-subtitle"),
  machineCard: document.getElementById("machine-card"),
  sourceCard: document.getElementById("source-card"),
  form: document.getElementById("review-form"),
  classification: document.getElementById("classification"),
  confidence: document.getElementById("confidence"),
  rationale: document.getElementById("rationale"),
  flagFields: document.getElementById("flag-fields"),
  phaseFields: document.getElementById("phase-fields"),
  copyMachine: document.getElementById("copy-machine-button"),
  save: document.getElementById("save-button"),
  previous: document.getElementById("previous-button"),
  next: document.getElementById("next-button"),
  footerPosition: document.getElementById("footer-position"),
  finalize: document.getElementById("finalize-button"),
  groundTruthCopy: document.getElementById("ground-truth-copy"),
  retry: document.getElementById("retry-button"),
  toast: document.getElementById("toast"),
};

const app = {
  summary: null,
  current: null,
  currentId: null,
  filter: "ALL",
  query: "",
  visibleIds: [],
  toastTimer: null,
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[character]));
}

function shortHash(value, length = 10) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function showToast(message, isError = false) {
  refs.toast.textContent = message;
  refs.toast.classList.toggle("is-error", isError);
  refs.toast.classList.add("is-visible");
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 3600);
}

function setLoading(isLoading) {
  refs.loading.classList.toggle("is-hidden", !isLoading);
  refs.content.classList.toggle("is-hidden", isLoading || Boolean(refs.error.dataset.active));
}

function showError(error) {
  setLoading(false);
  refs.error.dataset.active = "true";
  refs.error.classList.remove("is-hidden");
  refs.content.classList.add("is-hidden");
  refs.errorCopy.textContent = error instanceof Error ? error.message : String(error);
  refs.saveStatus.textContent = "读取失败";
}

function clearError() {
  delete refs.error.dataset.active;
  refs.error.classList.add("is-hidden");
}

function populateStaticFields() {
  refs.classification.innerHTML = [
    '<option value="">请选择人工分类</option>',
    ...CLASSIFICATIONS.map(([value, label]) => `<option value="${value}">${label}</option>`),
  ].join("");
  refs.flagFields.innerHTML = FLAGS.map(([key, label]) => `
    <label class="field">
      <span>${label} <span class="required">*</span></span>
      <select data-flag="${key}" required>${FLAG_OPTIONS.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select>
    </label>
  `).join("");
}

function bucketClass(bucket) {
  if (bucket === "CONFIRMED_OR_PROBABLE_POSITIVE") return "positive";
  if (bucket === "DRIFT_NEAR_MISS") return "near";
  return "negative";
}

function bucketLabel(bucket) {
  return {
    CONFIRMED_OR_PROBABLE_POSITIVE: "候选阳性",
    DRIFT_NEAR_MISS: "近失",
    DIFFICULT_NEGATIVE_OR_UNASSESSABLE: "困难阴性 / 不可评估",
  }[bucket] || bucket || "待分组";
}

function phaseStatusLabel(status) {
  return { PRESENT: "有证据", ABSENT: "明确没有", UNASSESSABLE: "看不出来" }[status] || "未判断";
}

function renderQueue() {
  if (!app.summary) return;
  const query = app.query.trim().toLowerCase();
  const filtered = app.summary.items.filter((item) => {
    const inBucket = app.filter === "ALL" || item.triage_bucket === app.filter;
    const haystack = `${item.topic || ""} ${item.episode_key || ""} ${item.machine_classification || ""}`.toLowerCase();
    return inBucket && (!query || haystack.includes(query));
  });
  app.visibleIds = filtered.map((item) => item.review_item_id);
  refs.itemList.innerHTML = filtered.map((item) => `
    <button class="item-button ${item.review_item_id === app.currentId ? "is-selected" : ""}" data-item-id="${escapeHTML(item.review_item_id)}">
      <span class="item-row"><span class="item-topic" title="${escapeHTML(item.topic || "未命名")}">${escapeHTML(item.topic || "未命名")}</span><span class="item-status ${item.saved ? "is-saved" : ""}" title="${item.saved ? "已保存" : "尚未保存"}" aria-label="${item.saved ? "已保存" : "尚未保存"}"></span></span>
      <span class="item-meta"><span>${escapeHTML(item.episode_key || "bundle")}</span><span>·</span><span>${escapeHTML(shortHash(item.incident_case_id_hash, 8))}</span></span>
      <span class="item-label ${bucketClass(item.triage_bucket)}">${escapeHTML(bucketLabel(item.triage_bucket))}</span>
    </button>
  `).join("");
  refs.itemList.querySelectorAll("[data-item-id]").forEach((button) => {
    button.addEventListener("click", () => loadItem(button.dataset.itemId));
  });
  refs.queueEmpty.classList.toggle("is-hidden", filtered.length > 0);
  updateNavigation();
}

function updateSummary(summary) {
  app.summary = summary;
  const total = summary.total || 0;
  const saved = summary.saved || 0;
  const percent = total ? Math.round((saved / total) * 100) : 0;
  refs.queueTotal.textContent = total;
  refs.progressCount.textContent = `${saved} / ${total}`;
  refs.progressPercent.textContent = `${percent}%`;
  refs.progressFill.style.width = `${percent}%`;
  refs.filterAllCount.textContent = total;
  refs.filterPositiveCount.textContent = summary.triage_bucket_counts?.CONFIRMED_OR_PROBABLE_POSITIVE || 0;
  refs.filterNearCount.textContent = summary.triage_bucket_counts?.DRIFT_NEAR_MISS || 0;
  refs.filterNegativeCount.textContent = summary.triage_bucket_counts?.DIFFICULT_NEGATIVE_OR_UNASSESSABLE || 0;
  refs.finalize.disabled = !summary.ground_truth_ready;
  refs.groundTruthCopy.textContent = summary.finalized
    ? "已生成 HUMAN_CONFIRMED Ground Truth；复核已锁定。"
    : (summary.ground_truth_ready
      ? `${total} 项都已保存；确认后会写入 Ground Truth。`
      : `还剩 ${summary.remaining} 项未保存；未完成时不会生成 Ground Truth.`);
  refs.save.disabled = Boolean(summary.finalized);
  refs.saveStatus.textContent = `${saved}/${total} 已保存`;
  renderQueue();
}

function evidenceCatalog(packet) {
  const source = (packet.source_events || []).map((event) => ({
    id: event.evidence_id,
    kind: "source",
    label: `${event.record_type || "event"} · ${event.payload_type || "message"}`,
    detail: event.sequence == null ? "" : `seq ${event.sequence}`,
    excerpt: event.content || "[无可显示内容]",
  }));
  const boundaries = (packet.compaction_opportunities || []).map((opportunity) => {
    const event = opportunity.compaction_event || {};
    return {
      id: opportunity.boundary_id_hash,
      kind: "boundary",
      label: "COMPACTION BOUNDARY",
      detail: event.sequence == null ? "" : `seq ${event.sequence}`,
      excerpt: "[compaction boundary；没有把摘要内容当作证据]",
    };
  });
  return [...source, ...boundaries].filter((item) => item.id);
}

function renderMachineCard(item) {
  const machine = item.machine_prelabel || {};
  const phaseCards = PHASES.map((phase) => {
    const value = machine[phase] || {};
    return `<div class="machine-phase"><strong>${phase} · ${phaseStatusLabel(value.status)}</strong><span>${escapeHTML(value.summary || "没有机器摘要")}</span></div>`;
  }).join("");
  const flags = FLAGS.map(([key, label]) => `<span>${escapeHTML(label)} ${escapeHTML(machine[key] || "—")}</span>`).join('<span class="chip-separator">·</span>');
  const machineLabel = CLASSIFICATIONS.find(([value]) => value === (machine.classification || item.machine_classification))?.[1] || "还不能判断";
  const independent = item.independent_review || null;
  const independentEpisode = independent?.episodes?.[0] || null;
  const independentLabel = CLASSIFICATIONS.find(([value]) => value === independentEpisode?.classification)?.[1]
    || independentEpisode?.classification
    || "没有独立意见";
  const independentCard = independentEpisode ? `
    <div class="independent-review-card">
      <div class="machine-card-header"><div>
        <span class="machine-badge independent-badge">本地 Subagent 辅助意见 · 不是最终答案</span>
        <h3>${escapeHTML(independentLabel)}</h3>
      </div></div>
      <p class="machine-summary">范围：整个 packet（不是当前 episode 的逐条结论）；复核深度：${escapeHTML(independent.review_depth || "未注明")}。它与系统意见都只是参考，最终以你的来源判断为准。</p>
      <details class="machine-details"><summary>查看独立意见理由</summary>
        <p class="machine-summary">${escapeHTML(independentEpisode.rationale || independent.bundle_assessment || "没有提供理由。")}</p>
      </details>
    </div>
  ` : "";
  refs.machineCard.innerHTML = `
    <div class="machine-card-header"><div><span class="machine-badge">系统先帮你筛过 · 不是最终答案</span><h3>系统初步判断：${escapeHTML(machineLabel)}</h3></div></div>
    <p class="machine-summary">你可以按自己的判断选择；系统建议只是帮你节省时间，不会自动写入最终记录。</p>
    <details class="machine-details"><summary>查看系统为什么这样建议</summary><p class="machine-summary">${escapeHTML(machine.rationale || "系统没有提供更多说明。")}</p><div class="flag-line">${flags}</div><div class="machine-timeline">${phaseCards}</div></details>
    ${independentCard}
  `;
}

function renderSourceCard(packet) {
  const events = evidenceCatalog(packet).sort((a, b) => (a.kind === "boundary" ? 1 : 0) - (b.kind === "boundary" ? 1 : 0));
  const eventHTML = events.map((event) => `
    <article class="source-event ${event.kind === "boundary" ? "boundary-event" : ""}">
      <div class="source-event-meta"><strong>${escapeHTML(event.label)}</strong><span>${escapeHTML(event.detail)}</span></div>
      <p class="source-event-content">${escapeHTML(event.excerpt)}</p>
    </article>
  `).join("");
  refs.sourceCard.innerHTML = `
    <details>
      <summary><span><span class="source-card-title">原始对话和记录</span><br /><span class="source-card-subtitle">需要时展开查看；共有 ${events.length} 条可引用证据</span></span></summary>
      <div class="source-events">${eventHTML || "<p class=\"muted-copy\">没有可显示的来源事件。</p>"}</div>
    </details>
  `;
}

function renderPhaseFields(packet, answer) {
  const catalog = evidenceCatalog(packet);
  refs.phaseFields.innerHTML = PHASES.map((phase) => {
    const phaseValue = answer?.[phase] || {};
    const options = catalog.map((evidence, index) => `
      <label class="evidence-option" title="${escapeHTML(evidence.id)}">
        <input type="checkbox" data-phase-evidence="${phase}" value="${escapeHTML(evidence.id)}" ${phaseValue.evidence_ids?.includes(evidence.id) ? "checked" : ""} />
        <span>来源 ${index + 1} · ${escapeHTML(evidence.label)}<code>${evidence.detail ? escapeHTML(evidence.detail) : "点击即可引用"}</code></span>
      </label>
    `).join("");
    return `
      <article class="phase-card" data-phase-card="${phase}">
        <header class="phase-card-header"><span class="phase-tag">${phase}</span><div class="phase-copy"><h4>${PHASE_LABELS[phase][0]}</h4><p>${PHASE_LABELS[phase][1]}</p></div></header>
        <div class="phase-controls">
          <label class="field"><span>这里有这件事吗？ <span class="required">*</span></span><select data-phase-status="${phase}" required><option value="">请选择</option><option value="PRESENT">有证据</option><option value="ABSENT">明确没有</option><option value="UNASSESSABLE">看不出来</option></select></label>
          <label class="field"><span>简单说一下（可不填）</span><textarea data-phase-summary="${phase}" rows="2" maxlength="1000" placeholder="这一阶段发生了什么？"></textarea></label>
        </div>
        <fieldset class="phase-evidence"><legend>如果选“有证据”，请勾选下面的来源</legend><div class="evidence-options">${options || "<span class=\"muted-copy\">没有可引用证据</span>"}</div></fieldset>
      </article>
    `;
  }).join("");
  PHASES.forEach((phase) => {
    const status = refs.phaseFields.querySelector(`[data-phase-status="${phase}"]`);
    if (status) {
      status.value = answer?.[phase]?.status || "";
      status.addEventListener("change", () => updatePhaseStyle(phase));
      updatePhaseStyle(phase);
    }
  });
}

function updatePhaseStyle(phase) {
  const card = refs.phaseFields.querySelector(`[data-phase-card="${phase}"]`);
  const status = refs.phaseFields.querySelector(`[data-phase-status="${phase}"]`);
  if (!card || !status) return;
  card.classList.toggle("phase-present", status.value === "PRESENT");
  card.classList.toggle("phase-unassessable", status.value === "UNASSESSABLE");
}

function loadForm(answer) {
  const value = answer || {};
  refs.classification.value = value.classification || "";
  refs.confidence.value = value.confidence ?? "";
  refs.rationale.value = value.rationale || "";
  refs.flagFields.querySelectorAll("[data-flag]").forEach((select) => {
    select.value = value[select.dataset.flag] || "";
  });
  renderPhaseFields(app.current.source_packet, value);
}

function readForm() {
  const answer = {
    incident_case_id_hash: app.current.review_item.incident_case_id_hash,
    episode_key: app.current.review_item.episode_key,
    classification: refs.classification.value,
    compaction_caused: refs.flagFields.querySelector('[data-flag="compaction_caused"]').value,
    wrong_action: refs.flagFields.querySelector('[data-flag="wrong_action"]').value,
    engineering_consequence: refs.flagFields.querySelector('[data-flag="engineering_consequence"]').value,
    ordinary_reasoning_better_explanation: refs.flagFields.querySelector('[data-flag="ordinary_reasoning_better_explanation"]').value,
    confidence: refs.confidence.value === "" ? null : Number(refs.confidence.value),
    rationale: refs.rationale.value,
  };
  PHASES.forEach((phase) => {
    answer[phase] = {
      status: refs.phaseFields.querySelector(`[data-phase-status="${phase}"]`).value,
      summary: refs.phaseFields.querySelector(`[data-phase-summary="${phase}"]`).value,
      evidence_ids: [...refs.phaseFields.querySelectorAll(`[data-phase-evidence="${phase}"]:checked`)].map((input) => input.value),
    };
  });
  return answer;
}

function clientValidate(answer) {
  const errors = [];
  const required = ["classification", "compaction_caused", "wrong_action", "engineering_consequence", "ordinary_reasoning_better_explanation"];
  required.forEach((key) => { if (!answer[key]) errors.push("请完成人工结论字段。"); });
  if (typeof answer.confidence !== "number" || Number.isNaN(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) errors.push("请选择你有多确定。");
  PHASES.forEach((phase) => {
    if (!answer[phase].status) errors.push(`${phase} 还没有选择“有 / 没有 / 看不出来”。`);
    if (answer[phase].status === "PRESENT" && answer[phase].evidence_ids.length === 0) errors.push(`${phase} 选了“有证据”时，请勾一个来源。`);
  });
  return [...new Set(errors)];
}

function markInvalid(errors) {
  refs.form.querySelectorAll(".is-invalid").forEach((node) => node.classList.remove("is-invalid"));
  if (!errors.length) return;
  const first = refs.form.querySelector("select:invalid, input:invalid, textarea:invalid") || refs.form.querySelector("select, input, textarea");
  if (first) {
    first.closest(".field")?.classList.add("is-invalid");
    first.focus();
  }
  showToast(errors[0], true);
}

async function loadItem(itemId) {
  if (!itemId) return;
  try {
    refs.saveStatus.textContent = "正在读取案例…";
    const payload = await api(`/api/items/${encodeURIComponent(itemId)}`);
    app.currentId = itemId;
    app.current = payload;
    refs.itemKicker.textContent = `${bucketLabel(payload.review_item.triage_bucket)} · 请看来源再判断`;
    refs.itemTitle.textContent = payload.review_item.topic || "未命名案例";
    refs.itemSubtitle.textContent = `${payload.review_item.episode_key || "这一组对话"} · 请根据下面的原始对话做判断`;
    renderMachineCard({ ...payload.review_item, independent_review: payload.independent_review });
    renderSourceCard(payload.source_packet);
    loadForm(payload.draft_answer);
    refs.content.classList.remove("is-hidden");
    refs.loading.classList.add("is-hidden");
    clearError();
    renderQueue();
    updateNavigation();
  } catch (error) {
    showError(error);
  }
}

function updateNavigation() {
  const index = app.visibleIds.indexOf(app.currentId);
  const safeIndex = index < 0 ? 0 : index;
  refs.footerPosition.textContent = `${app.visibleIds.length ? safeIndex + 1 : 0} / ${app.visibleIds.length}`;
  refs.previous.disabled = safeIndex <= 0;
  refs.next.disabled = safeIndex < 0 || safeIndex >= app.visibleIds.length - 1;
}

function move(delta) {
  const index = app.visibleIds.indexOf(app.currentId);
  const nextIndex = Math.max(0, Math.min(app.visibleIds.length - 1, index + delta));
  if (app.visibleIds[nextIndex]) loadItem(app.visibleIds[nextIndex]);
}

async function saveCurrent() {
  if (!app.current) return;
  if (app.summary?.finalized) {
    showToast("Ground Truth 已生成，复核已锁定。", true);
    return;
  }
  const answer = readForm();
  const errors = clientValidate(answer);
  markInvalid(errors);
  if (errors.length) return;
  refs.save.disabled = true;
  refs.saveStatus.textContent = "正在保存…";
  try {
    const result = await api("/api/save-answer", {
      method: "POST",
      body: JSON.stringify({ review_item_id: app.currentId, answer }),
    });
    app.current.draft_answer = answer;
    updateSummary(result.state);
    showToast("已保存。这个决定仍然可以修改。\n");
  } catch (error) {
    showToast(error.message, true);
    refs.saveStatus.textContent = "保存失败";
  } finally {
    refs.save.disabled = Boolean(app.summary?.finalized);
  }
}

function copyMachineDraft() {
  if (!app.current) return;
  if (app.summary?.finalized) {
    showToast("Ground Truth 已生成，复核已锁定。", true);
    return;
  }
  const machine = app.current.review_item.machine_prelabel || {};
  const machineConfidence = Number(machine.confidence);
  const confidence = Number.isFinite(machineConfidence)
    ? (machineConfidence >= 0.8 ? 0.9 : machineConfidence >= 0.55 ? 0.7 : machineConfidence >= 0.25 ? 0.4 : 0.1)
    : 0.4;
  const copy = JSON.parse(JSON.stringify({
    incident_case_id_hash: app.current.review_item.incident_case_id_hash,
    episode_key: app.current.review_item.episode_key,
    ...machine,
    confidence,
  }));
  loadForm(copy);
  showToast("已填入机器辅助结果；请检查来源并保存为人工判断。\n");
}

async function finalize() {
  if (!app.summary?.ground_truth_ready) return;
  const accepted = window.confirm(`${app.summary.total} 项都已保存。现在把你的判断保存成最终结果吗？`);
  if (!accepted) return;
  refs.finalize.disabled = true;
  try {
    const result = await api("/api/finalize", { method: "POST", body: JSON.stringify({ confirm: true }) });
    refs.groundTruthCopy.textContent = "最终结果已保存；这批复核现在已经锁定。";
    refs.saveStatus.textContent = "最终结果已保存";
    showToast(`完成：${result.result.review_item_count} 条人工记录已写入。`);
  } catch (error) {
    showToast(error.message, true);
    refs.finalize.disabled = false;
  }
}

async function refresh() {
  try {
    setLoading(true);
    clearError();
    const summary = await api("/api/state");
    updateSummary(summary);
    const preferred = app.currentId && summary.items.some((item) => item.review_item_id === app.currentId)
      ? app.currentId
      : (summary.items.find((item) => !item.saved)?.review_item_id || summary.items[0]?.review_item_id);
    if (preferred) await loadItem(preferred);
    else {
      refs.loading.classList.add("is-hidden");
      refs.content.classList.remove("is-hidden");
      refs.itemTitle.textContent = "队列为空";
    }
  } catch (error) {
    showError(error);
  }
}

refs.classification.addEventListener("change", () => refs.classification.closest(".field")?.classList.remove("is-invalid"));
refs.save.addEventListener("click", saveCurrent);
refs.copyMachine.addEventListener("click", copyMachineDraft);
refs.previous.addEventListener("click", () => move(-1));
refs.next.addEventListener("click", () => move(1));
refs.finalize.addEventListener("click", finalize);
refs.retry.addEventListener("click", refresh);
refs.queueSearch.addEventListener("input", (event) => { app.query = event.target.value; renderQueue(); });
document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    app.filter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((other) => {
      const active = other === button;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-selected", String(active));
    });
    renderQueue();
  });
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveCurrent();
  }
});

populateStaticFields();
refresh();
