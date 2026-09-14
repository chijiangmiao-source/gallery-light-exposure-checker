<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ResultPanel from './components/ResultPanel.vue';
import {
  clearDraft,
  createBrowserDraftStorage,
  draftHasContent,
  loadDraft,
  saveDraft,
  type DraftData,
  type DraftStorage,
} from './lib/draft';
import {
  computeExposure,
  countErrors,
  fmtDateTime,
  simulateCap,
  simulationBasis,
  validateCapInput,
  validateForm,
  type CapSimulation,
  type ExposureResult,
  type FormErrors,
  type FormInput,
} from './lib/exposure';

const form = reactive<FormInput>({
  name: '',
  shiftStart: '',
  shiftEnd: '',
  limit: '',
  rows: [
    { time: '', lux: '' },
    { time: '', lux: '' },
  ],
  blackouts: [],
});

const errors = ref<FormErrors | null>(null);
const result = ref<ExposureResult | null>(null);
const resultName = ref('');

// 模拟照度上限：输入文本、控件旁反馈与最近一次有效模拟
const capText = ref('');
const capError = ref<string | null>(null);
const simulation = ref<CapSimulation | null>(null);
/** 模拟过期原因：模拟所依据的表格 / 限额被改动后，旧方案不得再展示或应用 */
const staleNotice = ref<string | null>(null);

const errorCount = computed(() => (errors.value ? countErrors(errors.value) : 0));

/** 模拟所依据的全部输入指纹；与生成模拟时的快照比较即可判定方案是否过期 */
const currentBasis = computed(() => simulationBasis(form));

function revokeSimulation(reason: string): void {
  simulation.value = null;
  staleNotice.value = reason;
}

// 模拟结果展示期间，其依据的任一字段（班次时间点、限额、各行时间点 / 照度）
// 一旦被手动修改，旧模拟立即过期：撤销预计总量与判定，应用也随之不可用
watch(
  currentBasis,
  () => {
    if (simulation.value) revokeSimulation('模拟所依据的班次、限额或照度已修改，原模拟结果已撤销，请重新模拟');
  },
  { deep: true },
);

// 上限输入框改成与已模拟方案不同的合法新值但未重新模拟时，展示中的结果与输入
// 不匹配：拒绝「应用到表格」回填旧上限方案；非法输入不在此列（按规则仅控件旁
// 反馈，最近一次有效模拟不受影响），改回原上限或重新模拟后恢复可应用
const capMismatch = computed(() => {
  const sim = simulation.value;
  if (!sim) return false;
  const { cap } = validateCapInput(capText.value);
  return cap !== null && cap.toString() !== sim.cap.toString();
});

const mismatchNotice = computed(() =>
  capMismatch.value
    ? '模拟照度上限已改为新数值但尚未重新模拟，请先点击「模拟」生成新方案，或改回原上限后再应用'
    : null,
);

// ---------------------------------------------------------------------------
// 浏览器草稿：录入内容自动保存，刷新 / 关闭后再次进入可选择恢复
// ---------------------------------------------------------------------------

/** localStorage 适配；浏览器禁用存储时为 null，草稿功能静默停用，其余行为不变 */
const draftStorage = ref<DraftStorage | null>(null);
/** 启动时发现的结构合法草稿；在用户做出选择前不写入表单 */
const pendingDraft = ref<DraftData | null>(null);
const pendingSavedAt = ref<string | null>(null);
/** 启动时发现损坏 / 版本不受支持的草稿记录：提示不可用，拒绝写入表单 */
const draftCorrupt = ref(false);

function draftDecisionPending(): boolean {
  return pendingDraft.value !== null || draftCorrupt.value;
}

function collectDraft(): DraftData {
  return {
    name: form.name,
    shiftStart: form.shiftStart,
    shiftEnd: form.shiftEnd,
    limit: form.limit,
    rows: form.rows.map((r) => ({ time: r.time, lux: r.lux })),
    blackouts: (form.blackouts ?? []).map((b) => ({ start: b.start, end: b.end })),
  };
}

/** 立即持久化当前输入；恢复决定未做出时不得覆盖存储中的旧草稿；空表单清除记录 */
function persistNow(): void {
  const storage = draftStorage.value;
  if (!storage || draftDecisionPending()) return;
  const data = collectDraft();
  if (draftHasContent(data)) {
    saveDraft(storage, data, new Date().toISOString());
  } else {
    clearDraft(storage);
  }
}

