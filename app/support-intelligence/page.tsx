import { Bluetooth, CircleUserRound, CloudOff, Smartphone, WifiOff, Wrench } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Card } from '@/components/ui/card';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

const families = [
  { label: 'Login Issues', pattern: /login|auth|account/i, icon: CircleUserRound },
  { label: 'Connectivity Issues', pattern: /network|request|api|timeout|connect/i, icon: WifiOff },
  { label: 'Mobile UI Issues', pattern: /mobile|viewport|responsive|safari/i, icon: Smartphone },
  { label: 'Device Issues', pattern: /device|browser|webkit|chromium/i, icon: Bluetooth },
  { label: 'Service Failures', pattern: /server|gateway|service|failed/i, icon: CloudOff },
  { label: 'Troubleshooting Queue', pattern: /.*/i, icon: Wrench },
];

export default async function SupportIntelligencePage() {
  const snapshot = await getDashboardSnapshot();
  if (!snapshot.hasData) {
    return (
      <>
        <PageHeading title="Support Intelligence" description="Operational troubleshooting signals derived from current website findings."/>
        <Card className="grid place-items-center px-6 py-20 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Wrench size={26}/></div>
          <h2 className="mt-5 text-lg font-bold text-slate-800">No scan data available</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Run a scan to generate results. Findings will be classified into login, connectivity, mobile UI, device, and service-failure families once a scan completes.</p>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeading title="Support Intelligence" description="Operational troubleshooting signals derived from current website findings. No separate customer-support knowledge-base artifact was found in the repository, so this page remains evidence-led."/>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {families.map(({ label, pattern, icon: Icon }, familyIndex) => {
          const matches = snapshot.findings.filter((item) => pattern.test(`${item.issueType} ${item.rootCause}`)).slice(0, familyIndex === families.length - 1 ? 6 : 3);
          return (
            <Card key={label} className="p-4">
              <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Icon size={18}/></div><div><h2 className="text-sm font-bold text-slate-800">{label}</h2><p className="text-[10px] text-slate-400">{matches.length} matching current findings</p></div></div>
              <div className="mt-4 space-y-2">{matches.length ? matches.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5"><div className="truncate text-[10px] font-semibold text-slate-700">{item.pageUrl}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{item.rootCause}</p></div>) : <p className="py-7 text-center text-xs text-slate-400">No matching evidence in the latest run.</p>}</div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
