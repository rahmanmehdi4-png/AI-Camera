import { createRoot } from "react-dom/client";
import { PlannerApp } from "./components/planner/PlannerApp";
import "./styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(<PlannerApp />);

// Offline installation is optional; the editor still works if service workers
// are blocked (e.g. in a private browsing session).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("Offline cache unavailable:", error);
    });
  });
}
