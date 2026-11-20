import { Page, Panel, ShareInstrument } from "../../inner";
import { allowed, type Role } from "../../registry";
import "./compliance.css";

const roles: Role[] = ["trader","analyst","auditor","compliance_officer","admin"];
const admission = roles.map(role => ({role, admitted:allowed("privileged", {role,is_demo:false})}));
const formatCount = (value: number) => String(value);

export function ComplianceAccess({ role }: { role: Role }) {
  const label = role.replaceAll("_"," ");
  const admitted = admission.filter(row => row.admitted).length;
  return <Page testId="night-forbidden" className="compliance-access" eyebrow="Compliance" title="Access restricted"
    description="Your role cannot open this page." actions={<a href="/account" className="nk-button">View account</a>} layout="analysis">
    <Page.Main><Panel title="Role access" subtitle="Admission to the control evidence desk">
      <div className="access-reading" data-testid="night-state-unavailable" role="status"><small>Signed-in role</small><strong>{label}</strong><span>Restricted</span></div>
      <ShareInstrument centrepiece label="Role policy for the compliance desk" format={formatCount}
        parts={[{name:"Restricted roles",value:roles.length-admitted},{name:"Admitted roles",value:admitted}]}/>
    </Panel></Page.Main>
    <Page.Aside><Panel title="Workspace roles"><dl className="access-policy">{admission.map(row => <div key={row.role} data-current={role === row.role}>
      <dt>{row.role.replaceAll("_"," ")}{role === row.role && <small>Current role</small>}</dt><dd>{row.admitted ? "Admitted" : "Restricted"}</dd>
    </div>)}</dl></Panel></Page.Aside>
  </Page>;
}
