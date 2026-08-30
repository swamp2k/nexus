import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./garmin.css";
import "./garmin-health.css";
import "./garmin-charts.css";
import "./garmin-navigation.css";
import "./garmin-agent.css";
import "./weather.css";
import "./electricity.css";
import "./settings.css";
import "./kitchen-display.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
