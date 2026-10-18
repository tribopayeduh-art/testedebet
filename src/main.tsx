import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { initAffiliateTracking } from "./lib/affiliateTracking";
import { initMetaAdsAttribution } from "./lib/metaTracking";

// Prevent unwanted double-tap and pinch gestures zoom on mobile
if (typeof document !== "undefined") {
  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("gestureend", (e) => e.preventDefault(), { passive: false });

  // Prevent double tap zoom on fast taps
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        // Only prevent default if not tapping an input or textarea
        const target = e.target as HTMLElement | null;
        if (target && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
          e.preventDefault();
        }
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
const isAdminHost =
  host.startsWith("admin.") ||
  host === "admin.borah.bet" ||
  host.includes("admin.borah.bet") ||
  host === "admin.resenhaa.bet" ||
  host.includes("admin.resenhaa.bet");

const isAdmin =
  isAdminHost ||
  window.location.pathname === "/admin" ||
  window.location.pathname.startsWith("/admin/");

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (!isAdmin) {
  try {
    initAffiliateTracking();
  } catch {}
  try {
    initMetaAdsAttribution();
  } catch {}
}

async function bootstrap() {
  if (isAdmin) {
    const [{ default: AdminApp }] = await Promise.all([
      import("./AdminApp"),
      import("./admin.css"),
    ]);
    root.render(<React.StrictMode><AdminApp /></React.StrictMode>);
    return;
  }

  const [{ default: App }, marketing] = await Promise.all([
    import("./App"),
    import("./lib/marketing"),
  ]);

  root.render(<React.StrictMode><App /></React.StrictMode>);
  marketing.initMarketingTracking().catch(() => {});
}

bootstrap().catch((error) => {
  console.error("[bootstrap]", error);
  root.render(
    <div className="bootstrap-error">
      <strong>Não foi possível iniciar a Trevo da Sorte.</strong>
      <span>Atualize a página. Se o problema continuar, verifique a conexão.</span>
      <button onClick={() => location.reload()}>Tentar novamente</button>
    </div>
  );
});
