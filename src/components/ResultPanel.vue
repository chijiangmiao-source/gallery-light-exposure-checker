<script setup lang="ts">
import { computed, ref } from 'vue';
import { fmt2, fmtDateTime, type CapSimulation, type ExposureResult } from '../lib/exposure';

const props = defineProps<{
  result: ExposureResult;
  name: string;
  simulation: CapSimulation | null;
  capError: string | null;
}>();

const emit = defineEmits<{
  simulate: [cap: string];
  apply: [];
}>();

const capInput = ref('');

const verdictText = computed(() => (props.result.pass ? '合格' : '超限'));
const diffLabel = computed(() => (props.result.pass ? '剩余额' : '超出量'));
const simVerdictText = computed(() => (props.simulation?.result.pass ? '合格' : '超限'));

function onSimulate(): void {
  emit('simulate', capInput.value);
}

function onApply(): void {
  capInput.value = '';
  emit('apply');
}
</script>

<template>
  <section class="card result" data-testid="result">
    <h2>
      核算结果
      <span v-if="name" class="result-name">· {{ name }}</span>
    </h2>

    <div class="verdict-row">
      <span class="verdict" :class="result.pass ? 'pass' : 'fail'" data-testid="verdict">
        {{ verdictText }}
      </span>
      <dl class="figures">
        <div>
          <dt>总量</dt>
          <dd><strong data-testid="total">{{ fmt2(result.total) }}</strong> lx·h</dd>
        </div>
        <div>
          <dt>限额</dt>
          <dd><strong data-testid="limit-value">{{ fmt2(result.limit) }}</strong> lx·h</dd>
        </div>
        <div>
          <dt data-testid="diff-label">{{ diffLabel }}</dt>
          <dd><strong data-testid="diff">{{ fmt2(result.diff) }}</strong> lx·h</dd>
        </div>
      </dl>
    </div>

    <h3>逐段算式</h3>
    <table class="segments">
      <thead>
        <tr>
          <th>区间（本地时间）</th>
          <th>算式 (前值＋后值) ÷ 2 × 分钟差 ÷ 60</th>
          <th>段暴露量</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="seg in result.segments" :key="seg.index" data-testid="segment">
          <td class="nowrap">{{ fmtDateTime(seg.start) }} → {{ fmtDateTime(seg.end) }}</td>
          <td class="formula">
            ({{ seg.startLuxText }} + {{ seg.endLuxText }}) ÷ 2 × {{ seg.minutes.toString() }} min ÷ 60
          </td>
          <td class="nowrap">{{ fmt2(seg.exposure) }} lx·h</td>
        </tr>
      </tbody>
    </table>

    <p class="note">
      说明：各段显示值与总量均四舍五入到 0.01 lx·h；总量先累加未舍入段值再舍入，
      故逐段显示值之和可能与总量存在尾差。判定以未舍入的精确总量为准：精确总量 ≤ 限额为合格，
      否则超限——总量显示值与限额相等而精确值略高时仍判超限（此时超出量按规则可能显示为 0.00）。
    </p>

    <div class="simulator">
      <h3>模拟照度上限</h3>
      <p class="hint">
        评估统一调低现场照度后展品能否合格：每个时间点照度取原值与上限的较小值，
        复用同一十进制梯形积分与精确判定，不改变表格与上方正式结论。
      </p>
      <div class="sim-controls" :class="{ invalid: Boolean(capError) }">
        <input
          v-model="capInput"
          data-testid="cap-input"
          type="text"
          inputmode="decimal"
          placeholder="0 – 5000 lx，最多两位小数"
          aria-label="模拟照度上限"
        />
        <button type="button" data-testid="simulate" @click="onSimulate">模拟</button>
      </div>
      <p v-if="capError" class="error" data-testid="cap-error">{{ capError }}</p>

      <div v-if="simulation" class="sim-result" data-testid="simulation">
        <h4>模拟结果（上限 {{ simulation.cap.toString() }} lx）</h4>
        <div class="verdict-row">
          <span
            class="verdict small"
            :class="simulation.result.pass ? 'pass' : 'fail'"
            data-testid="sim-verdict"
          >
            {{ simVerdictText }}
          </span>
          <dl class="figures">
            <div>
              <dt>预计总量</dt>
              <dd><strong data-testid="sim-total">{{ fmt2(simulation.result.total) }}</strong> lx·h</dd>
            </div>
            <div>
              <dt>减少量</dt>
              <dd>
                <strong data-testid="sim-reduction">{{ fmt2(simulation.reduction) }}</strong> lx·h
              </dd>
            </div>
          </dl>
        </div>

        <template v-if="simulation.cappedPoints.length > 0">
          <h4>被压低的时间点（{{ simulation.cappedPoints.length }}）</h4>
          <ul class="capped-list">
            <li v-for="p in simulation.cappedPoints" :key="p.index" data-testid="capped-point">
              {{ fmtDateTime(p.time) }}：{{ p.originalLuxText }} → {{ p.cappedLuxText }} lx
            </li>
          </ul>
        </template>
        <p v-else class="hint" data-testid="no-capped">上限不低于任何时间点照度，无时间点被压低。</p>

        <button type="button" class="primary" data-testid="apply-simulation" @click="onApply">
          应用到表格
        </button>
        <p class="hint">应用后模拟照度写回当前各行并清除模拟结果，请再次点击「核算」生成正式结论。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.result h2 {
  font-size: 17px;
  margin: 0 0 14px;
}

