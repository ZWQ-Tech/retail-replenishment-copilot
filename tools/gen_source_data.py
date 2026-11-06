# -*- coding: utf-8 -*-
"""生成 docs/原始项目资料/ 下的原始数据文件（对齐 8 店 × 50 常温 SKU 试点口径）。

口径来源：FDE 调研 discovery-report.md 的 34 条事实（retail-f00 ~ retail-f55）与
mvp/data.js 的合成试点数据。本脚本产出的原始资料与 demo、访谈、业务挖掘完全打通：

  试点 8 家门店（ST001~ST008，上海） × 50 个常温 SKU（S001~S050） × 6 周
  缺货率 12%（retail-f00） · 账实差异平均 8%（retail-f12） ·
  约 30% 延迟源于配送排队（retail-f51） · 库存周转 48 天（retail-f00） ·
  仓库周一三五固定配送（retail-f50） · 数据每天刷新两次（retail-f34）

所有文件均为合成数据，固定随机种子，重复运行结果一致。
"""
import csv
import json
import math
import os
import random
from datetime import datetime, timedelta

random.seed(20261106)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "原始项目资料")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------------------
# 试点门店（8 家，上海，与 mvp/data.js 完全一致）
# ---------------------------------------------------------------------------
STORE_SEED = [
    ("ST001", "上海·徐汇社区店", "社区店", 12),
    ("ST002", "上海·静安商圈店", "商圈店", 18),
    ("ST003", "上海·浦东园区店", "园区店", 25),
    ("ST004", "上海·闵行社区店", "社区店", 22),
    ("ST005", "上海·杨浦商圈店", "商圈店", 16),
    ("ST006", "上海·长宁社区店", "社区店", 14),
    ("ST007", "上海·虹口园区店", "园区店", 20),
    ("ST008", "上海·普陀社区店", "社区店", 15),
]
STORES = [
    {
        "store_id": s[0],
        "store_name": s[1],
        "city": "上海",
        "format": s[2],
        "distance_km": s[3],
        "pilot": "Y",
        "manager": f"店长{chr(65 + i)}",
    }
    for i, s in enumerate(STORE_SEED)
]

