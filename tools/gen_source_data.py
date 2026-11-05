# -*- coding: utf-8 -*-
"""生成 docs/原始项目资料/ 下的原始数据文件。

所有文件都是合成数据，但内部统计量与 01-业务挖掘.md 的口径严格对齐：
  96 单 / 处理时长中位数 4.2 小时 / 返工均值 1.7 次 / 下发 1,284 行 /
  差异 231 行（正确率 82.0%）/ 群消息 1,147 条（38% 含明确数量）/
  库存口径差异 37 处 / 临期报废 26 箱 1,240 元 / SKU 1,842 个（300 个有公式）/ 48 家门店。

固定随机种子，重复运行结果一致。
"""
import csv
import json
import os
import random
from datetime import datetime, timedelta

random.seed(20260918)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "原始项目资料")
os.makedirs(OUT, exist_ok=True)

CITIES = [("上海", 22), ("苏州", 14), ("杭州", 12)]
DISTRICTS = {
    "上海": ["徐汇", "静安", "浦东", "长宁", "杨浦", "闵行", "普陀", "虹口"],
    "苏州": ["姑苏", "园区", "吴中", "相城", "高新", "吴江"],
    "杭州": ["西湖", "拱墅", "滨江", "上城", "余杭", "萧山"],
}
FORMATS = ["社区店", "标准店", "旗舰店"]
STORES = []
n = 1
for city, cnt in CITIES:
    for i in range(cnt):
        d = DISTRICTS[city][i % len(DISTRICTS[city])]
        STORES.append({
            "store_id": "ST%03d" % n,
            "store_name": "%s%s店" % (city, d),
            "city": city,
            "district": d,
            "format": FORMATS[i % 3],
            "area_sqm": random.choice([80, 95, 110, 130, 150, 180, 220, 260]),
            "open_date": "20%02d-%02d-01" % (random.randint(14, 24), random.randint(1, 12)),
            "daily_sales_avg": round(random.uniform(1.2, 5.6), 1),
            "manager": "店长%02d" % n,
        })
        n += 1

