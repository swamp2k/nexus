import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./garmin.css";
import "./garmin-health.css";
import "./garmin-health-detail.css";
import "./garmin-health-bars.css";
import "./garmin-charts.css";
import "./garmin-navigation.css";
import "./garmin-agent.css";
import "./motion.css";
import "./wellbeing.css";
import "./miyagi.css";
import "./weather.css";
import "./electricity.css";
import "./settings.css";
import "./kitchen-display.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
