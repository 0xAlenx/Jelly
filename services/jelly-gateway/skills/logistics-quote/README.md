# 物流报价 Skill 1.5 正式版

This is the official production working version for OpenClaw + WeCom logistics quotation.

Version summary: output-template stability release.

v1.5 preserves the existing remote database quotation workflow and pricing logic, and stabilizes every quote plan output through the canonical `render_plan()` renderer. Single cost plans, batch cost plans, final quote plans, and customer-facing final quote plans now share the same strict field-order renderer.

Main v1.5 template changes:

- Added canonical `render_plan()`.
- Enforced strict cost-plan field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 参考时效 → 船期 → 重量/体积/件数`.
- Enforced strict final quote field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 报价单价 → 数量 → 预估总价 → 参考时效 → 船期`.
- Added display sanitization for embedded newlines.
- Added `validate_rendered_plan_template()`.
- Updated OpenClaw usage docs: stdout is canonical and must not be rewritten, summarized, reordered, compressed, converted to tables, or field-omitted.

Deployment folder:
`~/.openclaw/workspace/skills/logistics-quote1.5/`

Production rule: OpenClaw must return `run_quote` script stdout verbatim, without rewriting or summarizing quotation output.

## Final Production Channel Rules

- `docs/4.md` is the current backend reference for v1.5.
- U.S. quotes use product/channel name + warehouse code for displayed `渠道`, for example `美西整柜直送(统配特惠)｜LAX9`.
- Europe/UK quotes use `下单渠道/子渠道 + 服务国家/国家或分区` for displayed `渠道`, for example `促销-欧洲海运普船(卡派) 德国-DTM2`.
- Europe warehouse codes may be embedded inside `服务国家` / `国家或分区`; matching and display must check those fields.
- If a Europe displayed channel does not contain the requested warehouse code, append the warehouse code for order-operator traceability, for example `倔强青铜-欧铁经济BS 德国 DTM2`.
- Generic channel strings such as `欧洲/英国成本表 · 海运` must not be used as final `渠道` when better region-specific fields exist.
- `卡派` is delivery method, not `卡航`; `海卡` means `海运 + 卡派`.
- Multi-warehouse output must show best-cost and fastest-ETA per warehouse when they differ.
- There is no local Excel fallback. Database/API failure must fail closed and refuse quotation.

# 物流报价 Skill 1.2 开发版

This is the v1.5 production release.

v1.5 is remote-database-only. It uses the remote quotation database REST service and does not include local Excel quotation files or local Excel fallback.

v1.5 adds multi-warehouse batch quotation support, single-warehouse full-option listing, per-warehouse best-cost / fastest-ETA summary output, preservation of concrete channel names, no automatic over-filtering from casual wording such as `发慢船`, and batch unified-margin calculation.

Because logistics prices update frequently, quotation accuracy is critical. If the remote database/API is unavailable, times out, or returns invalid data, this Skill fails closed and refuses to quote:

```text
当前报价数据库暂时无法查询，为避免报价错误，暂不生成报价，请稍后重试或联系负责人确认最新价格。
```

Deployment folder:

```text
~/.openclaw/workspace/skills/logistics-quote1.5/
```

Rollback:

If v1.5 has issues, restore the previous development checkpoint `logistics-quote1.1-dev`, or restore the stable `logistics-quote1.0` folder.

# Logistics Quote Skill

本项目是一个本地临时 OpenClaw 兼容物流报价 Skill，用于客服询价报价流程。

核心流程：

1. 客服转发客户询价。
2. 工具识别国家、仓库、重量、体积、税务类型、运输方式等字段。
3. 工具查询远程报价数据库，只输出成本方案，不计算客户报价。
4. 客服输入毛利率。
5. 工具计算最终报价，并生成可发送给客户的中文回复。

## Windows 使用方式

Windows 用户如果系统 `python` 指向异常环境，例如 `D:\msys2\mingw32\bin\python.exe` 且没有 `pip`，不要直接运行 `python quote_query.py`。

初始化环境：

```bat
setup_env.bat
```

干净测试前重置任务记录：

```bat
reset_sessions.bat
```

开始询价：

```bat
run_quote.bat "LAX9，300kg，深圳仓，包税，有什么方案？"
run_quote.bat "统一按15%"
```

检查远程报价接口：

```bat
run_quote.bat "/检查报价接口"
```

## Linux/macOS 使用方式

安装依赖：

```bash
python3 -m pip install -r requirements.txt
chmod +x run_quote.sh
```

运行：

```bash
./run_quote.sh "LAX9，300kg，深圳仓，包税，有什么方案？"
./run_quote.sh "统一按15%"
./run_quote.sh "/当前任务"
```