/** pagehide（刷新 / 关闭页面）时保存：尚未决定恢复与否则保留原记录；空表单则清除记录 */
function persistOnHide(): void {
  const storage = draftStorage.value;
  if (!storage || draftDecisionPending()) return;
  const data = collectDraft();
  if (draftHasContent(data)) {
    saveDraft(storage, data, new Date().toISOString());
  } else {
    clearDraft(storage);
  }
}

/** 摘要：用户决定恢复前先看到草稿概况（不触碰表单） */
const draftSummary = computed(() => {
  const d = pendingDraft.value;
  if (!d) return null;
  const dash = '（未填写）';
  const dt = (v: string) => (v.trim() ? v.trim().replace('T', ' ') : dash);
  let savedText = '';
  if (pendingSavedAt.value) {
    const t = new Date(pendingSavedAt.value);
    if (!Number.isNaN(t.getTime())) savedText = fmtDateTime(t);
  }
  return {
    name: d.name.trim() || dash,
    shiftStart: dt(d.shiftStart),
    shiftEnd: dt(d.shiftEnd),
    limit: d.limit.trim() || dash,
    rowCount: d.rows.length,
    filledTimes: d.rows.filter((r) => r.time.trim() !== '').length,
    filledLux: d.rows.filter((r) => r.lux.trim() !== '').length,
    blackoutCount: d.blackouts.length,
    savedText,
  };
});

/** 恢复草稿：仅替换录入字段；旧结论、模拟方案、错误标记一律不带回，仍走原核算校验 */
function restoreDraft(): void {
  const d = pendingDraft.value;
  if (!d) return;
  form.name = d.name;
  form.shiftStart = d.shiftStart;
  form.shiftEnd = d.shiftEnd;
  form.limit = d.limit;
  form.rows.splice(0, form.rows.length, ...d.rows.map((r) => ({ time: r.time, lux: r.lux })));
  form.blackouts = d.blackouts.map((b) => ({ start: b.start, end: b.end }));
  result.value = null;
  resultName.value = '';
  errors.value = null;
  simulation.value = null;
  capText.value = '';
  capError.value = null;
  staleNotice.value = null;
  pendingDraft.value = null;
  pendingSavedAt.value = null;
  // 恢复后继续自动保存当前输入
  persistNow();
}

/** 放弃草稿：清除存储记录；初始表单（或当前页面内容）保持不变 */
function abandonDraft(): void {
  if (draftStorage.value) clearDraft(draftStorage.value);
  pendingDraft.value = null;
  pendingSavedAt.value = null;
  draftCorrupt.value = false;
}

// 录入即自动保存（深度监听）；恢复决定未做出前跳过，避免覆盖待决草稿
watch(form, persistNow, { deep: true });

onMounted(() => {
  const storage = createBrowserDraftStorage();
  draftStorage.value = storage;
  if (!storage) return;
  const stored = loadDraft(storage);
  if (stored.status === 'ok' && draftHasContent(stored.data)) {
    // 有内容的合法草稿：先展示摘要，由用户选择恢复或放弃（此前不触碰表单）
    pendingDraft.value = stored.data;
    pendingSavedAt.value = stored.savedAt;
  } else if (stored.status === 'corrupt') {
    // 损坏 / 版本不受支持：不写入表单，仅提示草稿不可用
    draftCorrupt.value = true;
  }
  window.addEventListener('pagehide', persistOnHide);
});

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', persistOnHide);
});

function rowHasError(index: number): boolean {
  const rowErrors = errors.value?.rowErrors[index];
  return Boolean(rowErrors?.time || rowErrors?.lux);
}

function addRow(): void {
  form.rows.push({ time: '', lux: '' });
  // 行结构变化后旧错误索引不再对应，清除标记待下次提交重判；既有模拟的行号同样失效
  errors.value = null;
  simulation.value = null;
  capError.value = null;
  staleNotice.value = null;
}

function removeRow(index: number): void {
  if (form.rows.length > 2) {
    form.rows.splice(index, 1);
    errors.value = null;
    simulation.value = null;
    capError.value = null;
    staleNotice.value = null;
  }
}

function blackoutHasError(index: number): boolean {
  const blErr = errors.value?.blackoutErrors[index];
  return Boolean(blErr?.start || blErr?.end || blErr?.overlap);
}

function addBlackout(): void {
  form.blackouts?.push({ start: '', end: '' });
  // 区间结构变化后旧错误索引不再对应，清除标记待下次提交重判；
  // 停照区间不影响模拟（模拟以原始时间点为输入），既有模拟保持有效
  errors.value = null;
}