.result-name {
  color: #5c6670;
  font-weight: 400;
  font-size: 14px;
  margin-left: 6px;
}

.verdict-row {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.verdict {
  display: inline-block;
  padding: 8px 22px;
  border-radius: 8px;
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.verdict.pass {
  background: #1e8e5a;
}

.verdict.fail {
  background: #c0392b;
}

.figures {
  display: flex;
  gap: 28px;
  margin: 0;
  flex-wrap: wrap;
}

.figures dt {
  font-size: 12.5px;
  color: #5c6670;
  margin-bottom: 2px;
}

.figures dd {
  margin: 0;
  font-size: 16px;
}

h3 {
  font-size: 15px;
  margin: 0 0 8px;
}

.segments {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.segments th,
.segments td {
  border: 1px solid #e2e6ea;
  padding: 7px 10px;
  text-align: left;
}

.segments th {
  background: #f4f6f8;
}

.nowrap {
  white-space: nowrap;
}

.formula {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
}

.note {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: #5c6670;
}

.simulator {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px dashed #d5dbe1;
}

.simulator h3 {
  font-size: 15px;
  margin: 0 0 6px;
}

.simulator h4 {
  font-size: 14px;
  margin: 14px 0 8px;
}

.hint {
  font-size: 12.5px;
  color: #5c6670;
  margin: 0 0 8px;
}

.sim-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: 420px;
}

.sim-controls input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #c8cfd6;
  border-radius: 6px;
  font-size: 14px;
}

.sim-controls.invalid input {
  border-color: #c0392b;
  background: #fdf3f2;
}

.sim-controls button {
  padding: 8px 18px;
  border: 1px solid #c8cfd6;
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.error {
  color: #c0392b;
  font-size: 12.5px;
  margin: 4px 0 0;
}

.sim-result {
  margin-top: 14px;
  padding: 14px 16px;
  border: 1px solid #e2e6ea;
  border-radius: 8px;
  background: #f8fafb;
}

.sim-result .verdict-row {
  margin-bottom: 4px;
}

.verdict.small {
  padding: 6px 16px;
  font-size: 16px;
}

.capped-list {
  margin: 0 0 4px;
  padding-left: 20px;
  font-size: 13.5px;
}

.sim-result button.primary {
  margin-top: 10px;
  padding: 8px 18px;
  border: 1px solid #1f5f8b;
  border-radius: 6px;
  background: #1f5f8b;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.sim-result button.primary + .hint {
  margin-top: 8px;
  margin-bottom: 0;
}
</style>
