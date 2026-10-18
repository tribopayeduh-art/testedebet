// @ts-nocheck
process.on("unhandledRejection", (reason) => {
  console.warn("[Process Warning] Unhandled Rejection:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.warn("[Process Warning] Uncaught Exception:", err?.message || err);
});

// Preserva o valor original de PORT (ex: 8080 injetado pelo Cloud Run) como porta alternativa,
// e garante que a porta 3000 seja aberta para satisfazer a STARTUP TCP probe do container.
if (process.env.PORT && process.env.PORT !== "3000") {
  process.env.ALT_PORT = process.env.PORT;
}

import "./server/index.mjs";

