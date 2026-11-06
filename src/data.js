/* 数据层：确定性生成的合成试点数据（同一浏览器刷新结果一致）
 * 口径对齐 docs/01-业务挖掘.md 的 34 条事实（retail-f00 ~ retail-f55）
 * 真实项目中此文件由 POS / WMS / 商品主数据接口的日快照替代
 *
 * 关键口径：
 *  - 试点范围：8 家门店 × 50 个常温 SKU × 6 周（retail-f02 / f05）
 *  - 账实差异：平均 8%（retail-f12）→ 用「账面 onHand」与「可售 sellable」两个字段表达
 *  - 缺货截断：销量为零可能不是没人买，而是货架空（retail-f31）→ stockout 标记
 *  - 整箱 / 起订量 / 线路容量约束（retail-f20 / f50）
 *  - 促销版本随建议传递（retail-f11 / f21）
 *  - 配送日历：周一、三、五固定配送（retail-f50）
 *  - 6 个岗位角色（顾明岚/林亦舟/唐映秋/傅景/叶书/秦芮）
 */
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

  const rnd = mulberry32(20261106);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + rnd() * (b - a);

  // ---- 岗位角色（6 个，对应访谈）----
  const ROLES = [
    { id: "R-DIR",  name: "顾明岚", title: "运营总监",     duty: "结果指标 / 范围 / 预算 / 决策", risk: "立项牵头，审批层级待核实" },
    { id: "R-SM",   name: "林亦舟", title: "门店店长",     duty: "上报 / 复核 / 现场口径",       risk: "账实差异 8%，有货≠可售" },
    { id: "R-PLN",  name: "唐映秋", title: "补货计划员",   duty: "建议量调整 / 例外分派",       risk: "整箱/起订量/线路容量约束" },
    { id: "R-LOSS", name: "傅景",   title: "商品与损耗经理", duty: "红线 / 兜底 / 审计签核",      risk: "兜底触发与日志可重建硬门槛" },
    { id: "R-LOG",  name: "叶书",   title: "区域物流经理",  duty: "仓配 / 调拨 / 到货交接",      risk: "30% 延迟是配送排队" },
    { id: "R-DATA", name: "秦芮",   title: "数据工程师",    duty: "口径 / 快照 / 接口",         risk: "缺货截断、新旧码套装码" },
  ];

  // ---- 访谈记录（6 场，与 docs/访谈记录/ 同源）----
  const INTERVIEWS = {
    "R-DIR": {
      ivId: "IV-00", duration: "40 分钟", time: "2026-11-06 10:16", place: "总部 · 运营总监办公室",
      evidence: "retail-f00 / f01 / f02 / f03 / f04 / f05",
      background: "作为业务决策者（Buyer），顾明岚定了试点方向与范围。访谈围绕目标、预算、决策结构与首期范围展开。",
      qa: [
        ["这次最希望达成的业务目标是什么？", "爆款缺货率 12%、库存周转 48 天，目标分别压到 5% 以下和 35 天。这两个指标是我判断试点成败的硬口径。缺货和积压同时存在，说明问题可能不在预测精度，而在可售库存与货架巡检这一环。"],
        ["试点预算是多少，成本怎样核算？", "预算 16 万元，接口、培训、复核、维护四项成本都要从里面扣，既有系统采购不能算进节省额。16 万是上限不是目标，如果接口成本吃掉大头，我会压缩试点门店数而不是砍复核环节。"],
        ["谁参与决策，谁可以否决方案？", "业务立项由我牵头，商品与损耗经理有风险否决权，区域物流经理参与交接结果验收。"],
        ["首期优先做什么，试点覆盖哪里？", "首期定在可售库存与货架巡检这一环，范围按 8 家门店、50 个常温 SKU 来，先做历史回放，再并行试点，现有人工流程不能直接关掉。验收口径跑 6 周，缺货减少不能靠全面增库存换出来。"],
        ["请讲讲现在实际的处理流程。", "店长报数 → 总部汇总 → 仓库分配 → 配送，门店看不到分配依据。这条链路的问题不在报数本身，而在门店端拿不到分配依据，报多报少都靠经验。"],
      ],
      conclusion: ["结果指标（缺货率 5% 以下、周转 35 天）是硬口径，不是方向性描述。", "16 万是预算上限，接口/培训/复核/维护四项成本必须分列，复核不能砍。", "试点 8 店 50 SKU、6 周，先历史回放再并行试点，现有人工流程不直接关掉。"],
    },
    "R-SM": {
      ivId: "IV-01", duration: "42 分钟", time: "2026-11-06 10:52", place: "上海徐汇店 · 门店",
      evidence: "retail-f10 / f11 / f12 / f13 / f14 / f15",
      background: "作为一线使用者（Operator），林亦舟反映了最核心的现场口径问题——「有货≠可售」。",
      qa: [
        ["你日常有哪些痛点，最费时间的环节是什么？", "最费时间的是「有货但不可售」的核对。货已经在后仓但货架没补，系统仍算有库存，消费者看到的却是空货架。我每天盘点 20 个重点 SKU，账实差异平均 8%，得先分清有货和可售。"],
        ["辅助结果怎么复核，发现错误怎么办？", "每条辅助结果必须能点回原记录，不能只给一个结论让我猜依据。涉及临时促销、缺货截断，或者可售库存和账面库存对不上的，先由补货计划员核对，没确认之前不能覆盖原记录。"],
        ["现场操作有什么限制，设备和网络情况怎样？", "在 8 家门店、50 个常温 SKU 的现场用现有终端操作，不换设备、不新增入口。一线最怕的是为了办一件事反复登录多个系统，所以待补信息和最后同步时间必须留在同一个界面里能看到。"],
        ["能给我一个具体的异常或失败例子吗？", "最典型的是促销临时变价。某个常温 SKU 原计划周末做促销，系统按原价和历史销量算出来的预测，在临时改价后就失效了；再加上节假日客流和平日差别很大，建议量会明显偏离现场。"],
      ],
      conclusion: ["账实差异平均 8%，必须先分清「有货」和「可售」（retail-f10/f12）。", "促销临时变价使预测失效，节假日客流差别大（retail-f11）。", "待补信息和最后同步时间必须留在同一界面，不能要求一线重复登录多个系统（retail-f13）。"],
    },
    "R-PLN": {
      ivId: "IV-02", duration: "55 分钟", time: "2026-11-06 10:54", place: "总部 · 补货中心",
      evidence: "retail-f20 / f21 / f22 / f23 / f24 / f25",
      background: "补货计划员是建议量引擎的直接使用者，最关心整箱、起订量、线路容量等约束。",
      qa: [
        ["请讲讲现在实际的处理流程。", "先看门店的缺货和积压情况，形成补货建议量，但补货不是预测多少就发多少，要受最小起订量、整箱规格和仓库分配上限约束。建议量我可以调，但跨店调拨要区域经理批准，自动采购不能直接上线。"],
        ["交接时需要什么，责任从何时转移？", "交接材料要带齐四类：销售库存、促销版本、整箱规格与配送日历，以及当前版本和未解决事项。责任转移的节点是接手人明确确认，不是我把消息发出去就算完。"],
        ["业务规则如何维护，冲突如何处理？", "规则由业务负责人维护，保存生效日期与适用范围；遇到临时促销、缺货截断，或可售库存与账面库存不一致产生的争议，要记录使用版本并由商品与损耗经理确认。促销日历由运营维护，门店改价不总是回传。"],
        ["出现问题谁负责，怎么分派和升级？", "异常转出去时必须写明处理人、截止时间和退回原因，不能只把状态改成「已转交」就算完。超时的我交给运营总监协调。"],
      ],
      conclusion: ["补货有最小起订量、整箱规格和仓库分配上限（retail-f20）。", "跨店调拨需区域经理批准，自动采购不能直接上线（retail-f22）。", "交接需带销售库存/促销版本/整箱规格/配送日历，接手人确认后责任才转移（retail-f23）。"],
    },
    "R-LOSS": {
      ivId: "IV-03", duration: "46 分钟", time: "2026-11-06 11:55", place: "总部 · 商品与损耗办公室",
      evidence: "retail-f42 / f43 / f44 / f45",
      background: "商品与损耗经理有风险否决权，是兜底与审计的硬门槛把关人。",
      qa: [
        ["有哪些安全、合规或业务红线？", "红线分三类。第一类是兜底触发：临时促销、缺货截断、可售库存与账面库存不一致、依据缺失或关键系统不可用时，必须停止自动建议，并标明原因、接手人和人工确认时间。第二类是审计可重建：审核日志要保留版本、建议内容、人工修正和签核人，能还原当次处理，但不记录口令和非必要个人信息。第三类是权限边界：自动补货建议不能绕过人工签核直接下单。"],
        ["怎么验收成功？试点标准是什么？", "验收我只认可核验的口径，不认「感觉变好了」。验收要同时看缺货、周转、报废三项，促销期间单列误差，不能混在整体均值里掩盖问题。"],
        ["哪些操作必须人工审批，谁有权限？", "兜底触发后的恢复动作必须有人工确认，不能系统自恢复。谁签、签几级取决于审批制度，需要顾明岚定决策口径。我建议把审批动作和签核人一并写入审核日志。"],
        ["记录保留多久，删除和留存如何处理？", "本轮合成试点评价记录暂留 90 天，到期由我确认删除或归档。如果日志留存期短于试点观察周期，验收时就没法回溯兜底触发和人工修正，我会拒绝签核。"],
      ],
      conclusion: ["兜底触发：临时促销/缺货截断/账实不一致/依据缺失/系统不可用 → 停止自动建议并标明原因、接手人、人工确认时间（retail-f44）。", "审计可重建：日志保留版本、建议内容、人工修正、签核人（retail-f45）。", "验收看缺货、周转、报废三项，促销期单列误差（retail-f42）。"],
    },
    "R-LOG": {
      ivId: "IV-04", duration: "38 分钟", time: "2026-11-06 12:56", place: "总部 · 物流办公室",
      evidence: "retail-f50 / f51 / f52 / f53 / f54 / f55",
      background: "区域物流经理负责仓配与交接验收，最关心配送排队与线路容量。",
      qa: [
        ["有多少单、花多久，有统计样本吗？", "约 30% 的延迟补货是配送排队造成的，不是预测问题，建议先核查仓库截单时间。如果你们要统计单量和耗时，建议按门店、按配送批次分别记录，不能用消息发送量代替实际完成量。"],
        ["本次范围是什么，哪些事情不能自动做？", "门店要能看到预计到货和本次未满足数量，这是我能承诺的交付口径。供应商合同不在本次改动范围内。补货建议必须符合线路容量，仓库周一、三、五固定配送，小门店仓容有限，超出容量的建议不能直接下发。"],
        ["试点反馈怎么收集，怎样形成改进闭环？", "下游反馈必须关联原业务编号和当时的资料版本，由我受理，补货计划员核实，未确认前不承诺赔偿或结果。每周复盘覆盖 8 家门店、50 个常温 SKU 的误判和未解决问题，由运营总监指定改进负责人。"],
      ],
      conclusion: ["约 30% 延迟补货是配送排队（retail-f51）。", "仓库周一三五固定配送，小门店仓容有限，补货建议须符合线路容量（retail-f50）。", "门店需看到预计到货与本次未满足数量（retail-f52）。"],
    },
    "R-DATA": {
      ivId: "IV-05", duration: "40 分钟", time: "2026-11-06 12:54", place: "总部 · 数据组",
      evidence: "retail-f30 / f31 / f32 / f33 / f34 / f35",
      background: "数据工程师负责口径、快照与接口，最关心缺货截断与新旧码/套装码治理。",
      qa: [
        ["目前用了哪些系统和工具？", "POS 销售按日汇总，WMS 出库是实时的；商品编码存在新旧码和套装码并存的情况。现阶段是先导出历史销售和库存 CSV，供应商下单接口还没有审批。"],
        ["系统故障或接口中断时怎么办？", "接口失败时继续走原人工流程，保留只读快照与时间戳；恢复后按业务编号去重补齐，不能重复创建同一待办。"],
        ["怎样判断数据质量，发现脏数据怎么处理？", "主编号、事件时间、来源和版本四项是硬门槛。脏数据里有一类特别容易误判：销量为零不等于没人买，可能是缺货截断，模型必须把这两种情况分开。"],
        ["数据多久更新，过期信息如何识别？", "试点数据按每天两次刷新，原文按版本同步。超过一个周期的结果要标注待刷新，历史快照不能伪装成当前状态。"],
      ],
      conclusion: ["销量为零可能是缺货截断，模型必须区分（retail-f31）。", "商品编码存在新旧码和套装码（retail-f30）。", "数据每天刷新两次，超周期标注待刷新，历史快照不能伪装成当前状态（retail-f34）。"],
    },
  };

  // ---- 商品主数据（50 个常温 SKU；字段含整箱、起订量、保质期、最小陈列量）----
  const CATEGORIES = [
    ["饮料", 10, 270, ["矿泉水 550ml", "可乐 500ml", "无糖气泡水 480ml", "果汁 300ml", "茶饮 500ml", "功能饮料 500ml", "苏打水 480ml", "乳酸菌 340ml", "咖啡 500ml", "酸梅汤 500ml"]],
    ["休闲零食", 10, 180, ["薯片 原味 70g", "薯片 黄瓜味 70g", "锅巴 80g", "虾条 60g", "海苔 24g", "瓜子 150g", "花生米 120g", "坚果 25g", "饼干 100g", "威化 60g"]],
    ["方便食品", 8, 180, ["泡面 红烧牛肉", "泡面 香辣牛肉", "拌面 葱油", "自热米饭", "酸辣粉", "八宝粥", "速食粥 燕麦", "卤蛋 2 枚"]],
    ["糖果巧克力", 10, 240, ["巧克力棒 35g", "牛奶巧克力 45g", "夹心糖 50g", "口香糖 粒装", "薄荷糖 30g", "棒棒糖 装", "棉花糖 40g", "黑巧克力 45g"]],
    ["粮油调味", 6, 365, ["挂面 500g", "方便面 整箱", "食用油 400ml", "酱油 500ml", "醋 500ml", "盐 400g"]],
    ["日用品", 8, 720, ["纸巾 10 抽", "湿巾 10 抽", "洗手液 250ml", "洗衣液 500g", "洗洁精 500g", "牙膏 120g", "牙刷 单支", "垃圾袋 50 只"]],
  ];

  const SKUS = [];
  let sid = 0;
  CATEGORIES.forEach(([cat, moqBase, shelfLife, names]) => {
    names.forEach((name) => {
      sid++;
      const id = "S" + String(sid).padStart(3, "0");
      const caseSize = moqBase;
      const price = Math.round(between(3, 28) * 10) / 10;
      const pop = Math.round(between(0.5, 2.2) * 100) / 100; // 销量强度系数
      SKUS.push({
        id: id, name: cat + "·" + name, category: cat,
        moq: caseSize,            // 最小起订量（整箱，件）
        caseSize: caseSize,       // 整箱规格
        shelfLifeDays: shelfLife, // 保质期（天）
        minDisplay: Math.max(4, Math.round(caseSize * 0.6)), // 最小陈列量
        price: price,
        pop: pop,
        leadTime: 2,              // 提前期（天）
      });
    });
  });

  // ---- 门店（8 家试点，上海）----
  const STORE_SEED = [
    ["ST001", "上海·徐汇社区店", "社区店", 12],
    ["ST002", "上海·静安商圈店", "商圈店", 18],
    ["ST003", "上海·浦东园区店", "园区店", 25],
    ["ST004", "上海·闵行社区店", "社区店", 22],
    ["ST005", "上海·杨浦商圈店", "商圈店", 16],
    ["ST006", "上海·长宁社区店", "社区店", 14],
    ["ST007", "上海·虹口园区店", "园区店", 20],
    ["ST008", "上海·普陀社区店", "社区店", 15],
  ];
  const STORES = STORE_SEED.map((s) => ({
    id: s[0], name: s[1], format: s[2], distanceKm: s[3], city: "上海",
  }));

  // ---- 配送日历：周一、三、五固定配送（retail-f50）----
  const DELIVERY_DAYS = [1, 3, 5];

  // ---- 促销版本（结构化字段随建议传递，retail-f11/f21）----
  // 部分 SKU-店 存在「临时促销」，显著抬高销量；约 40% 门店改价未回传（retail-f21）
  const promoPool = ["周末闪促", "会员日", "满减搭赠", "新品试饮"];
  const PROMOS = [];
  SKUS.forEach((sku) => {
    STORES.forEach((st) => {
      if (rnd() < 0.16) {
        PROMOS.push({
          key: st.id + "|" + sku.id,
          promo: pick(promoPool),
          synced: rnd() > 0.4,   // 是否已回传
          startOffset: Math.floor(between(1, 6)),
        });
      }
    });
  });

  // ---- 日期（近 14 天）----
  const DAYS = 14;
  function dateStr(offset) {
    const d = new Date(Date.UTC(2026, 10, 6));
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  }
  const DATES = [];
  for (let i = DAYS - 1; i >= 0; i--) DATES.push(dateStr(i));

  // ---- 日销（SKU-店-日，含缺货截断与促销波动）----
  const SALES = {};
  const STOCKOUT = {};   // 缺货截断：key -> 截断天数
  SKUS.forEach((sku) => {
    STORES.forEach((st) => {
      const key = st.id + "|" + sku.id;
      const base = Math.round(sku.pop * between(4, 18));
      const promo = PROMOS.find((p) => p.key === key);
      const series = [];
      let stockoutDays = 0;
      for (let d = 0; d < DAYS; d++) {
        let v = Math.max(0, Math.round(base * between(0.55, 1.55)));
        if (promo && d >= promo.startOffset) {
          v = Math.round(v * between(1.6, 2.6));
        }
        if (rnd() < 0.12) { v = 0; stockoutDays++; }  // 缺货截断
        const wd = new Date(DATES[d] + "T00:00:00Z").getUTCDay();
        if (wd === 0 || wd === 6) v = Math.round(v * 1.15);
        series.push(v);
      }
      SALES[key] = series;
      STOCKOUT[key] = stockoutDays;
    });
  });

  // ---- 库存（账面 onHand 与 可售 sellable 分离，账实差异平均 8%）----
  // retail-f10/f12：货在后仓但货架没补，账面有货但可售为零
  const INV = {};
  SKUS.forEach((sku) => {
    STORES.forEach((st) => {
      const key = st.id + "|" + sku.id;
      const series = SALES[key];
      const avg = series.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const roll = rnd();
      let onHand;
      if (roll < 0.22) {
        onHand = rnd() < 0.6 ? 0 : Math.max(0, Math.floor(avg * between(0.3, 0.8)));
      } else if (roll < 0.34) {
        onHand = Math.ceil(avg * between(14, 22)); // 积压
      } else {
        onHand = Math.ceil(avg * between(3, 8));
      }
      const gapRate = between(0.04, 0.14);
      const gap = onHand > 0 ? Math.round(onHand * gapRate) : 0;
      let sellable = Math.max(0, onHand - gap);
      if (roll < 0.10 && onHand > 0) sellable = 0; // 有货≠可售典型场景
      const inTransit = rnd() < 0.18 ? sku.caseSize * Math.ceil(between(1, 3)) : 0;
      INV[key] = {
        onHand: onHand,
        sellable: sellable,
        gap: gap,
        inTransit: inTransit,
        shelfLeftDays: sku.shelfLifeDays <= 60
          ? Math.floor(between(6, sku.shelfLifeDays))
          : Math.floor(between(30, sku.shelfLifeDays)),
      };
    });
  });

  // ---- 线路容量（每店配送批次容量上限，retail-f50）----
  const LINE_CAPACITY = {};
  STORES.forEach((st) => {
    LINE_CAPACITY[st.id] = st.format === "园区店"
      ? Math.round(between(300, 460))
      : Math.round(between(180, 300));
  });

  // ---- 基线（对应 01-业务挖掘 5.1）----
  const BASELINE = {
    shortageRate: "12%", targetShortage: "5% 以下",
    turnoverDays: 48, targetTurnover: 35,
    stockGap: "8%", delayedByQueue: "30%",
    pilotStores: 8, pilotSkus: 50, pilotWeeks: 6,
    budget: "16 万元", refreshPerDay: 2,
  };

  // ---- DC 中央仓库存（部分品项不足，用于触发调拨建议）----
  const DC = {};
  SKUS.forEach((sku) => { DC[sku.id] = Math.floor(between(40, 900)); });
  ["S001", "S003", "S014", "S027"].forEach((id) => { DC[id] = Math.floor(between(0, 12)); });

  root.RC_DATA = {
    snapshotId: "v20261106-0630",
    snapshotAt: "2026-11-06 06:30",
    roles: ROLES,
    interviews: INTERVIEWS,
    skus: SKUS,
    stores: STORES,
    sales: SALES,
    inv: INV,
    stockout: STOCKOUT,
    promos: PROMOS,
    deliveryDays: DELIVERY_DAYS,
    lineCapacity: LINE_CAPACITY,
    baseline: BASELINE,
    dc: DC,
    dates: DATES,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