## 文件结构

```text
SKILL.md
quote_query.py
quote_config.json
quote_sessions.json
examples.md
test_cases.json
README.md
requirements.txt
setup_env.bat
run_quote.bat
reset_sessions.bat
run_quote.sh
```

## OpenClaw Local Skill Deployment

开发版 Skill 文件夹名称：

```text
logistics-quote1.5
```

把完整 `logistics-quote1.5` 文件夹复制到：

```text
~/.openclaw/workspace/skills/logistics-quote1.5
```

OpenClaw 调用方式：

Windows:

```bat
run_quote.bat "<user message>"
```

Linux/macOS:

```bash
python quote_query.py "<user message>"
```

也可以使用：

```bash
./run_quote.sh "<user message>"
```

要求：

- 工作目录必须是 Skill 文件夹。
- 所有状态保存在 `quote_sessions.json`。
- 报价状态只能由 `run_quote.sh` / `run_quote.bat` 内部管理。不要使用 `cat`、`jq`、`python -c`、管道命令或临时脚本手工读取、解析和修改 `quote_sessions.json`。
- 查询当前任务和历史任务时，仍然调用标准入口，例如 `./run_quote.sh "/当前任务"` 和 `./run_quote.sh "/任务列表"`。
- WeCom / 企业微信消息触发物流报价、仓库代码、FBA、包税/不包税、空运、海运、铁路、卡派或毛利率计算时，应使用本 Skill。
- v1.5 只调用远程 REST 报价接口。
- 本版本不包含本地 Excel 报价文件，也没有本地 Excel 回退。
- 如远程数据库不可用、超时或返回无效数据，必须拒绝报价，避免使用过期价格。

详细部署步骤见 [OPENCLAW_DEPLOY.md](OPENCLAW_DEPLOY.md)。

## 常用命令

- `/当前任务`：查看当前报价任务
- `/任务列表`：查看最近报价任务
- `/切换任务 任务编号`：切换到历史任务
- `/中断并新开`：中断当前任务并开启新询价
- `/结束任务`：结束当前任务
- `/检查报价接口`：检查远程 REST 报价接口是否可用

中文命令是正式客服使用命令。英文命令仅作为内部兼容别名。

## 测试工具

- `reset_sessions.bat`：清空 `quote_sessions.json`，用于本地干净测试。
- `/重置任务`：CLI 内部测试命令，输出 `已清空所有报价任务记录。`

这两个工具仅用于本地测试和内部调试，不作为客服常规命令。

## 企业微信显示格式

普通输出不使用横向 Markdown 表格，改为紧凑竖向卡片。

### Canonical Output Template

脚本 stdout 是唯一标准输出。OpenClaw / LLM 必须原样返回脚本输出：

- 不总结
- 不改写
- 不压缩
- 不改变字段顺序
- 不省略字段
- 不改成表格
- 不把多个报价字段合并到一行
- 缺失值使用 `未返回`，不要留空

所有成本方案必须使用同一个渲染模板，字段顺序固定：

```text
方案 1｜性价比最高
来源报价表：xxx.xlsx
工作簿：欧洲海运包税
渠道：促销-欧洲海运普船(卡派) 德国-DTM2
运输方式：海运
起运仓：深圳
税务类型：包税
计费方式：按KG
成本单价：RMB 6.70 / KG
参考时效：卡车派送 德国40-45天
船期：六截三开
重量：100KG以上
```

`重量` / `体积` / `件数` 不涉及或为空时可以省略；其他字段不得省略，缺失时显示 `未返回`。

所有最终报价方案必须使用同一个渲染模板，字段顺序固定：

```text
方案 1｜性价比最高
来源报价表：
工作簿：
渠道：
运输方式：海运
起运仓：
税务类型：包税
计费方式：按KG
成本单价：RMB 3.70 / KG
报价单价：RMB 4.3 / KG
重量：300 KG
预估总价：RMB 1290.0
参考时效：25-30自然日
船期：未返回
```

最终报价中的 `报价单价` 继续使用 `末位进一，保留1位小数`，预估总价使用展示报价单价计算。

显示规则：

- 单仓询价：展示当前条件下全部匹配方案，并标记 `性价比最高`；仅当接口返回可比较 ETA 时标记 `时效最快`。
- 批量多仓询价：每个仓库仅展示 `性价比最高` 和可比较 ETA 下的 `时效最快` 代表方案；如果同一方案同时满足两个条件，只展示一次。
- 当接口未返回参考时效时，显示 `参考时效：未返回`，不得编造时效。
- 最终报价内部结果默认最多展示前 10 个方案。
- 客户可发送报价最多展示前 5 个方案；批量报价按仓库分组输出。
- 所有匹配方案仍完整保存到 `quote_sessions.json`，批量任务会在 `batch_results` 中保存每个仓库的完整候选方案。

