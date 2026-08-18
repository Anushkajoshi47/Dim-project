import { CommandConsole } from '@/components/command/CommandConsole';
import { LinkGraph } from '@/components/link/LinkGraph';
import { RoutingDecision } from '@/components/link/RoutingDecision';
import { EventLog } from '@/components/log/EventLog';
import { OrbitPanel } from '@/components/orbit/OrbitPanel';
import { RadioPanel } from '@/components/radio/RadioPanel';
import { AttitudeCard } from '@/components/telemetry/AttitudeCard';
import { ObcCard } from '@/components/telemetry/ObcCard';
import { PowerCard } from '@/components/telemetry/PowerCard';
import { ThermalCard } from '@/components/telemetry/ThermalCard';
import { TopBar } from '@/components/topbar/TopBar';
import { SimulationNotice } from '@/components/topbar/SimulationNotice';

/**
 * Mission console layout — a server component holding only the static grid.
 * Every panel inside is a client component driven by the socket store.
 *
 * Three columns: telemetry left, orbit + link centre, radio right; the event log
 * and command console span the bottom.
 */
export default function DashboardPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void">
      <TopBar />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-y-auto p-1.5 xl:grid-cols-[minmax(300px,1fr)_minmax(440px,1.7fr)_minmax(300px,1fr)] xl:overflow-hidden">
        {/* left — telemetry */}
        <section className="flex min-h-0 flex-col gap-1.5 xl:overflow-y-auto xl:scroll-thin">
          <PowerCard />
          <ThermalCard />
          <AttitudeCard />
          <ObcCard />
        </section>

        {/* centre — orbit, link graph, routing decision */}
        <section className="grid min-h-0 grid-rows-[minmax(300px,1.15fr)_minmax(280px,1fr)] gap-1.5">
          <OrbitPanel />
          <div className="grid min-h-0 grid-cols-1 gap-1.5 lg:grid-cols-2">
            <LinkGraph />
            <RoutingDecision />
          </div>
        </section>

        {/* right — radio payload + command console */}
        <section className="grid min-h-0 grid-rows-[1.6fr_1fr] gap-1.5">
          <RadioPanel />
          <CommandConsole />
        </section>
      </main>

      {/* bottom — event timeline */}
      <div className="h-[168px] shrink-0 px-1.5 pb-1.5">
        <EventLog />
      </div>

      <SimulationNotice />
    </div>
  );
}