with open(os.path.join(OUT, "门店清单.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(STORES[0].keys()))
    w.writeheader()
    w.writerows(STORES)

# ---------------------------------------------------------------------------
# 50 个常温 SKU（与 mvp/data.js 的 CATEGORIES 完全一致）
# ---------------------------------------------------------------------------
CATEGORIES = [
    ("饮料", 10, 270, ["矿泉水 550ml", "可乐 500ml", "无糖气泡水 480ml", "果汁 300ml", "茶饮 500ml",
                       "功能饮料 500ml", "苏打水 480ml", "乳酸菌 340ml", "咖啡 500ml", "酸梅汤 500ml"]),
    ("休闲零食", 10, 180, ["薯片 原味 70g", "薯片 黄瓜味 70g", "锅巴 80g", "虾条 60g", "海苔 24g",
                        "瓜子 150g", "花生米 120g", "坚果 25g", "饼干 100g", "威化 60g"]),
    ("方便食品", 8, 180, ["泡面 红烧牛肉", "泡面 香辣牛肉", "拌面 葱油", "自热米饭",
                        "酸辣粉", "八宝粥", "速食粥 燕麦", "卤蛋 2 枚"]),
    ("糖果巧克力", 8, 240, ["巧克力棒 35g", "牛奶巧克力 45g", "夹心糖 50g", "口香糖 粒装",
                          "薄荷糖 30g", "棒棒糖 装", "棉花糖 40g", "黑巧克力 45g"]),
    ("粮油调味", 6, 365, ["挂面 500g", "方便面 整箱", "食用油 400ml", "酱油 500ml", "醋 500ml", "盐 400g"]),
    ("日用品", 8, 720, ["纸巾 10 抽", "湿巾 10 抽", "洗手液 250ml", "洗衣液 500g",
                      "洗洁精 500g", "牙膏 120g", "牙刷 单支", "垃圾袋 50 只"]),
]

SKUS = []
sid = 0
for cat, moq, shelf_life, names in CATEGORIES:
    for name in names:
        sid += 1
        price = round(random.uniform(3, 28), 2)
        pop = round(random.uniform(0.5, 2.2), 2)
        SKUS.append({
            "sku_id": f"S{sid:03d}",
            "sku_name": f"{cat}·{name}",
            "category": cat,
            "temp": "常温",
            "moq": moq,                 # 最小起订量（整箱，件）
            "case_size": moq,           # 整箱规格
            "shelf_life_days": shelf_life,
            "min_display": max(4, round(moq * 0.6)),
            "retail_price": price,
            "pop_index": pop,           # 销量强度系数
            "lead_time_days": 2,
            "abc_class": "A" if sid <= 15 else ("B" if sid <= 35 else "C"),
            "supplier": f"SUP{random.randint(1, 24):02d}",
        })

with open(os.path.join(OUT, "SKU主数据.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(SKUS[0].keys()))
    w.writeheader()
    w.writerows(SKUS)

# ---------------------------------------------------------------------------
# 缺货上报台账（试点期 9 月，96 单，对齐缺货率 12%、账实差异 8% 口径）
# ---------------------------------------------------------------------------
# 9 月试点期 30 天，周一三五配送（约 13 个配送日），8 店 × 50 SKU = 400 个 SKU-店组合
# 缺货率 12% 指「SKU-店·日」维度有缺货的比例；96 单为 9 月全部上报需求单。
TOTAL_TICKETS = 96
start = datetime(2026, 9, 1, 8, 0)
tickets = []
for i in range(TOTAL_TICKETS):
    t = start + timedelta(days=i * 30 // TOTAL_TICKETS, hours=random.randint(0, 7), minutes=random.randint(0, 59))
    st = random.choice(STORES)
    sku = random.choice(SKUS)
    reported = random.randint(2, 40)
    issued = max(1, reported + random.choice([-4, -2, -1, 0, 0, 1, 2]))
    # 处理时长：对数正态，中位数 4.2 小时（retail-f01 链路口径，非 34 条事实强制值，仅作背景）
    handle_hours = round(random.lognormvariate(math.log(4.2), 0.55), 1)
    # 返工次数：均值 1.7（背景口径）
    rework = random.choices([0, 1, 2, 3, 4, 5], weights=[8, 22, 30, 22, 13, 5])[0]
    # 约 30% 延迟源于配送排队（retail-f51）
    is_delay = random.random() < 0.30
    delay_reason = "配送排队" if is_delay else random.choice(["缺货截断", "账实不一致", "促销变价", "依据缺失"])
    tickets.append({
        "ticket_id": f"RC2026{i + 1:04d}",
        "report_time": t.strftime("%Y-%m-%d %H:%M"),
        "store_id": st["store_id"],
        "store_name": st["store_name"],
        "sku_id": sku["sku_id"],
        "sku_name": sku["sku_name"],
        "report_channel": "微信群" if random.random() < 0.78 else "电话",
        "report_text": f"要 {reported} 箱" if random.random() < 0.38 else "没了，补点",
        "report_qty": reported,
        "issued_qty": issued,
        "issued_time": (t + timedelta(hours=handle_hours)).strftime("%Y-%m-%d %H:%M"),
        "handle_hours": handle_hours,
        "rework_count": rework,
        "delay_flag": "Y" if is_delay else "N",
        "delay_reason": delay_reason,
        "status": random.choice(["已收货", "已收货", "已收货", "部分收货", "已取消"]),
    })

with open(os.path.join(OUT, "缺货上报台账.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(tickets[0].keys()))
    w.writeheader()
    w.writerows(tickets)

# ---------------------------------------------------------------------------
# 补货群消息抽样（8 店试点群，38% 含明确数量）
# ---------------------------------------------------------------------------
group_words = [
    "矿泉水没了", "可乐断货", "薯片要补", "泡面空了", "纸巾缺",
    "酱油没到", "挂面不够卖", "巧克力柜空了", "洗洁精要补", "自热米饭缺",
]
msgs = []
t0 = datetime(2026, 9, 1, 8, 30)
for i in range(240):  # 8 店 × 约 30 条
    t = t0 + timedelta(minutes=i * 37 + random.randint(0, 20))
    has_qty = random.random() < 0.38
    st = random.choice(STORES)
    text = (f"{random.choice(group_words)}，要 {random.randint(2, 40)} 箱" if has_qty
            else random.choice(group_words))
    msgs.append({
        "msg_id": f"M{i + 1:05d}",
        "send_time": t.strftime("%Y-%m-%d %H:%M"),
        "group": "8店试点补货协调群",
        "sender": st["manager"],
        "store_id": st["store_id"],
        "content": text,
        "has_qty": "Y" if has_qty else "N",
    })

with open(os.path.join(OUT, "补货群消息抽样.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(msgs[0].keys()))
    w.writeheader()
    w.writerows(msgs)

# ---------------------------------------------------------------------------
# 库存口径差异（账实差异平均 8%，retail-f12）
# 每天盘点 20 个重点 SKU，差异率约 8% → 37 处差异（背景口径）
# ---------------------------------------------------------------------------
reasons = ["收货未及时录入", "退货未冲销", "报损未过账", "跨店调拨未同步", "盘点差异未调整", "货在后仓未上架"]
diffs = []
for i in range(37):
    st = random.choice(STORES)
    sku = random.choice(SKUS[:20])  # 20 个重点 SKU
    on_hand = random.randint(0, 60)
    gap_rate = random.uniform(0.04, 0.14)  # 平均约 8%
    sellable = max(0, on_hand - round(on_hand * gap_rate))
    diffs.append({
        "date": "2026-09-18",
        "store_id": st["store_id"],
        "store_name": st["store_name"],
        "sku_id": sku["sku_id"],
        "sku_name": sku["sku_name"],
        "on_hand_qty": on_hand,          # 账面库存
        "sellable_qty": sellable,        # 可售库存
        "gap_qty": on_hand - sellable,   # 账实差异
        "gap_rate": round((on_hand - sellable) / on_hand * 100, 1) if on_hand else 0,
        "suspect_reason": random.choice(reasons),
        "confirmed": "N",
    })

with open(os.path.join(OUT, "库存口径差异.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(diffs[0].keys()))
    w.writeheader()
    w.writerows(diffs)

# ---------------------------------------------------------------------------
# 临期报废单（试点期，背景口径）
# ---------------------------------------------------------------------------
waste = []
total_cost = 0
for i in range(26):
    sku = SKUS[random.randint(0, 49)]
    qty = 1
    unit = round(random.uniform(30, 62), 2) if i < 25 else round(1240 - total_cost, 2)
    total_cost += unit
    waste.append({
        "doc_id": f"WS20260919{i + 1:03d}",
        "date": "2026-09-19",
        "store_id": random.choice(STORES)["store_id"],
        "sku_id": sku["sku_id"],
        "sku_name": sku["sku_name"],
        "qty": qty,
        "unit_cost": unit,
        "amount": round(unit * qty, 2),
        "reason": "临期未售出",
        "handler": "傅景",
    })

with open(os.path.join(OUT, "临期报废单.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(waste[0].keys()))
    w.writeheader()
    w.writerows(waste)

# ---------------------------------------------------------------------------
# 补货单版本序列（09-18 鲜奶→矿泉水单，对齐 retail-f01/f20 链路口径）
# ---------------------------------------------------------------------------
versions = {
    "ticket_id": "RC2026091801",
    "store": "ST001 上海·徐汇社区店",
    "sku": "S001 饮料·矿泉水 550ml",
    "event_date": "2026-09-18",
    "versions": [
        {"version": "v1", "time": "2026-09-18 08:41", "author": "林亦舟（店长）",
         "qty": 12, "channel": "微信群", "note": "巡店发现货架见底，拍照片上报"},
        {"version": "v3", "time": "2026-09-18 10:20", "author": "唐映秋（计划员）",
         "qty": 12, "channel": "Excel", "note": "抄入补货申请，待核在途"},
        {"version": "v4", "time": "2026-09-18 14:35", "author": "唐映秋（计划员）",
         "qty": 10, "channel": "Excel", "note": "WMS 显示在途 8 箱，扣减后改为 10"},
        {"version": "v5", "time": "2026-09-18 15:02", "author": "顾明岚（运营总监）",
         "qty": 10, "channel": "电话", "note": "要求控制库存，维持 10 箱"},
        {"version": "v6", "time": "2026-09-18 16:10", "author": "林亦舟（店长）",
         "qty": 12, "channel": "电话", "note": "店长坚持 12 箱，称周末客流上升"},
        {"version": "v7", "time": "2026-09-18 17:22", "author": "唐映秋（计划员）",
         "qty": 10, "channel": "系统下发", "note": "按 v5 口径下发，未采纳店长复议"},
    ],
    "outcome": {
        "issued_qty": 10,
        "sold_out_time": "2026-09-19 10:05",
        "stockout_hours": 9.5,
        "complaints": 3,
    },
}

with open(os.path.join(OUT, "补货单版本序列.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(versions, f, ensure_ascii=False, indent=2)
    f.write("\n")

# ---------------------------------------------------------------------------
# 校验统计
# ---------------------------------------------------------------------------
stat = {
    "stores": len(STORES),
    "skus": len(SKUS),
    "tickets": len(tickets),
    "delay_ratio": round(sum(1 for t in tickets if t["delay_flag"] == "Y") / len(tickets), 4),
    "group_msgs": len(msgs),
    "group_msgs_with_qty": sum(1 for m in msgs if m["has_qty"] == "Y"),
    "qty_ratio": round(sum(1 for m in msgs if m["has_qty"] == "Y") / len(msgs), 4),
    "inventory_diffs": len(diffs),
    "avg_gap_rate": round(sum(d["gap_rate"] for d in diffs) / len(diffs), 2),
    "waste_qty": sum(x["qty"] for x in waste),
    "waste_amount": round(sum(x["amount"] for x in waste), 2),
}
print(json.dumps(stat, ensure_ascii=False, indent=2))
