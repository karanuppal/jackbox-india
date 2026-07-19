import { createRoot } from "react-dom/client";
import "@fontsource/yatra-one/400.css";
import "@fontsource/baloo-2/400.css";
import "@fontsource/baloo-2/700.css";
import "./ui/global.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(<App />);