function removeBlackout(index: number): void {
  form.blackouts?.splice(index, 1);
  errors.value = null;
}

function submit(): void {
  const outcome = validateForm(form);
  if (outcome.parsed) {
    errors.value = null;
    result.value = computeExposure(outcome.parsed);
    resultName.value = outcome.parsed.name;
    // 新正式结论生成后，此前基于旧表格的模拟不再适用
    simulation.value = null;
    capError.value = null;
    staleNotice.value = null;
  } else {
    // 合并标出全部错误行；保留输入，不更新旧结论
    errors.value = outcome.errors;
  }
}

function simulate(cap: string): void {
  const { cap: parsedCap, error } = validateCapInput(cap);
  if (!parsedCap) {
    // 非法上限：仅在模拟控件旁反馈，不改表格、正式结论与最近一次有效模拟
    capError.value = error;
    return;
  }
  const outcome = validateForm(form);
  if (!outcome.parsed) {
    capError.value = '表格录入存在错误，请先修正并核算后再模拟';
    return;
  }
  // 表格已通过完整校验，旧的错误标记随之失效
  errors.value = null;
  capError.value = null;
  staleNotice.value = null;
  // 规范化上限输入文本（如末位零、两侧空格），使输入框与方案上限严格匹配
  capText.value = parsedCap.toString();
  simulation.value = simulateCap(outcome.parsed, parsedCap);
}

function applySimulation(): void {
  const sim = simulation.value;
  // 无有效方案（含已被撤销的过期方案）时拒绝回填
  if (!sim) return;
  // 当前上限与方案不匹配（改成新值但未重新模拟）时，拒绝使用不匹配的旧方案
  if (capMismatch.value) return;
  // 把模拟后的照度写回当前各行；班次、限额和展品名保持不变
  sim.cappedLuxTexts.forEach((lux, i) => {
    if (i < form.rows.length) form.rows[i].lux = lux;
  });
  // 清除模拟结果；正式结论待用户再按原核算按钮生成
  simulation.value = null;
  capError.value = null;
  staleNotice.value = null;
  capText.value = '';
}
</script>

