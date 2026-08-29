import { build, context } from "esbuild";

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  sourcemap: true,
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("Watching Watchtower VS Code extension…");
} else {
  await build(options);
}
