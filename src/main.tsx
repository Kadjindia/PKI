import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Apply saved theme
const savedTheme = localStorage.getItem("theme");
if (savedTheme !== "light") {
  document.documentElement.classList.remove("light-theme");
} else {
  document.documentElement.classList.add("light-theme");
}

createRoot(document.getElementById("root")!).render(<App />);
