# 获取 PMBus 和 SMBus 规范

先按[领域规则](../docs/DOMAIN_MODEL.md)确定所需的版本和章节，再从[清单](specifications.json)找到对应的 ID。清单记录官方 HTTPS 下载地址、文件大小和 SHA-256。

```bash
npm run specs:fetch -- --id pmbus-1.3.1-part-ii
```

下载需要 curl。命令会打印 `.cache/specifications/` 中的文件路径。已有文件通过大小和 SHA-256 校验时会直接复用。下载失败或校验不符时保留原文件。

维护清单时，用 [PMBus 规范档案](https://pmbus.org/specification-archives/)或 [SMBus 规范列表](https://www.smbus.org/specs/)核对来源，并运行 `npm run specs:check` 离线校验清单字段。在代码、测试或评审中引用规范时，注明版本、分册和章节。

PDF 保留在本地缓存中。分发边界见[第三方规范声明](../THIRD_PARTY_NOTICES.md)。
