// 分组名的规范化和比较，服务端（AI 提示词、结果校验）和浏览器（新分组确认）共用，不依赖其他模块

// AI 整理时「这次准备新建的分组」还没有数据库 id，用这个前缀加分组名临时表示
export const NEW_GROUP_PREFIX = "new:";

// 去掉引号书名号、合并空白、限制长度，用作显示和保存的名称
export function normalizeGroupName(value: string) {
  return value.replace(/[「」『』《》"“”'‘’]/g, "").replace(/\s+/g, " ").trim().slice(0, 20).trim();
}

// 比较时再忽略空格和大小写：「AI 工具」和「ai工具」视为同一个分组
export function groupNameKey(value: string) {
  return normalizeGroupName(value).replace(/\s+/g, "").toLowerCase();
}
