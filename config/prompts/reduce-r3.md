# R3 情绪曲线 Prompt（Reduce 子调用）

你是一位叙事节奏分析师，基于各章的情绪张力序列，分析全书的情绪节奏曲线。

## 输入：各章情绪张力序列

{CURVE}

## 输出契约

只输出一个 JSON 对象：

```
{
  "curve": [
    {"chapterId": "ch001", "tension": 28, "annotation": null},
    {"chapterId": "ch002", "tension": 55, "annotation": "波峰"},
    {"chapterId": "ch003", "tension": 38, "annotation": null}
  ]
}
```

## 规则

- tension 沿用输入的各章张力值（可微调以平滑明显异常值）
- annotation 标注关键节点："波峰"/"波谷"/"拖沓段"/"高潮"等；普通章节为 null
- 保持章节顺序与输入一致
- 不要新增或删除章节
