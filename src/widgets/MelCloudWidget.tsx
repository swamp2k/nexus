import { useDashboardJson } from "../data/dashboardRefresh";
import { heatPumpState, temp, type MelCloudDevice } from "../MelCloudPage";

type DeviceResponse = { devices: MelCloudDevice[] };

export default function MelCloudWidget() {
  const { data, loading, error } = useDashboardJson<DeviceResponse>("/api/melcloud/devices");
  if (loading) return <div className="home-widget-state">Henter varmepumpe…</div>;
  const device = data?.devices?.[0] ?? null;
  if (error || !device) return <div className="home-widget-state">Varmepumpen kunne ikke hentes</div>;
  return <div className="home-heatpump">
    <div className="home-heatpump-status"><strong>{heatPumpState(device)}</strong><span>{device.zone1Name ?? "Zone 1"}</span></div>
    <div className="home-heatpump-values">
      <div><span>Rum</span><strong>{temp(device.roomTemperatureZone1 ?? device.roomTemperature)}</strong></div>
      <div><span>Tank</span><strong>{temp(device.tankTemperature)}</strong><small>Mål {temp(device.setTankTemperature)}</small></div>
      <div><span>Ude</span><strong>{temp(device.outdoorTemperature)}</strong></div>
    </div>
  </div>;
}