<template>
  <main class="page">
    <header class="page-header">
      <h1>展品照度暴露核算台</h1>
      <p class="subtitle">闭馆交接班次 · 敏感展品当班暴露量核算（数据仅在本地浏览器处理）</p>
    </header>

    <section
      v-if="pendingDraft && draftSummary"
      class="card draft-card"
      data-testid="draft-prompt"
      role="dialog"
      aria-labelledby="draft-prompt-title"
    >
      <h2 id="draft-prompt-title">发现未完成的录入草稿</h2>
      <p class="hint" v-if="draftSummary.savedText">保存于 {{ draftSummary.savedText }}</p>
      <dl class="draft-summary" data-testid="draft-summary">
        <div><dt>展品名</dt><dd>{{ draftSummary.name }}</dd></div>
        <div><dt>班次</dt><dd>{{ draftSummary.shiftStart }} → {{ draftSummary.shiftEnd }}</dd></div>
        <div><dt>允许暴露量</dt><dd>{{ draftSummary.limit }}</dd></div>
        <div>
          <dt>时间点与照度</dt>
          <dd>{{ draftSummary.rowCount }} 行（已填时间点 {{ draftSummary.filledTimes }} / 照度 {{ draftSummary.filledLux }}）</dd>
        </div>
        <div><dt>停照区间</dt><dd>{{ draftSummary.blackoutCount }} 个</dd></div>
      </dl>
      <p class="hint">
        恢复草稿只会替换下方录入内容，不会带回此前结论或模拟方案；恢复后请重新点击「核算」。
      </p>
      <div class="actions">
        <button type="button" class="primary" data-testid="draft-restore" @click="restoreDraft">
          恢复草稿
        </button>
        <button type="button" data-testid="draft-discard" @click="abandonDraft">放弃草稿</button>
      </div>
    </section>

    <section
      v-else-if="draftCorrupt"
      class="card draft-card corrupt"
      data-testid="draft-corrupt"
      role="alert"
    >
      <h2>浏览器中的录入草稿不可用</h2>
      <p class="error-text">
        草稿数据已损坏、字段缺失或来自不支持的版本，为避免覆盖当前表单，未载入任何内容。
      </p>
      <div class="actions">
        <button type="button" data-testid="draft-discard-corrupt" @click="abandonDraft">
          放弃草稿
        </button>
      </div>
    </section>

    <section class="card">
      <form novalidate @submit.prevent="submit">
        <div class="grid">
          <div class="field" :class="{ invalid: Boolean(errors?.name) }">
            <label for="exhibit-name">展品名</label>
            <input
              id="exhibit-name"
              v-model="form.name"
              data-testid="exhibit-name"
              type="text"
              placeholder="如：唐代绢画"
            />
            <p v-if="errors?.name" class="error" data-testid="error-name">{{ errors.name }}</p>
          </div>

          <div class="field" :class="{ invalid: Boolean(errors?.limit) }">
            <label for="limit">允许暴露量（lx·h）</label>
            <input
              id="limit"
              v-model="form.limit"
              data-testid="limit"
              type="text"
              inputmode="decimal"
              placeholder="0.01 – 100000，最多两位小数"
            />
            <p v-if="errors?.limit" class="error" data-testid="error-limit">{{ errors.limit }}</p>
          </div>

          <div class="field" :class="{ invalid: Boolean(errors?.shiftStart) }">
            <label for="shift-start">班次开始</label>
            <input
              id="shift-start"
              v-model="form.shiftStart"
              data-testid="shift-start"
              type="datetime-local"
              step="60"
            />
            <p v-if="errors?.shiftStart" class="error" data-testid="error-shift-start">
              {{ errors.shiftStart }}
            </p>
          </div>

          <div class="field" :class="{ invalid: Boolean(errors?.shiftEnd) }">
            <label for="shift-end">班次结束</label>
            <input
              id="shift-end"
              v-model="form.shiftEnd"
              data-testid="shift-end"
              type="datetime-local"
              step="60"
            />
            <p v-if="errors?.shiftEnd" class="error" data-testid="error-shift-end">
              {{ errors.shiftEnd }}
            </p>
          </div>
        </div>

        <h2>班次内时间点与照度</h2>
        <p class="hint">
          首末时间点须分别等于班次起止，中间点严格递增（允许跨日）；照度 0 – 5000 lx，最多两位小数。
        </p>
        <p v-if="errors?.rows" class="error" data-testid="error-rows">{{ errors.rows }}</p>

        <table class="points">
          <thead>
            <tr>
              <th class="col-index">#</th>
              <th>时间点（本地，精确到分钟）</th>
              <th>照度（lx）</th>
              <th class="col-op"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in form.rows"
              :key="i"
              data-testid="point-row"
              :class="{ 'row-invalid': rowHasError(i) }"
            >
              <td class="col-index">{{ i + 1 }}</td>
              <td>
                <input
                  v-model="row.time"
                  data-testid="time-input"
                  type="datetime-local"
                  step="60"
                  :aria-label="`第 ${i + 1} 行时间点`"
                />
                <p v-if="errors?.rowErrors[i]?.time" class="error" :data-testid="`row-${i}-time-error`">
                  {{ errors.rowErrors[i].time }}
                </p>
              </td>
              <td>
                <input
                  v-model="row.lux"
                  data-testid="lux-input"
                  type="text"
                  inputmode="decimal"
                  placeholder="0 – 5000"
                  :aria-label="`第 ${i + 1} 行照度`"
                />
                <p v-if="errors?.rowErrors[i]?.lux" class="error" :data-testid="`row-${i}-lux-error`">
                  {{ errors.rowErrors[i].lux }}
                </p>
              </td>
              <td class="col-op">
                <button
                  type="button"
                  class="link"
                  data-testid="remove-row"
                  :disabled="form.rows.length <= 2"
                  @click="removeRow(i)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <h2>停照区间（可选）</h2>
        <p class="hint">
          临时遮光或关闭展柜照明的时段将从暴露量中扣除：起止均须落在班次内、开始早于结束，
          区间不可重叠（可首尾相接）。不添加区间时，结果与未扣除完全一致。
        </p>

        <table v-if="form.blackouts && form.blackouts.length > 0" class="points">
          <thead>
            <tr>
              <th class="col-index">#</th>
              <th>停照开始（本地，精确到分钟）</th>
              <th>停照结束（本地，精确到分钟）</th>
              <th class="col-op"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(bl, i) in form.blackouts"
              :key="i"
              data-testid="blackout-row"
              :class="{ 'row-invalid': blackoutHasError(i) }"
            >
              <td class="col-index">{{ i + 1 }}</td>
              <td>
                <input
                  v-model="bl.start"
                  data-testid="blackout-start"
                  type="datetime-local"
                  step="60"
                  :aria-label="`第 ${i + 1} 个停照开始`"
                />
                <p
                  v-if="errors?.blackoutErrors[i]?.start"
                  class="error"
                  :data-testid="`blackout-${i}-start-error`"
                >
                  {{ errors.blackoutErrors[i].start }}
                </p>
                <p
                  v-if="errors?.blackoutErrors[i]?.overlap"
                  class="error"
                  :data-testid="`blackout-${i}-overlap-error`"
                >
                  {{ errors.blackoutErrors[i].overlap }}
                </p>
              </td>
              <td>
                <input
                  v-model="bl.end"
                  data-testid="blackout-end"
                  type="datetime-local"
                  step="60"
                  :aria-label="`第 ${i + 1} 个停照结束`"
                />
                <p
                  v-if="errors?.blackoutErrors[i]?.end"
                  class="error"
                  :data-testid="`blackout-${i}-end-error`"
                >
                  {{ errors.blackoutErrors[i].end }}
                </p>
              </td>
              <td class="col-op">
                <button
                  type="button"
                  class="link"
                  data-testid="remove-blackout"
                  @click="removeBlackout(i)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="actions">
          <button type="button" data-testid="add-blackout" @click="addBlackout">
            ＋ 添加停照区间
          </button>
        </div>

        <div class="actions">
          <button type="button" data-testid="add-row" @click="addRow">＋ 添加时间点</button>
          <button type="submit" class="primary" data-testid="submit">核算</button>
        </div>

        <p v-if="errors && errorCount > 0" class="banner" data-testid="error-summary" role="alert">
          本次提交存在 {{ errorCount }} 处错误，已在对应行合并标出；输入已保留，此前结论未受影响。
        </p>
      </form>
    </section>

    <ResultPanel
      v-if="result"
      :result="result"
      :name="resultName"
      v-model:cap-text="capText"
      :simulation="simulation"
      :cap-error="capError"
      :stale-notice="staleNotice"
      :cap-mismatch="capMismatch"
      :mismatch-notice="mismatchNotice"
      @simulate="simulate"
      @apply="applySimulation"
    />
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.page-header h1 {
  margin: 0 0 4px;
  font-size: 24px;
}