## v1.5 Batch Inquiry Rules

单仓询价示例：

```text
LAX9，300kg，深圳仓，包税，有什么方案？
```

行为：

- 创建一个普通报价任务。
- 返回该仓库的全部匹配方案。
- 保留数据库返回的具体渠道名称，例如 `美西整柜直送`、`以星限时达`、`美国空派-飞速达`。
- 不把渠道合并成泛化的 `海运方案` 或 `空运方案`。

批量询价示例：

```text
发慢船，麻烦报下价
RDU2-----190KG
FTW1-----141KG
SMF3-----123KG
AVP1-----177KG
MDW2-----304KG
```

行为：

- 识别为一个批量任务。
- 提取 `batch_items`，每个元素包含 `warehouse_code` 和 `weight_kg`。
- 如果各仓库重量不同，按仓库分别调用远程接口，每次使用该仓库自己的实际重量，避免重量段价格错误。
- 生产默认按仓库分别调用远程接口，即使各仓库重量相同也优先避免批量接口按首仓或合并结果误判；同重量远程批量请求仅作为显式配置能力保留。
- 当使用远程批量请求且接口返回 `按FBA仓报价` 时，按该字段分仓展示结果。
- 每个仓库只展示性价比最高和时效最快方案。
- 输入 `统一按15%` 后，对每个仓库当前展示的代表方案统一计算最终报价。

筛选规则：

- `发慢船` 这类业务口语不会自动强制筛选为海运。
- 明确出现 `海运`、`走海运`、`铁路`、`空运`、`卡航` 等运输方式时，会作为运输方式筛选条件发送给远程数据库；`卡派` 只作为派送方式，不等同于 `卡航`。
- 明确限制仍会筛选运输方式，例如 `只看空运`、`只看海运`、`只走慢船`、`不要空运`。
- 明确要求如 `只看包税`、`只看不包税`、`要最快`、`要便宜的` 仍会被识别并用于筛选或排序。
- 明确 `包税` 时会过滤掉 `自税`、`不包税`、`递延` 等不兼容选项；明确 `自税` 时不会混入包税选项。
- 多个仓库代码可以用中文逗号、英文逗号、顿号、空格或换行分隔。若多个仓库共享同一条件，例如 `DTM2 DTM1 BER8 MHG9 海运 包税 100KG以上 卡派`，会作为批量询价处理。
- `100KG以上`、`100KG+`、`100KG起` 会保留为 `重量：100KG以上`，同时按远程接口要求发送数值重量 `100`。
- 内部报价输出优先可追溯性。`来源报价表`、`工作簿` 单独显示；`渠道` 会构造成可定位路径，例如 `DTM2｜德国｜欧洲海运包税｜海运｜包税｜卡派｜100KG以上`，避免只显示 `欧洲/英国成本表 · 海运` 这类泛化描述。
- 如果远程接口返回 `仓库名`、`邮编`、`原始行号`、`rate_line_id` 或 `record_id`，会在渠道后显示为追溯字段，方便操作同事定位原始报价行。

欧洲/德国示例：

```text
深圳
欧洲、德国
MHG9 、DTM2、DTM1、BER8、RLG1，海运，包税，100KG以上
卡派
```

识别结果应包含：起运仓 `深圳`、仓库 `MHG9/DTM2/DTM1/BER8/RLG1`、运输方式 `海运`、税务类型 `包税`、派送方式 `卡派`、重量条件 `100KG以上`。

## Remote-Database-Only Rule

- v1.5 不打包 `data/` 本地报价 Excel 文件。
- `requirements.txt` 仅保留远程 REST 调用所需依赖。
- `allow_excel_fallback` 必须为 `false`。
- `logistics-quote1.0` 中的 Excel 版本只用于历史回滚/参考，不作为生产回退。
- 报价数据库不可用时，系统必须 fail closed，输出拒绝报价提示，不生成成本方案和最终报价。

## 未匹配规则

工具不会盲目放宽条件，也不会在缺少仓库/目的地时返回宽泛参考价。

未匹配分为三类：

1. 缺少关键目的仓信息
   - 例如：`英国5方，深圳仓，包税`
   - 要求客服补充仓库代码、目的仓/城市/邮编、是否 FBA、运输方式和税务类型。

