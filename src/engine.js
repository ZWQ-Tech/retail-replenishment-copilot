/* 决策层（纯函数，无 DOM 依赖）：缺货识别 / 建议量 / 硬约束 / 调拨评分 / 延迟归因 / 指标计算
 * 口径对齐 docs/01-业务挖掘.md 的 34 条事实与 docs/04-设计方案.md
 *
 * 关键变化（相对旧版）：
 *  - 缺货识别基于「可售 sellable」而非「账面 onHand」（retail-f10/f12）
 *  - 区分缺货截断：销量为零但缺货截断标记存在 → 不是没人买（retail-f31）
 *  - 建议量内置整箱/起订量/线路容量约束（retail-f20/f50）
 *  - 促销版本随建议传递（retail-f11/f21）
 *  - 配送排队归因：30% 延迟源于排队而非预测（retail-f51）
 *  - 兜底触发（retail-f44）与审计可重建（retail-f45）
 */
(function (root) {
  "use strict";

  const CAP_DAYS = 30;      // 补后库存上限（天）
  const MOQ_UNIT = "件";
  const STALE_HOURS = 36;   // 快照新鲜度上限

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

  /** 需求基线：日均、波动、有效销售天数、置信度、缺货截断提示 */
  function baseline(data, storeId, skuId) {
    const series = data.sales[storeId + "|" + skuId] || [];
    const last7 = series.slice(-7);
    const valid = last7.filter((v) => v > 0);
    const daily = mean(last7);
    const cv = daily > 0 ? sd(last7) / daily : 9;
    const validDays = valid.length;
    let confidence = "low";
    if (cv <= 0.5 && validDays >= 6) confidence = "high";
    else if (cv <= 0.9 && validDays >= 4) confidence = "medium";
    const stockoutDays = data.stockout ? (data.stockout[storeId + "|" + skuId] || 0) : 0;
    return { daily, cv, validDays, confidence, last7, stockoutDays };
  }

  /** 缺货识别：基于「可售」而非「账面」（retail-f10/f12/f31） */
  function detectShortage(data, storeId) {
    const out = [];
    data.skus.forEach((sku) => {
      const key = storeId + "|" + sku.id;
      const inv = data.inv[key];
      if (!inv) return;
      const b = baseline(data, storeId, sku.id);
      const sold3 = b.last7.slice(-3).reduce((a, c) => a + c, 0);

      // 1) 账面有货但可售为 0 → 「有货≠可售」核心场景
      if (inv.onHand > 0 && inv.sellable <= 0) {
        out.push({ sku, inv, base: b, reason: "账面有货但可售为 0（货在后仓未上架）", level: "不可售", code: "有货不可售" });
        return;
      }
      // 2) 可售为 0 且近 3 日有销售 → 缺货
      if (inv.sellable + inv.inTransit <= 0 && sold3 > 0) {
        out.push({ sku, inv, base: b, reason: "可售为 0 且近 3 日有销售", level: "缺货", code: "缺货" });
        return;
      }
      // 3) 低于最小陈列量
      if (inv.sellable < sku.minDisplay) {
        out.push({ sku, inv, base: b, reason: `可售低于最小陈列量 ${sku.minDisplay}`, level: "低于陈列", code: "低于陈列" });
      }
    });
    return out.sort((a, b2) => b2.base.daily - a.base.daily);
  }

  /** 建议量引擎 + 硬约束校验（整箱 / 起订量 / 线路容量 / 效期 / 上限 / 重复 / 新鲜度） */
  function suggest(data, storeId, skuId, ctx) {
    ctx = ctx || {};
    const sku = data.skus.find((s) => s.id === skuId);
    const key = storeId + "|" + skuId;
    const inv = data.inv[key] || { onHand: 0, sellable: 0, inTransit: 0, shelfLeftDays: sku.shelfLifeDays };
    const b = baseline(data, storeId, skuId);
    const promo = (data.promos || []).find((p) => p.key === key);
    const checks = [];
    let ruleId = "R-SS-01";
    let daily = b.daily;

    // 缺货截断：销量为零但存在缺货截断标记 → 提示「需求被截断，需求可能低估」
    if (b.stockoutDays > 0) {
      checks.push({ code: "W_STOCKOUT", level: "warn", msg: `近 14 日有 ${b.stockoutDays} 天疑似缺货截断，需求可能被低估` });
    }

    // 新品 / 历史不足：用品类均值兜底
    if (b.validDays < 3) {
      ruleId = "R-SS-02";
      const peers = data.skus.filter((s) => s.category === sku.category && s.id !== sku.id);
      const peerDaily = peers.map((s) => baseline(data, storeId, s.id).daily);
      daily = mean(peerDaily) * 0.8;
      checks.push({ code: "W_SPARSE", level: "warn", msg: `近 7 日仅 ${b.validDays} 天有销售，改用同品类均值 ${daily.toFixed(1)} 兜底` });
    }

    // 促销版本随建议传递（retail-f11/f21）
    if (promo) {
      ruleId = "R-SS-03";
      const syncNote = promo.synced ? "已回传" : "未回传（门店改价未同步，需求可能失真）";
      checks.push({ code: "W_PROMO", level: promo.synced ? "info" : "warn", msg: `促销「${promo.promo}」${syncNote}，建议量按促销期销量计算` });
    }

    const p = { lead: sku.leadTime || 2, review: 1, k: 1.0, cover: 3 };
    const ss = daily * (p.lead + p.review) * p.k;
    const target = ss + daily * p.cover;
    // 用「可售」而非「账面」计算缺口（retail-f10）
    const raw = target - inv.sellable - inv.inTransit;
    let qty = raw > 0 ? roundToCase(raw, sku.caseSize) : 0;
    if (qty > 0 && qty < sku.moq) qty = sku.moq;

    // 硬约束 1：效期
    if (inv.shelfLeftDays < p.lead + 7) {
      checks.push({ code: "E_SHELF_LIFE", level: "block", msg: `剩余保质期 ${inv.shelfLeftDays} 天 < 提前期+7 天，禁止补货，建议调拨出` });
      qty = 0;
    }
    // 硬约束 2：库存上限
    const cap = daily * CAP_DAYS;
    if (qty > 0 && inv.sellable + qty > cap) {
      const capped = Math.max(0, Math.floor((cap - inv.sellable) / sku.caseSize) * sku.caseSize);
      if (capped !== qty) {
        checks.push({ code: "W_STOCK_CAP", level: "warn", msg: `补后可售超过 ${CAP_DAYS} 天周转上限，已由 ${qty} 截断至 ${capped}` });
        qty = capped;
      }
    }
    // 硬约束 3：线路容量（retail-f50）
    const lineCap = data.lineCapacity ? data.lineCapacity[storeId] : null;
    if (lineCap != null && qty > lineCap) {
      checks.push({ code: "E_LINE_CAP", level: "block", msg: `建议量 ${qty} 超出本店线路容量 ${lineCap}，需拆单或人工确认` });
      qty = lineCap - (lineCap % sku.caseSize);
    }
    // 硬约束 4：重复请求
    if (ctx.hasPending) {
      checks.push({ code: "E_DUPLICATE", level: "block", msg: "同店同 SKU 24 小时内已有待处理单据，禁止重复生成" });
      qty = 0;
    }
    // 硬约束 5：快照新鲜度
    if (ctx.stale) {
      checks.push({ code: "E_STALE", level: "block", msg: `数据快照超过 ${STALE_HOURS} 小时，已阻断自动建议，退回手工模式` });
      qty = 0;
    }

    let confidence = b.confidence;
    if (checks.some((c) => c.code === "W_SPARSE" || c.code === "W_STOCKOUT")) confidence = "low";

    return {
      storeId, skuId, sku, ruleId, daily, cv: b.cv, validDays: b.validDays,
      safety: ss, target, onHand: inv.onHand, sellable: inv.sellable, gap: inv.gap,
      inTransit: inv.inTransit, stockoutDays: b.stockoutDays,
      promo: promo ? promo.promo : null, promoSynced: promo ? promo.synced : null,
      qty, raw, confidence, checks,
      blocked: checks.some((c) => c.level === "block")
    };
  }

  /** 跨店调拨评分（5 因子加权；调出后本店可售不得低于安全库存） */
  function rankTransfers(data, toStoreId, skuId, needQty) {
    const sku = data.skus.find((s) => s.id === skuId);
    const toStore = data.stores.find((s) => s.id === toStoreId);
    const rows = [];
    data.stores.forEach((st) => {
      if (st.id === toStoreId) return;
      const key = st.id + "|" + skuId;
      const inv = data.inv[key];
      if (!inv) return;
      const b = baseline(data, st.id, skuId);
      const keep = b.daily * (sku.leadTime + 3);
      const spare = inv.sellable - keep;  // 用可售算富余（口径一致）
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

  /** 配送排队归因：把延迟补货拆成「预测问题 / 配送排队 / 其它」（retail-f51） */
  function classifyDelay(orders, data) {
    const delayed = orders.filter((o) => o.delayed);
    const queue = delayed.filter((o) => o.delayCause === "配送排队");
    const forecast = delayed.filter((o) => o.delayCause === "预测偏差");
    const other = delayed.filter((o) => !o.delayCause || o.delayCause === "其它");
    const total = delayed.length || 1;
    return {
      total: delayed.length,
      queuePct: Math.round(queue.length / total * 100),
      forecastPct: Math.round(forecast.length / total * 100),
      otherPct: Math.round(other.length / total * 100),
      queueCount: queue.length, forecastCount: forecast.length, otherCount: other.length,
    };
  }

  /** 试点过程指标（口径对齐 01-业务挖掘 5.1：缺货率/周转/账实差异/报废） */
  function kpi(orders, data) {
    const baseline = data.baseline || {};
    const adopted = orders.filter((o) => o.final != null);
    const revisions = orders.reduce((s, o) => s + (o.revisions || 0), 0);
    return {
      orderCount: orders.length,
      adoptRate: adopted.length ? +(adopted.filter((o) => o.final === o.suggested).length / adopted.length * 100).toFixed(1) : null,
      reworkPerOrder: orders.length ? +(revisions / orders.length).toFixed(2) : 0,
      shortageRate: baseline.shortageRate || "12%",
      targetShortage: baseline.targetShortage || "5% 以下",
      turnoverDays: baseline.turnoverDays || 48,
      targetTurnover: baseline.targetTurnover || 35,
      stockGap: baseline.stockGap || "8%",
      delayedByQueue: baseline.delayedByQueue || "30%",
    };
  }

  /** 兜底触发判定（retail-f44）：遇临时促销/缺货截断/账实不一致/依据缺失/系统不可用 → 停止自动建议 */
  function shouldFallback(suggestion) {
    const reasons = [];
    if (!suggestion.promoSynced && suggestion.promo) reasons.push("临时促销未回传");
    if (suggestion.stockoutDays > 0) reasons.push("存在缺货截断");
    if (suggestion.gap > 0 && suggestion.onHand > 0 && suggestion.sellable === 0) reasons.push("可售与账面不一致");
    if (suggestion.validDays < 3) reasons.push("依据缺失（历史不足）");
    if (suggestion.checks.some((c) => c.code === "E_STALE")) reasons.push("系统/快照不可用");
    return reasons.length ? { fallback: true, reasons } : { fallback: false, reasons: [] };
  }

  root.RC_ENGINE = {
    CAP_DAYS, MOQ_UNIT, STALE_HOURS,
    mean, sd, median, roundToCase, baseline,
    detectShortage, suggest, rankTransfers, classifyDelay, kpi, shouldFallback
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
