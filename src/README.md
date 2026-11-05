# src · 项目 MVP（Demo）

这是「门店补货与库存协同」最小可用系统的源代码，对应课程要求的 `src/` 目录。与仓库根目录的 `mvp/` 为同一套代码（`mvp/` 是 GitHub Pages 的展示入口），两者内容一致，任选其一运行即可。

## 运行

无需安装依赖，双击 `index.html` 即可，或：

```bash
cd src
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/
```

## 文件职责

| 文件 | 职责 |
|---|---|
| `index.html` | 页面骨架：看板、缺货上报、建议审核、调拨、收货、审计日志五个视图 |
| `style.css` | 全部样式，无外部依赖 |
| `data.js` | 合成数据：48 家门店、SKU、当前库存与在途、历史单据 |
| `engine.js` | 规则引擎（纯函数，不依赖 DOM）：建议量计算、硬约束校验、调拨评分 |
| `app.js` | 交互与状态管理，数据存 localStorage |

## 规则引擎自测

`engine.js` 不依赖浏览器，可直接用 node 验证：

```bash
node -e "require('./data.js');require('./engine.js');
const D=RC_DATA,E=RC_ENGINE;
console.log(E.suggest(D,'ST001','S001',{}));"
```

规则标识：`R-DC-02`（DC 不足转跨店调拨）、`E_SHELF_LIFE`（效期拦截）、`W_NEW`（新品低置信）、`R-NEW`（新品兜底）。

## 边界

演示系统不连接任何真实系统，所有下发、收货、调拨动作只写入浏览器 localStorage，刷新不丢数据，清缓存即重置。完整说明见 `../docs/06-MVP说明.md`。
