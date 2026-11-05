/* 决策层（纯函数，无 DOM 依赖）：缺货识别 / 建议量 / 硬约束 / 调拨评分 / 指标计算
 * 与 docs/04-设计方案.md 第 4 节公式一一对应 */
(function (root) {
  "use strict";

  const PARAMS = {
    冷藏: { lead: 1, review: 1, k: 1.3, cover: 2 },
    常温: { lead: 2, review: 1, k: 1.0, cover: 3 },
    冷冻: { lead: 2, review: 1, k: 1.1, cover: 2 }
  };
  const CAP_DAYS = 30;      // 补后库存上限（天）
  const MOQ_UNIT = "件";

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };
  const median = (a) => {
    if (!a.length) return 0;
    const b = a.slice().sort((x, y) => x - y);
    const i = Math.floor(b.length / 2);
    return b.length % 2 ? b[i] : (b[i - 1] + b[i]) / 2;
  };
  const roundToCase = (q, caseSize) => Math.ceil(q / caseSize) * caseSize;

  /** 需求基线：日均、波动、有效销售天数、置信度 */
  function baseline(series) {
    const last7 = series.slice(-7);
    const valid = last7.filter((v) => v > 0);
    const daily = mean(last7);
    const cv = daily > 0 ? sd(last7) / daily : 9;
    const validDays = valid.length;
    let confidence = "low";
    if (cv <= 0.5 && validDays >= 6) confidence = "high";
    else if (cv <= 0.9 && validDays >= 4) confidence = "medium";
    return { daily, cv, validDays, confidence, last7 };
  }

  /** 缺货识别：库存 ≤ 0 但有销量，或低于最小陈列量 */
  function detectShortage(data, storeId) {
    const out = [];
    data.skus.forEach((sku) => {
      const key = storeId + "|" + sku.id;
      const inv = data.inv[key];
      const series = data.sales[key] || [];
      if (!inv) return;
      const b = baseline(series);
      const sold3 = series.slice(-3).reduce((a, c) => a + c, 0);
      if (inv.onHand + inv.inTransit <= 0 && sold3 > 0) {
        out.push({ sku, inv, base: b, reason: "库存为 0 且近 3 日有销售", level: "缺货" });
      } else if (inv.onHand < sku.minDisplay) {
        out.push({ sku, inv, base: b, reason: `低于最小陈列量 ${sku.minDisplay}`, level: "低于陈列" });
      }
    });
    return out.sort((a, b2) => b2.base.daily - a.base.daily);
  }

  /** 建议量引擎 + 硬约束校验 */
  function suggest(data, storeId, skuId, ctx) {
    ctx = ctx || {};
    const sku = data.skus.find((s) => s.id === skuId);
    const key = storeId + "|" + skuId;
    const inv = data.inv[key] || { onHand: 0, inTransit: 0, shelfLeftDays: sku.shelfLifeDays };
    const series = data.sales[key] || [];
    const p = PARAMS[sku.category] || PARAMS.常温;
    const b = baseline(series);
    const checks = [];
    let ruleId = "R-SS-01";
    let daily = b.daily;

    // 新品 / 历史不足：用品类均值兜底
    if (b.validDays < 3) {
      ruleId = "R-SS-02";
      const peers = data.skus.filter((s) => s.category === sku.category && s.id !== sku.id);
      const peerDaily = peers.map((s) => baseline(data.sales[storeId + "|" + s.id] || []).daily);
      daily = mean(peerDaily) * 0.8;
      checks.push({ code: "W_SPARSE", level: "warn", msg: `近 7 日仅 ${b.validDays} 天有销售，改用同品类均值 ${daily.toFixed(1)} 兜底` });
    }
    if (data.newSku && data.newSku[sku.id]) {
      ruleId = "R-SS-02";
      checks.push({ code: "W_NEW", level: "warn", msg: "新品，历史不足 14 天，建议量需人工确认" });
    }

    const ss = daily * (p.lead + p.review) * p.k;
    const target = ss + daily * p.cover;
    const raw = target - inv.onHand - inv.inTransit;
    let qty = raw > 0 ? roundToCase(raw, sku.caseSize) : 0;
    if (qty > 0 && qty < sku.moq) qty = sku.moq;

    // 硬约束 1：效期
    if (inv.shelfLeftDays < p.lead + 7) {
      checks.push({ code: "E_SHELF_LIFE", level: "block", msg: `剩余保质期 ${inv.shelfLeftDays} 天 < 提前期+7 天，禁止补货，建议调拨出` });
      qty = 0;
    }
    // 硬约束 2：库存上限
    const cap = daily * CAP_DAYS;
    if (qty > 0 && inv.onHand + qty > cap) {
      const capped = Math.max(0, Math.floor((cap - inv.onHand) / sku.caseSize) * sku.caseSize);
      if (capped !== qty) {
        checks.push({ code: "W_STOCK_CAP", level: "warn", msg: `补后库存超过 ${CAP_DAYS} 天周转上限，已由 ${qty} 截断至 ${capped}` });
        qty = capped;
      }
    }
    // 硬约束 3：重复请求
    if (ctx.hasPending) {
      checks.push({ code: "E_DUPLICATE", level: "block", msg: "同店同 SKU 24 小时内已有待处理单据，禁止重复生成" });
      qty = 0;
    }
    // 硬约束 4：快照新鲜度
    if (ctx.stale) {
      checks.push({ code: "E_STALE", level: "block", msg: "数据快照超过 36 小时，已阻断自动建议，退回手工模式" });
      qty = 0;
    }

    let confidence = b.confidence;
    if (checks.some((c) => c.code === "W_SPARSE" || c.code === "W_NEW")) confidence = "low";

    return {
      storeId, skuId, sku, ruleId, daily, cv: b.cv, validDays: b.validDays,
      safety: ss, target, onHand: inv.onHand, inTransit: inv.inTransit,
      qty, raw, confidence, checks,
      blocked: checks.some((c) => c.level === "block")
    };
  }

  /** 跨店调拨评分（5 因子加权） */
  function rankTransfers(data, toStoreId, skuId, needQty) {
    const sku = data.skus.find((s) => s.id === skuId);
    const p = PARAMS[sku.category] || PARAMS.常温;
    const toStore = data.stores.find((s) => s.id === toStoreId);
    const rows = [];
    data.stores.forEach((st) => {
      if (st.id === toStoreId) return;
      const key = st.id + "|" + skuId;
      const inv = data.inv[key];
      if (!inv) return;
      const b = baseline(data.sales[key] || []);
      const keep = b.daily * (p.lead + p.cover);
      const spare = inv.onHand - keep;
      if (spare < sku.caseSize) return;
      const avail = Math.floor(spare / sku.caseSize) * sku.caseSize;
      const surplus = Math.min(1, spare / Math.max(needQty, sku.caseSize));
      const expiry = 1 - Math.min(1, inv.shelfLeftDays / 30);
      const dist = 1 - Math.min(1, st.distanceKm / 120);
      const same = st.city === toStore.city ? 1 : 0;
      const load = 1 - Math.min(1, needQty / (sku.caseSize * 10));
      const score = 0.35 * surplus + 0.25 * expiry + 0.2 * dist + 0.1 * same + 0.1 * load;
      rows.push({
        storeId: st.id, storeName: st.name, city: st.city, distanceKm: st.distanceKm,
        avail, shelfLeftDays: inv.shelfLeftDays, score,
        parts: { surplus, expiry, dist, same, load }
      });
    });
    return rows.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  /** 五项过程指标（与 docs/01-业务挖掘.md 第 2 节口径一致） */
  function kpi(orders) {
    const withIssue = orders.filter((o) => o.issuedAt);
    const mins = withIssue.map((o) => (o.issuedAt - o.createdAt) / 60000).filter((v) => v >= 0);
    const revisions = orders.reduce((s, o) => s + (o.revisions || 0), 0);
    const received = orders.filter((o) => o.received != null);
    const mismatch = received.filter((o) => o.received !== o.final).length;
    const adopted = orders.filter((o) => o.final != null);

    return {
      orderCount: orders.length,
      handleMin: Math.round(median(mins)),
      reworkPerOrder: orders.length ? +(revisions / orders.length).toFixed(2) : 0,
      versionAccuracy: received.length ? +((1 - mismatch / received.length) * 100).toFixed(1) : null,
      adoptRate: adopted.length ? +(adopted.filter((o) => o.final === o.suggested).length / adopted.length * 100).toFixed(1) : null,
      reviewCost: Math.round(orders.length * 12 * (70 / 60)),
      discrepancy: mismatch,
      receivedCount: received.length
    };
  }

  root.RC_ENGINE = {
    PARAMS, CAP_DAYS, MOQ_UNIT,
    mean, sd, median, roundToCase, baseline,
    detectShortage, suggest, rankTransfers, kpi
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
