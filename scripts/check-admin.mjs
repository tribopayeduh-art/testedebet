import fs from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const files = [
  "src/AdminApp.tsx",
  "src/App.tsx",
  "src/pages/AuthPage.tsx",
  "src/lib/adminApi.ts",
  "src/lib/adminLocalFallback.ts",
  "src/lib/data.ts",
  "src/lib/marketing.ts",
];

let failed = false;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    },
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    failed = true;
    console.error(`FAIL ${file}`);
    for (const d of errors) console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } else {
    console.log(`PASS ${file}`);
  }
}

for (const file of ["server/index.mjs", "server/whatsapp.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(`FAIL ${file}\n${result.stderr}`);
  } else {
    console.log(`PASS ${file}`);
  }
}

process.exit(failed ? 1 : 0);
