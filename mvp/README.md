# MVP · 门店补货与库存协同

纯前端实现（HTML + CSS + 原生 JavaScript），无框架、无构建、无后端。打开 `index.html` 即可使用；数据存浏览器 `localStorage`，刷新不丢，点右上角「重置演示数据」可回到初始样本。

## 文件

| 文件 | 职责 |
|---|---|
| `index.html` | 页面结构：侧边导航 + 6 个视图容器 |
| `style.css` | 浅色双列布局，窄屏折叠为横向导航 |
| `data.js` | 数据层：确定性生成 48 店 × 18 SKU × 14 天日销、库存、在途、DC 库存、促销与新品标记 |
| `engine.js` | 决策层：纯函数 `baseline / detectShortage / suggest / rankTransfers / kpi`，无 DOM 依赖 |
| `app.js` | 交互层：状态、视图渲染、事件、审计日志 |

## 运行

直接双击 `index.html`，或在仓库根目录：

```bash
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/mvp/
```

## 用 node 验证规则

```bash
cd mvp
node -e "require('./data.js');require('./engine.js');
const D=RC_DATA,E=RC_ENGINE;
// 缺货识别
console.log(E.detectShortage(D,'ST001').map(x=>x.sku.name));
// 建议量 + 硬约束
console.log(E.suggest(D,'ST001','S004',{}));
// 调拨评分 Top3
console.log(E.rankTransfers(D,'ST001','S001',30));
"
```

`ST001` 是演示用试点门店：含 1 条效期拦截（三明治）、1 条新品低置信（关东煮），可完整走通例外路径。

## 闭环

```
缺货上报 → 建议量引擎 → 硬约束校验 → 例外复核 → 下发 / 调拨 → 到货确认 → 指标 + 审计
```

规则与参数详见 `../docs/04-设计方案.md` 第 4 节，演示脚本见 `../docs/06-MVP说明.md`。

## 已知限制

合成数据、无鉴权、无服务端、建议量为近 7 日简单均值（无促销/天气因子）、不含车辆装载优化——这些差距与真实项目的对应改造项写在 `../docs/06-MVP说明.md` 第 7 节。