.subtitle {
  margin: 0 0 20px;
  color: #5c6670;
  font-size: 14px;
}

.card {
  background: #fff;
  border: 1px solid #e2e6ea;
  border-radius: 10px;
  padding: 20px 24px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 6%);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px 20px;
}

.field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
  color: #2c343b;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #c8cfd6;
  border-radius: 6px;
  font-size: 14px;
}

.field.invalid input {
  border-color: #c0392b;
  background: #fdf3f2;
}

h2 {
  font-size: 17px;
  margin: 24px 0 6px;
}

.hint {
  font-size: 13px;
  color: #5c6670;
  margin: 0 0 10px;
}

.points {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.points th,
.points td {
  border: 1px solid #e2e6ea;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.points th {
  background: #f4f6f8;
  font-weight: 600;
}

.points input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid #c8cfd6;
  border-radius: 6px;
  font-size: 14px;
}

.points tr.row-invalid td {
  background: #fdf3f2;
}

.points tr.row-invalid input {
  border-color: #c0392b;
}

.col-index {
  width: 36px;
  text-align: center;
  color: #5c6670;
}

.col-op {
  width: 64px;
  text-align: center;
}

.error {
  color: #c0392b;
  font-size: 12.5px;
  margin: 4px 0 0;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

button {
  padding: 8px 18px;
  border: 1px solid #c8cfd6;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
}

button.primary {
  background: #1f5f8b;
  border-color: #1f5f8b;
  color: #fff;
  font-weight: 600;
}

button.link {
  border: none;
  background: none;
  color: #1f5f8b;
  padding: 4px 6px;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.banner {
  margin: 16px 0 0;
  padding: 10px 14px;
  border: 1px solid #c0392b;
  border-radius: 6px;
  background: #fdf3f2;
  color: #c0392b;
  font-size: 14px;
}

.draft-card {
  border-color: #1f5f8b;
  background: #f4f8fb;
}

.draft-card.corrupt {
  border-color: #c0392b;
  background: #fdf3f2;
}

.draft-card h2 {
  margin-top: 0;
}

.draft-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px 24px;
  margin: 10px 0;
  font-size: 14px;
}

.draft-summary dt {
  font-size: 12.5px;
  color: #5c6670;
}

.draft-summary dd {
  margin: 2px 0 0;
}

.error-text {
  color: #c0392b;
  font-size: 14px;
}
</style>
