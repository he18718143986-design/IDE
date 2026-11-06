# 跨模块接口登记

每个模块一个文件：`interfaces/<module-id>.md`，`<module-id>` 与 [`../modules.yaml`](../modules.yaml) 里的 `id` 一致。合同交付新增跨模块接口时，DesignNote 的 `interfaces[]` 必须能在对应文件里找到同名条目（KB-5）；找不到所属模块（`modules.yaml` 的 `interfaces[]` 里也没有）会报 `KNOWLEDGE_DRIFT`。

## 条目格式

```md
## <接口名>

- **类型**：http / function / type / event
- **签名**：一句话能看懂的调用形态
- **提供方**：模块 id 与文件
- **消费方**：谁在用，用于判断改动影响面
- **引入合同**：合同号
```

## 当前登记

- [`bin.md`](./bin.md)：`stagent open`、`stagent check knowledge`
- [`daemon.md`](./daemon.md)：合同与证据相关 HTTP 接口
- [`src.md`](./src.md)：被 daemon 复用的共享类型与纯函数
