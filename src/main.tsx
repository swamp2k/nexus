import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./navigation.css";
import "./dashboard/dashboard.css";
import "./home.css";
import "./garmin.css";
import "./garmin-health.css";
import "./garmin-health-bars.css";
import "./garmin-charts.css";
import "./garmin-navigation.css";
import "./garmin-agent.css";
import "./motion.css";
import "./wellbeing.css";
import "./wellbeing-types.css";
import "./miyagi.css";
import "./wellbeing-history.css";
import "./weather.css";
import "./electricity.css";
import "./calendar.css";
import "./melcloud.css";
import "./unraid.css";
import "./audit-polish.css";
import "./settings.css";
import "./display-pairing.css";
import "./displays.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
