<script setup lang="ts">
import { computed } from 'vue';
import { fmt2, fmtDateTime, type ExposureResult } from '../lib/exposure';

const props = defineProps<{
  result: ExposureResult;
  name: string;
}>();

const verdictText = computed(() => (props.result.pass ? '合格' : '超限'));
const diffLabel = computed(() => (props.result.pass ? '剩余额' : '超出量'));
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
</style>
