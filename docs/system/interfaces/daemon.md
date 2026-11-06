# daemon 模块接口

## GET /api/arch/graph

- **类型**：http
- **签名**：`GET /api/arch/graph` → `{ nodes, edges, cycles }`
- **提供方**：`daemon` / `daemon/server.ts`，图由 `daemon/arch/graph.ts` 现场扫描
- **消费方**：`src` 的架构雷达（`src/components/radar/RadarGraph.tsx`）
- **引入合同**：`repo-knowledge-baseline`

## POST /api/contracts

- **类型**：http
- **签名**：`POST /api/contracts` + `SoftwareContractV*` → 200 落盘后的合同 / 4xx 明确错误码
- **提供方**：`daemon` / `daemon/server.ts`，落盘在 `daemon/pipeline/contract-store.ts`
- **消费方**：`src` 的合同操作台、`bin` 的 CLI
- **引入合同**：`repo-knowledge-baseline`

## GET /api/projects

- **类型**：http
- **签名**：`GET /api/projects` → 最近项目列表（单工作区互斥，见 ADR-0002）
- **提供方**：`daemon` / `daemon/server.ts`
- **消费方**：`src` 的打开项目入口
- **引入合同**：`repo-knowledge-baseline`