2. 报价数据库无该线路数据
   - 例如：`XYZ999，300kg，深圳仓，包税`
   - 建议核对仓库代码、确认当前报价版本是否收录该线路，并联系负责人确认最新报价。

3. 筛选条件过严
   - 例如：`LAX9，300kg，深圳仓，包税，空运`
   - 显示可能过严的条件，并建议确认是否可放宽运输方式、税务类型或起运仓。

## Debug 模式

`quote_config.json` 默认 `"debug": false`。

当 `debug=true` 时，会输出识别字段、远程接口地址、远程请求 payload、远程错误和过滤步骤。

## v1.5 Remote API

Current remote database reference:

- `docs/4.md` is the current API/database documentation for v1.5.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for this version.
- v1.5 remains remote-database-only and has no local Excel fallback.

Config location:

```text
quote_config.json
```

Default:

```json
{
  "version": "1.3",
  "query_mode": "rest",
  "allow_excel_fallback": false,
  "remote_database_only": true
}
```

Remote REST:

```text
GET  http://43.156.235.189:8080/health
POST http://43.156.235.189:8080/v1/quote
```

### Current Backend Capabilities

- Cost data is region-aware: U.S. data is located mainly by product/channel name plus FBA warehouse code; Europe/UK VIP data is located by `下单渠道` + `服务国家`.
- U.S. displayed `渠道` uses product/channel name plus warehouse code, for example `美东整柜直送MDDZG｜ABE8`.
- Europe/UK displayed `渠道` uses `下单渠道` + `服务国家`, falling back to `子渠道` + `国家或分区` when the backend returns equivalent fields.
- Europe warehouse codes may appear inside `服务国家` / `国家或分区`, for example `德国-DTM2`; requested Europe warehouse codes are matched against those fields.
- Generic channel summaries such as `欧洲/英国成本表 · 海运` are not used as the final displayed `渠道` when region-specific fields exist.
- Multiple FBA warehouse codes can be sent in one remote request through `仓库/航线`, for example `RDU2 FTW1 SMF3 AVP1 MDW2`.
- `按FBA仓报价` is supported and remains the source of truth when the Skill intentionally uses one same-weight remote batch request.
- When warehouse weights differ, the Skill does not use one top-level `重量` for all warehouses. It queries each warehouse separately with its own actual weight to preserve weight-tier accuracy.
- The top-level merged `方案列表` is not used for multi-warehouse per-warehouse display when `按FBA仓报价` is present.
- Explicit transport filters are passed only when the staff clearly asks for `空运`, `海运`, or `铁路`, such as `只看空运`, `只看海运`, `只走慢船`, `不要空运`, or `只看铁路`.
- The backend may return `来源报价表`, `工作表`, and `船期`. The Skill displays `工作表` with the label `工作簿`.
- The backend recognizes sea-freight synonyms such as `慢船`, `慢线`, `普船`, `海卡`, `船运`, `散货`, `以星`, and `美森` when the Skill intentionally passes an explicit sea-freight filter.
- Casual wording such as `发慢船` does not automatically force sea-freight filtering. Explicit restrictions such as `只看海运`, `只走慢船`, `只看空运`, or `不要空运` may still be applied.
- Reference ETA may be blank. The Skill displays `参考时效：未返回` and only labels `时效最快` when returned ETA data is present and comparable.
- Ship schedule may be blank. The Skill displays `船期：未返回` and never infers ship schedule from the channel name.

MCP information is recorded in config for future use, but v1.5 implements REST first.

## Remote MCP Registration

v1.5 uses REST mode by default. MCP can also be registered for OpenClaw direct tool calling.

Full details are in [MCP_REGISTRATION.md](MCP_REGISTRATION.md).

Important endpoints:

- REST/OpenAPI documentation: `http://43.156.235.189:8080/docs#/`
- REST API base: `http://43.156.235.189:8080`
- Actual MCP endpoint: `http://43.156.235.189:8090/mcp`
- MCP health: `http://43.156.235.189:8090/health`

The `8080` docs page is REST/OpenAPI documentation, not MCP.

## ???????????

- `??` ??????????????????????
- `????` ???? `??`?`??`?`??` ????
- ????????? `????` ??????? `??????????YM????? ? FTW1`?Skill ?????????? `raw`????? `???FTW1`??? `???` ?????? `?????????YM`?
- ???????? `???? ? ABE8`?`???? ? ABE8`?`???? ? ABE8`????????????????? `???ABE8`?
- ?????????????????? `?????YT? - ????-???|????-??YT` ??????
- ??????? `??`?`??`?`??`?`???` ???????????? `????`?`????`?`????`?`????`?`????`?`????` ????????????????

