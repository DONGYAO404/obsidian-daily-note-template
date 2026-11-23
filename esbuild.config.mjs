import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";

const banner = `/*
本文件由 src/ 下的 TypeScript 源码编译生成，请勿直接修改。
源码：https://github.com/your-name/obsidian-daily-note-template
*/
`;

const mode = process.argv[2] ?? "production";
const prod = mode === "production";

/** 测试构建：把纯逻辑模块单独打包成 CommonJS，供 node 直接 require。 */
if (mode === "test") {
  await esbuild.build({
    entryPoints: ["test/logic.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2018",
    outfile: "test/.build/logic.cjs",
    logLevel: "info",
  });

  // 用假的 obsidian 模块替换真实依赖，这样可以在 node 里加载并驱动插件。
  await esbuild.build({
    entryPoints: ["test/entry.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2018",
    outfile: "test/.build/plugin.cjs",
    alias: { obsidian: "./test/fake-obsidian.mjs" },
    logLevel: "info",
  });

  process.exit(0);
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
  console.log("监听中：修改 src/ 下的文件会自动重新构建 main.js");
}
