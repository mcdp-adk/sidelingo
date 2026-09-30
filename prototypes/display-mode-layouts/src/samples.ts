// PROTOTYPE, throwaway. Hand-written sample Rounds: Source text (after Structuring) and Translated text.
import longEn from "./long.en.md?raw";
import longZh from "./long.zh.md?raw";

export type Sample = { key: string; label: string; fastPath: boolean; src: string; tgt: string };

export const samples: Sample[] = [
  {
    key: "en-zh",
    label: "EN→ZH 表格/列表/代码",
    fastPath: false,
    src: `## Rolling out the new cache

The edge cache now keeps responses for **up to 24 hours**, which cuts origin traffic roughly in half during peak hours.

Before you enable it, check the **three settings** below:

| Setting | Default | Notes |
| --- | --- | --- |
| \`ttl\` | 3600 | Seconds a response stays fresh |
| \`staleWhileRevalidate\` | off | Serve stale content while refreshing in the background |
| \`bypassCookies\` | \`session\` | Requests carrying these cookies skip the cache |

1. Deploy to one region first.
2. Watch the hit rate for a full day.
3. Roll out everywhere once it stays above 80%.

\`\`\`bash
cachectl enable --region eu-west --ttl 3600
\`\`\`

> Purging is global and cannot be undone.`,
    tgt: `## 推出新缓存

边缘缓存现在会将响应保留**最多 24 小时**，在高峰时段可将回源流量减少约一半。

启用之前，请先检查下面的**三项设置：**

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| \`ttl\` | 3600 | 响应保持新鲜的秒数 |
| \`staleWhileRevalidate\` | 关闭 | 在后台刷新时继续提供过期内容 |
| \`bypassCookies\` | \`session\` | 携带这些 Cookie 的请求会跳过缓存 |

1. 先部署到一个区域。
2. 观察一整天的命中率。
3. 命中率稳定在 80% 以上后再全面推出。

\`\`\`bash
cachectl enable --region eu-west --ttl 3600
\`\`\`

> 清除操作对全局生效，且无法撤销。`,
  },
  {
    key: "ja-zh",
    label: "JA→ZH 强调贴标点",
    fastPath: false,
    src: `## 定例会議の要点

**来週の締め切りは変更しない。**ただし、テスト範囲は縮小する。

- 担当：**田中（開発）**、佐藤（検証）
- 期限：10月7日（火）
- 詳細は https://example.com/notes。を参照

| 項目 | 状態 |
| --- | --- |
| API 移行 | 完了 |
| 画面の改修 | 進行中（約七割） |`,
    tgt: `## 例会要点

**下周的截止日期不变。**不过，测试范围会缩小。

- 负责人：**田中（开发）**、佐藤（验证）
- 截止：10月7日（周二）
- 详情见 https://example.com/notes。

| 事项 | 状态 |
| --- | --- |
| API 迁移 | 已完成 |
| 界面改版 | 进行中（约七成） |`,
  },
  {
    key: "short",
    label: "单行（快速路径）",
    fastPath: true,
    src: `Keep the receipt until the refund shows up in your account.`,
    tgt: `在退款到账之前，请保留收据。`,
  },
  { key: "long", label: "长文（滚动同步）", fastPath: false, src: longEn.trim(), tgt: longZh.trim() },
];
