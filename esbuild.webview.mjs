import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["webview-ui/src/main.tsx"],
  bundle: true,
  outfile: "media/graphView.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  loader: { ".tsx": "tsx", ".ts": "ts" },
  sourcemap: true,
  logLevel: "info",
});
