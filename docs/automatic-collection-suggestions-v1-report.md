# Automatic Collection Suggestions v1

验证日期：2026-08-13

## 架构

`CollectionSuggestionService` 读取 SQLite 聚合结果，生成单字段、双字段与颜色组合候选，执行阈值过滤、规则签名去重、评分、重叠降噪，然后只返回 Top 8。整个过程不调用 Codex，也不读取原始图片。

建议创建时调用现有 `SmartCollectionService.create()`。建议是 Saved Query，不会移动、复制或改名素材。

## 自适应阈值

| Library 规模 | 单字段 | 双字段 |
|---|---:|---:|
| ≤ 50 | max(3, 12%) | max(3, 10%) |
| 51–1000 | max(5, 2.5%) | max(4, 1.5%) |
| > 1000 | max(12, 0.5%) | max(8, 0.3%) |

## 当前真实 Library

当前非回收站素材：12。

| 建议 | 数量 | Support | Score | Signature |
|---|---:|---:|---:|---|
| 背包 | 12 | 100% | 113.61 | `aiObject=backpack` |
| 背包电商产品设计 | 9 | 75% | 105.29 | `aiObject=backpack&aiStyle=ecommerce_design` |
| 电商产品设计 | 9 | 75% | 96.29 | `aiStyle=ecommerce_design` |
| 白底背包 | 7 | 58.3% | 92.50 | `aiObject=backpack&aiScene=white_background` |
| 白底电商产品设计 | 7 | 58.3% | 92.50 | `aiScene=white_background&aiStyle=ecommerce_design` |
| 白底 | 7 | 58.3% | 79.50 | `aiScene=white_background` |
| 背包生活方式摄影 | 3 | 25% | 60.50 | `aiObject=backpack&aiStyle=lifestyle_photography` |
| 生活方式摄影 | 3 | 25% | 47.50 | `aiStyle=lifestyle_photography` |

白、灰、黑和中性色如果保留了父分组 85% 以上的素材，会被视为缺乏区分度，不占用 Top 8；当前 Library 因此没有产生“白色背包”等噪声建议。

## 验证

- 当前 Library 使用 WAL 一致副本验证，未修改用户的真实 Smart Collections。
- 创建建议后生成真实 Smart Collection，数量与建议一致。
- 新增符合条件的素材后，Smart Collection 数量自动增加。
- 等价规则通过 canonical signature 去重，与名字无关。
- Ignore 写入 `smart_collection_suggestion_ignores`，重启后仍生效；Restore API 可恢复。
- Manual Object 优先于旧 AI Object，Suggestion count 正确变化。
- 回收站素材不参与聚合。
- 颜色仅来自 `asset_colors` 的 HSL/Lab/ratio；主色累计占比需达到 16%，Smart Collection 颜色匹配要求单色占比至少 12%。
- 10,000 条 Metadata 首次完整 Top-8 计算：约 0.8–1.0 秒；内存 revision cache 命中低于 10ms。
- TypeScript strict typecheck、自动化回归、Electron UI 与 Windows production build 均通过。
