import { CheckCircle2, CircleAlert, LockKeyhole, Workflow } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Card } from '@/components/ui/card';
import { getDashboardSnapshot } from '@/lib/dashboard/data';

export const dynamic = 'force-dynamic';

function Status({ ok, label, description }: { ok: boolean; label: string; description: string }) {
  return <div className="flex gap-3 border-b border-slate-100 py-3 last:border-0">{ok ? <CheckCircle2 size={18} className="shrink-0 text-emerald-600"/> : <CircleAlert size={18} className="shrink-0 text-amber-500"/>}<div><div className="text-xs font-bold text-slate-700">{label}</div><div className="mt-0.5 text-[10px] leading-4 text-slate-500">{description}</div></div></div>;
}

export default async function SettingsPage() {
  const snapshot = await getDashboardSnapshot();
  return (
    <>
      <PageHeading title="Settings & Integrations" description="Read-only configuration health for authentication, managed scan execution, business data, and report freshness."/>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><div className="flex items-center gap-2"><LockKeyhole size={18} className="text-indigo-600"/><h2 className="text-sm font-bold">Authentication & RBAC</h2></div><div className="mt-3"><Status ok={process.env.DASHBOARD_AUTH_REQUIRED === 'true'} label="Dashboard protection" description={process.env.DASHBOARD_AUTH_REQUIRED === 'true' ? 'Google OAuth authentication is required.' : 'Authentication is optional for this environment.'}/><Status ok={Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)} label="Google OAuth" description="Requires AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET."/><Status ok={Boolean(process.env.DASHBOARD_ROLE_MAP || process.env.DASHBOARD_ADMIN_EMAILS)} label="Role mapping" description="Admin and team roles can be mapped by email through environment variables."/></div></Card>
        <Card className="p-5"><div className="flex items-center gap-2"><Workflow size={18} className="text-violet-600"/><h2 className="text-sm font-bold">Execution & Data</h2></div><div className="mt-3"><Status ok={Boolean(process.env.GITHUB_WORKFLOW_TOKEN && process.env.GITHUB_REPOSITORY)} label="Managed scan execution" description="Uses the dashboard scan workflow without exposing CI implementation details."/><Status ok={snapshot.businessDataConnected} label="Verified business metrics" description={snapshot.businessDataConnected ? 'Revenue modeling is enabled.' : 'Monetary loss is disabled until sessions, conversion rate, and AOV are connected.'}/><Status ok={snapshot.dataFreshness === 'fresh'} label="Artifact freshness" description={`Latest source artifact: ${snapshot.sourceGeneratedAt}`}/></div></Card>
      </div>
      <Card className="mt-4 p-5"><h2 className="text-sm font-bold text-slate-800">Metric provenance</h2><div className="mt-3 grid gap-2">{snapshot.sourceNotes.map((note) => <p key={note} className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">{note}</p>)}</div></Card>
    </>
  );
}
