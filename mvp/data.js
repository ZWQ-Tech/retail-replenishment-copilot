/* 数据层：确定性生成的合成数据（同一浏览器刷新结果一致）
 * 真实项目中此文件由 POS / WMS / 商品主数据接口的日快照替代 */
(function (root) {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rnd = mulberry32(20261029);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + rnd() * (b - a);

  // ---- 商品主数据（18 个 SKU，覆盖常温 / 冷藏 / 冷冻）----
  const SKU_SEED = [
    ["S001", "低温鲜牛奶 950ml", "冷藏", 6, 6, 21, 6, 18.5, 1.35],
    ["S002", "原味酸奶 100g*4", "冷藏", 4, 4, 21, 4, 12.9, 1.1],
    ["S003", "三角饭团 金枪鱼", "冷藏", 8, 8, 2, 12, 6.5, 1.8],
    ["S004", "三明治 火腿芝士", "冷藏", 6, 6, 3, 8, 9.9, 1.25],
    ["S005", "鲜肉包 2只装", "冷藏", 6, 6, 5, 8, 7.5, 1.05],
    ["S006", "冰美式 500ml", "冷藏", 6, 6, 30, 6, 8.0, 1.6],
    ["S007", "苏打水 480ml", "常温", 12, 12, 270, 12, 3.5, 1.4],
    ["S008", "可乐 500ml", "常温", 12, 12, 270, 12, 3.8, 1.7],
    ["S009", "无糖气泡水 480ml", "常温", 12, 12, 270, 9, 4.2, 1.15],
    ["S010", "薯片 原味 70g", "常温", 10, 10, 180, 8, 6.9, 1.0],
    ["S011", "巧克力棒 35g", "常温", 12, 12, 240, 10, 5.5, 0.85],
    ["S012", "泡面 红烧牛肉", "常温", 12, 12, 180, 6, 4.5, 0.95],
    ["S013", "湿巾 10 抽", "常温", 10, 10, 720, 5, 7.9, 0.6],
    ["S014", "关东煮 鱼丸", "冷藏", 6, 6, 4, 10, 3.0, 0.9],
    ["S015", "冷冻水饺 300g", "冷冻", 6, 6, 180, 4, 15.9, 0.7],
    ["S016", "冰淇淋 香草 90ml", "冷冻", 8, 8, 300, 6, 9.9, 0.8],
    ["S017", "口香糖 粒装", "常温", 20, 20, 365, 15, 2.5, 0.75],
    ["S018", "鲜鸡蛋 10 枚", "冷藏", 6, 6, 30, 4, 13.9, 1.05]
  ];

  const SKUS = SKU_SEED.map((s) => ({
    id: s[0], name: s[1], category: s[2], moq: s[3], caseSize: s[4],
    shelfLifeDays: s[5], minDisplay: s[6], price: s[7], pop: s[8]
  }));

  // ---- 门店（48 家，华东三城）----
  const CITY = [["上海", 24], ["苏州", 14], ["杭州", 10]];
  const STORES = [];
  let si = 0;
  CITY.forEach(([city, n]) => {
    for (let i = 0; i < n; i++) {
      si++;
      const no = String(i + 1).padStart(2, "0");
      STORES.push({
        id: "ST" + String(si).padStart(3, "0"),
        name: city + "·" + (i % 3 === 0 ? "社区" : i % 3 === 1 ? "商圈" : "园区") + no + "店",
        city: city,
        format: i % 3 === 0 ? "社区店" : i % 3 === 1 ? "商圈店" : "园区店",
        distanceKm: Math.round(between(8, 120)),
        factor: between(0.75, 1.35)
      });
    }
  });

  // ---- 促销标记：2 个 SKU 做活动，2 个为新品 ----
  const PROMO = { S003: 1.9, S006: 1.6 };
  const NEW_SKU = { S014: true, S015: true };

  const DAYS = 14;
  function dateStr(offset) {
    const d = new Date(Date.UTC(2026, 9, 29));
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }
  const DATES = [];
  for (let i = DAYS - 1; i >= 0; i--) DATES.push(dateStr(i));

  // ---- 日销（SKU-店-日）----
  const SALES = {};
  STORES.forEach((st) => {
    SKUS.forEach((sku) => {
      const base = sku.pop * st.factor * between(3.2, 5.6);
      const promo = PROMO[sku.id] || 1;
      const series = [];
      for (let d = 0; d < DAYS; d++) {
        const date = DATES[d];
        const wd = new Date(date + "T00:00:00Z").getUTCDay();
        const wf = wd === 0 || wd === 6 ? 1.28 : wd === 1 ? 0.9 : 1.0;
        let q = base * wf * promo * (0.72 + rnd() * 0.56);
        if (NEW_SKU[sku.id] && d < 6) q = q * 0.25; // 新品：前 6 天几乎没有历史
        series.push(Math.max(0, Math.round(q)));
      }
      SALES[st.id + "|" + sku.id] = series;
    });
  });

  // ---- 库存与在途（故意制造「一边缺货一边积压」）----
  const INV = {};
  const 缺货组 = new Set();
  const 积压组 = new Set();
  const 临期组 = new Set();
  // 3 家试点门店：制造较多缺货，便于演示完整闭环
  const 试点 = STORES.slice(0, 3);
  试点.forEach((st, i) => {
    ["S001", "S002", "S003", "S004", "S006", "S014"].forEach((id, j) => {
      if ((i + j) % 2 === 0 || j < 3) 缺货组.add(st.id + "|" + id);
    });
  });
  STORES.slice(3, 22).forEach((st, i) => {
    缺货组.add(st.id + "|" + SKUS[i % 6].id);
    缺货组.add(st.id + "|" + SKUS[(i + 3) % 6].id);
  });
  STORES.slice(6, 14).forEach((st, i) => {
    积压组.add(st.id + "|" + SKUS[2 + (i % 3)].id);
  });
  // 唯一的效期拦截样例：ST001 的三明治即将过期
  临期组.add("ST001|S004");
  缺货组.add("ST001|S004");
  缺货组.add("ST001|S014");   // 新品：用于演示低置信 + W_NEW

  STORES.forEach((st) => {
    SKUS.forEach((sku) => {
      const key = st.id + "|" + sku.id;
      const avg = SALES[key].slice(-7).reduce((a, b) => a + b, 0) / 7;
      let onHand;
      if (缺货组.has(key)) onHand = rnd() < 0.5 ? 0 : Math.max(0, Math.floor(avg * 0.6));
      else if (积压组.has(key)) onHand = Math.ceil(avg * between(24, 34));
      else onHand = Math.ceil(avg * between(4, 11));
      let shelfLeft = sku.shelfLifeDays <= 5 ? Math.floor(between(1, 5))
        : Math.floor(between(6, sku.shelfLifeDays));
      if (缺货组.has(key) && !临期组.has(key)) shelfLeft = Math.max(shelfLeft, 10);
      if (临期组.has(key)) shelfLeft = 2;
      INV[key] = {
        onHand: onHand,
        inTransit: rnd() < 0.18 ? sku.caseSize * Math.ceil(between(1, 3)) : 0,
        shelfLeftDays: shelfLeft,
        locked: 0
      };
    });
  });

  // ---- DC 库存（部分品项不足，用于触发调拨建议）----
  const DC = {};
  SKUS.forEach((sku) => { DC[sku.id] = Math.floor(between(40, 900)); });
  ["S001", "S003", "S014"].forEach((id) => { DC[id] = Math.floor(between(0, 12)); });

  root.RC_DATA = {
    snapshotId: "v20261029-0630",
    snapshotAt: "2026-10-29 06:30",
    stores: STORES,
    skus: SKUS,
    sales: SALES,
    inv: INV,
    dc: DC,
    dates: DATES,
    promo: PROMO,
    newSku: NEW_SKU
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