with open(os.path.join(OUT, "门店清单.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(STORES[0].keys()))
    w.writeheader()
    w.writerows(STORES)

# ---------- SKU 主数据：1,842 个，其中 300 个有补货公式 ----------
CATS = [
    ("常温", "饮料", ["矿泉水", "气泡水", "乌龙茶", "橙汁", "咖啡饮料"], [180, 270, 365]),
    ("常温", "粮油", ["大米", "挂面", "食用油", "调味酱"], [365, 540, 720]),
    ("常温", "零食", ["薯片", "饼干", "坚果", "糖果", "肉脯"], [180, 270, 365]),
    ("冷藏", "乳品", ["鲜牛奶", "低脂奶", "酸奶", "奶酪"], [7, 14, 21]),
    ("冷藏", "鲜食", ["饭团", "三明治", "便当", "沙拉", "关东煮"], [1, 2, 3]),
    ("冷藏", "熟食", ["卤味", "火腿", "香肠"], [5, 7, 10]),
    ("冷冻", "速冻", ["水饺", "汤圆", "包子", "冰淇淋"], [180, 270, 365]),
]
SPEC = ["100g", "150g", "250ml", "500ml", "1L", "2个装", "5个装", "整箱"]
SKUS = []
for i in range(1842):
    cat, sub, names, lifes = CATS[i % len(CATS)]
    base = names[(i // len(CATS)) % len(names)]
    spec = SPEC[(i * 7) % len(SPEC)]
    cost = round(random.uniform(2.5, 68.0), 2)
    SKUS.append({
        "sku_id": "S%04d" % (i + 1),
        "sku_name": "%s %s" % (base, spec),
        "category": cat,
        "sub_category": sub,
        "spec": spec,
        "shelf_life_days": random.choice(lifes),
        "cost_price": cost,
        "retail_price": round(cost * random.uniform(1.25, 1.65), 2),
        "abc_class": "A" if i % 10 < 2 else ("B" if i % 10 < 6 else "C"),
        "is_new": "Y" if i % 37 == 0 else "N",
        "has_formula": "Y" if i < 300 else "N",
        "supplier": "SUP%02d" % (i % 24 + 1),
    })

with open(os.path.join(OUT, "SKU主数据.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(SKUS[0].keys()))
    w.writeheader()
    w.writerows(SKUS)

# ---------- 缺货上报台账：96 单，1,284 行，差异 231 行 ----------
TOTAL_ROWS = 1284
weights = [random.random() + 0.15 for _ in range(96)]
wsum = sum(weights)
lines = [max(1, int(TOTAL_ROWS * w / wsum)) for w in weights]
while sum(lines) < TOTAL_ROWS:
    lines[random.randrange(96)] += 1
while sum(lines) > TOTAL_ROWS:
    i = random.randrange(96)
    if lines[i] > 1:
        lines[i] -= 1

# 处理时长：对数正态，中位数 4.2 小时
import math
mu, sigma = math.log(4.2), 0.55
hours = [round(random.lognormvariate(mu, sigma), 1) for _ in range(96)]
hours.sort()
for i in range(48):
    hours[i] = min(hours[i], 4.2)
for i in range(48, 96):
    hours[i] = max(hours[i], 4.2)
hours[47], hours[48] = 4.2, 4.2          # 中位数命中 4.2 小时口径

# 返工次数：均值 1.7
rework = []
while len(rework) < 96:
    v = random.choices([0, 1, 2, 3, 4, 5], weights=[8, 22, 30, 22, 13, 5])[0]
    rework.append(v)
while sum(rework) != 163:                      # 96 * 1.7 ≈ 163
    if sum(rework) > 163:
        i = rework.index(max(rework))
        rework[i] -= 1
    else:
        i = rework.index(min(rework))
        rework[i] += 1

diff_rows = [0] * 96
idx = list(range(96))
random.shuffle(idx)
left = 231
for i in idx:
    if left <= 0:
        break
    take = random.randint(0, min(6, lines[i], left))
    diff_rows[i] = take
    left -= take
i = 0
while left > 0:
    if diff_rows[i] < lines[i]:
        diff_rows[i] += 1
        left -= 1
    i = (i + 1) % 96

start = datetime(2026, 9, 1, 8, 0)
tickets = []
for i in range(96):
    t = start + timedelta(days=i * 30 // 96, hours=random.randint(0, 7), minutes=random.randint(0, 59))
    st = random.choice(STORES)
    sku = random.choice(SKUS[:900])
    reported = random.randint(2, 40)
    issued = max(1, reported + random.choice([-4, -2, -1, 0, 0, 1, 2]))
    h = hours[i]
    issued_at = t + timedelta(hours=h)
    tickets.append({
        "ticket_id": "RC2026%04d" % (i + 1),
        "report_time": t.strftime("%Y-%m-%d %H:%M"),
        "store_id": st["store_id"],
        "store_name": st["store_name"],
        "sku_id": sku["sku_id"],
        "sku_name": sku["sku_name"],
        "report_channel": "微信群" if random.random() < 0.78 else "电话",
        "report_text": "要 %d 箱" % reported if random.random() < 0.38 else "没了，补点",
        "report_qty": reported,
        "issued_qty": issued,
        "issued_time": issued_at.strftime("%Y-%m-%d %H:%M"),
        "handle_hours": h,
        "rework_count": rework[i],
        "order_lines": lines[i],
        "diff_lines": diff_rows[i],
        "status": random.choice(["已收货", "已收货", "已收货", "部分收货", "已取消"]),
    })

with open(os.path.join(OUT, "缺货上报台账.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(tickets[0].keys()))
    w.writeheader()
    w.writerows(tickets)

# ---------- 微信群消息：1,147 条，38% 含明确数量 ----------
group_words = [
    "鲜奶没了", "酸奶断货了", "饭团要补", "三明治空了", "关东煮没有汤了",
    "矿泉水缺", "面包没到", "今天的便当少了", "低温奶不够卖", "冰淇淋柜空了",
]
msgs = []
t0 = datetime(2026, 9, 1, 8, 30)
qty_flags = [True] * 436 + [False] * (1147 - 436)   # 38% 含明确数量
random.shuffle(qty_flags)
for i in range(1147):
    t = t0 + timedelta(minutes=i * 37 + random.randint(0, 20))
    has_qty = qty_flags[i]
    st = random.choice(STORES)
    if has_qty:
        text = "%s，要 %d 箱" % (random.choice(group_words), random.randint(2, 40))
    else:
        text = random.choice(group_words)
    msgs.append({
        "msg_id": "M%05d" % (i + 1),
        "send_time": t.strftime("%Y-%m-%d %H:%M"),
        "group": "门店补货协调群",
        "sender": st["manager"],
        "store_id": st["store_id"],
        "content": text,
        "has_qty": "Y" if has_qty else "N",
        "reply_count": random.choice([0, 0, 0, 1, 1, 2, 3]),
    })

with open(os.path.join(OUT, "补货群消息抽样.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(msgs[0].keys()))
    w.writeheader()
    w.writerows(msgs)

# ---------- 库存口径差异：37 处 ----------
reasons = ["收货未及时录入", "退货未冲销", "报损未过账", "跨店调拨未同步", "盘点差异未调整"]
diffs = []
for i in range(37):
    st = random.choice(STORES)
    sku = random.choice(SKUS[:600])
    a = random.randint(0, 60)
    b = max(0, a + random.choice([-9, -6, -4, -3, -2, -1, 1, 2, 3, 5, 8]))
    diffs.append({
        "date": "2026-09-18",
        "store_id": st["store_id"],
        "store_name": st["store_name"],
        "sku_id": sku["sku_id"],
        "sku_name": sku["sku_name"],
        "store_table_qty": a,
        "wms_qty": b,
        "diff_qty": a - b,
        "suspect_reason": random.choice(reasons),
        "confirmed": "N",
    })

with open(os.path.join(OUT, "库存口径差异.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(diffs[0].keys()))
    w.writeheader()
    w.writerows(diffs)

# ---------- 临期报废单：26 箱，合计 1,240 元 ----------
waste = []
total_cost = 0
for i in range(26):
    sku = SKUS[300 + i]
    qty = 1
    if i == 25:
        unit = round(1240 - total_cost, 2)
    else:
        unit = round(random.uniform(30, 62), 2)
    total_cost += unit
    waste.append({
        "doc_id": "WS202609190%02d" % (i + 1),
        "date": "2026-09-19",
        "store_id": "ST%03d" % (23 + i % 3),
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

# ---------- 补货单版本序列：09-18 鲜奶单 ----------
versions = {
    "ticket_id": "RC2026091801",
    "store": "ST001 上海徐汇店",
    "sku": "S0004 鲜牛奶 950ml",
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

# ---------- 校验 ----------
med = sorted(hours)[47:49]
stat = {
    "stores": len(STORES),
    "skus": len(SKUS),
    "skus_with_formula": sum(1 for s in SKUS if s["has_formula"] == "Y"),
    "tickets": len(tickets),
    "order_lines": sum(lines),
    "diff_lines": sum(diff_rows),
    "correct_rate": round(1 - sum(diff_rows) / sum(lines), 4),
    "median_hours": med,
    "avg_rework": round(sum(rework) / 96, 3),
    "group_msgs": len(msgs),
    "group_msgs_with_qty": sum(1 for m in msgs if m["has_qty"] == "Y"),
    "qty_ratio": round(sum(1 for m in msgs if m["has_qty"] == "Y") / len(msgs), 4),
    "inventory_diffs": len(diffs),
    "waste_qty": sum(x["qty"] for x in waste),
    "waste_amount": round(sum(x["amount"] for x in waste), 2),
}
print(json.dumps(stat, ensure_ascii=False, indent=2))
