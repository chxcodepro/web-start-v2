// 让 node --test 直接加载使用 @/ 路径别名的 TypeScript 源码（与 tsconfig 的 paths 对应）
// 导入方需要先引入本文件，再用动态 import 加载被测模块
import { registerHooks } from "node:module";

const source = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, source).href, context);
    return nextResolve(specifier, context);
  }
});
