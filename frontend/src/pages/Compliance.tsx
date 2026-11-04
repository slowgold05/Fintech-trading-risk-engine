import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { approveAmlActivation, approveIntent, approveRoleChange, approveSurveillanceActivation, downloadEvidenceBundle, fetchAccessReview, fetchAmlCases, fetchAmlRules, fetchControlStatuses, fetchFindings, fetchIncidents, fetchIntents, fetchKris, fetchRegisteredRisks, fetchRiskBrief, fetchRoleChanges, fetchRoleRequests, fetchSurveillanceCases, fetchSurveillanceRules, fetchTradingHalt, fetchTradingHaltEvents, openIncident, requestAmlActivation, requestRoleChange, requestSurveillanceActivation, setTradingHalt, submitAccessReview } from "../api/compliance";
import { fetchMe } from "../api/auth";
import { PageHeader } from "../components/PageHeader";
import { DashboardCard, SkeletonBlock } from "../features/dashboard/components";
import { formatDateTime } from "../utils/format";
import { useToast } from "../context/useToast";

const statusTone: Record<string, string> = {
  pass: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  fail: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  no_sample: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  not_run: "border-slate-600 bg-slate-800 text-slate-300",
  evidence_error: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  unknown: "border-slate-600 bg-slate-800 text-slate-300",
};

export function Compliance() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [reviewReasons, setReviewReasons] = useState<Record<number, string>>({});
  const [haltReason, setHaltReason] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const query = useQuery({ queryKey: ["control-statuses"], queryFn: fetchControlStatuses });
  const roleChanges = useQuery({ queryKey: ["role-changes"], queryFn: fetchRoleChanges });
  const roleRequests = useQuery({ queryKey: ["role-requests"], queryFn: fetchRoleRequests });
  const accessReview = useQuery({ queryKey: ["access-review"], queryFn: fetchAccessReview });
  const registeredRisks = useQuery({ queryKey: ["registered-risks"], queryFn: fetchRegisteredRisks });
  const surveillanceRules = useQuery({ queryKey: ["surveillance-rules"], queryFn: fetchSurveillanceRules });
  const surveillanceCases = useQuery({ queryKey: ["surveillance-cases"], queryFn: fetchSurveillanceCases });
  const amlRules = useQuery({ queryKey: ["aml-rules"], queryFn: fetchAmlRules });
  const amlCases = useQuery({ queryKey: ["aml-cases"], queryFn: fetchAmlCases });
  const incidents = useQuery({ queryKey: ["incidents"], queryFn: fetchIncidents });
  const kris = useQuery({ queryKey: ["kris"], queryFn: fetchKris });
  const findings = useQuery({ queryKey: ["findings"], queryFn: fetchFindings });
  const riskBrief = useQuery({ queryKey: ["risk-brief"], queryFn: fetchRiskBrief });
  const intents = useQuery({ queryKey: ["trade-intents"], queryFn: fetchIntents });
  const tradingHalt = useQuery({ queryKey: ["trading-halt"], queryFn: fetchTradingHalt });
  const haltEvents = useQuery({ queryKey: ["trading-halt-events"], queryFn: fetchTradingHaltEvents });
  const haltMutation = useMutation({
    mutationFn: setTradingHalt,
    onSuccess: () => { setHaltReason(""); showToast("success", "Trading state updated.");
      void queryClient.invalidateQueries({ queryKey: ["trading-halt"] });
      void queryClient.invalidateQueries({ queryKey: ["trading-halt-events"] }); },
    onError: () => showToast("error", "Trading state could not be updated."),
  });
  const requestMutation = useMutation({
    mutationFn: requestRoleChange,
    onSuccess: () => { showToast("success", "Role change requested."); void queryClient.invalidateQueries({ queryKey: ["role-requests"] }); },
    onError: () => showToast("error", "Role request failed."),
  });
  const approvalMutation = useMutation({
    mutationFn: approveRoleChange,
    onSuccess: () => { showToast("success", "Role change approved; operator application is pending."); void queryClient.invalidateQueries({ queryKey: ["role-requests"] }); },
    onError: () => showToast("error", "Role approval failed."),
  });
  const reviewMutation = useMutation({
    mutationFn: submitAccessReview,
    onSuccess: () => { showToast("success", "Access review recorded."); void queryClient.invalidateQueries({ queryKey: ["access-review"] }); },
    onError: () => showToast("error", "Access review could not be recorded."),
  });
  const activationMutation = useMutation({
    mutationFn: requestSurveillanceActivation,
    onSuccess: () => { showToast("success", "Surveillance activation requested."); void queryClient.invalidateQueries({ queryKey: ["surveillance-rules"] }); },
    onError: () => showToast("error", "Surveillance activation could not be requested."),
  });
  const activationApprovalMutation = useMutation({
    mutationFn: approveSurveillanceActivation,
    onSuccess: () => { showToast("success", "Surveillance rule activation recorded."); void queryClient.invalidateQueries({ queryKey: ["surveillance-rules"] }); },
    onError: () => showToast("error", "Surveillance activation could not be approved."),
  });
  const amlActivationMutation = useMutation({
    mutationFn: requestAmlActivation,
    onSuccess: () => { showToast("success", "AML activation requested."); void queryClient.invalidateQueries({ queryKey: ["aml-rules"] }); },
    onError: () => showToast("error", "AML activation could not be requested."),
  });
  const amlApprovalMutation = useMutation({
    mutationFn: approveAmlActivation,
    onSuccess: () => { showToast("success", "AML rule activation recorded."); void queryClient.invalidateQueries({ queryKey: ["aml-rules"] }); },
    onError: () => showToast("error", "AML activation could not be approved."),
  });
  const incidentMutation = useMutation({
    mutationFn: openIncident,
    onSuccess: () => { showToast("success", "Incident opened."); void queryClient.invalidateQueries({ queryKey: ["incidents"] }); },
    onError: () => showToast("error", "Incident could not be opened."),
  });
  const intentApproval = useMutation({
    mutationFn: approveIntent,
    onSuccess: () => { showToast("success", "Intent approved. No order was placed."); void queryClient.invalidateQueries({ queryKey: ["trade-intents"] }); },
    onError: () => showToast("error", "Intent could not be approved."),
  });
  function submitAmlActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    amlActivationMutation.mutate({ rule_id: String(values.get("rule_id") ?? ""), reason: String(values.get("reason") ?? "").trim() });
  }
  function submitIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    incidentMutation.mutate({ title: String(values.get("title") ?? "").trim(), severity: String(values.get("severity") ?? ""), summary: String(values.get("summary") ?? "").trim() });
    event.currentTarget.reset();
  }
  function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    activationMutation.mutate({ rule_id: String(values.get("rule_id") ?? ""), reason: String(values.get("reason") ?? "").trim() });
  }
  function submitRoleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    requestMutation.mutate({ email: String(values.get("email") ?? "").trim(),
      role: String(values.get("role") ?? ""), reason: String(values.get("reason") ?? "").trim() });
  }
  const controls = query.data?.controls ?? [];
  const passed = controls.filter((control) => control.status === "pass").length;
  const failed = controls.filter((control) => control.status === "fail" || control.status === "evidence_error").length;

  return (
    <div className="space-y-6">
      <PageHeader badge="Compliance" title="Control Status" description="Control evidence, access approvals, and quarterly review. A run with no sample does not prove operating effectiveness." />
      {query.isError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200">
          {isAxiosError(query.error) && query.error.response?.status === 403
            ? "Compliance access is limited to compliance officers, admins, and auditors."
            : "Control status could not be loaded."}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="metric-tile"><p className="text-xs text-slate-400">Controls</p><p className="mt-2 font-mono text-3xl text-slate-100">{controls.length}</p></div>
            <div className="metric-tile"><p className="text-xs text-slate-400">Passing</p><p className="mt-2 font-mono text-3xl text-emerald-300">{passed}</p></div>
            <div className="metric-tile"><p className="text-xs text-slate-400">Failed evidence</p><p className="mt-2 font-mono text-3xl text-rose-300">{failed}</p></div>
          </div>
          <DashboardCard title="Trading halt">
            {tradingHalt.isLoading ? <SkeletonBlock className="h-20" /> : tradingHalt.isError ? (
              <p className="text-sm text-rose-300">Trading state could not be loaded.</p>
            ) : tradingHalt.data && (
              <div className="space-y-3">
                <p className={tradingHalt.data.halted ? "text-rose-300" : "text-emerald-300"}>
                  {tradingHalt.data.halted ? "New trading is halted" : "New trading is open"}
                  {tradingHalt.data.emergency_override ? " (emergency configuration override)" : ""}
                </p>
                <p className="text-xs text-slate-400">Last change: {tradingHalt.data.reason} · {formatDateTime(tradingHalt.data.changed_at)}</p>
                {me.data?.role === "admin" && (
                  <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault();
                    haltMutation.mutate({ halted: !tradingHalt.data.operator_halted, reason: haltReason.trim() }); }}>
                    <input aria-label="Trading halt reason" required minLength={3} maxLength={255} value={haltReason}
                      onChange={(event) => setHaltReason(event.target.value)} placeholder="Reason for change"
                      className="min-w-52 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                    <button type="submit" disabled={haltMutation.isPending || haltReason.trim().length < 3}
                      className="rounded border border-amber-400/60 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50">
                      {tradingHalt.data.operator_halted ? "Resume trading" : "Halt trading"}
                    </button>
                  </form>
                )}
                {haltEvents.data?.events.length ? <div className="space-y-1 text-xs text-slate-400">
                  {haltEvents.data.events.slice(0, 5).map((event) => (
                    <p key={event.id}>{formatDateTime(event.changed_at)} · {event.halted ? "Halted" : "Resumed"} · {event.reason}</p>
                  ))}
                </div> : null}
              </div>
            )}
          </DashboardCard>
          <DashboardCard title="Control tests">
            {query.isLoading ? <SkeletonBlock className="h-28" /> : controls.length === 0 ? (
              <p className="text-sm text-slate-400">No control definitions found.</p>
            ) : (
              <div className="table-shell">
                <table className="data-table min-w-[760px]">
                  <thead><tr><th className="text-left">Control</th><th className="text-left">Owner</th><th className="text-left">Frequency</th><th className="text-right">Checked</th><th className="text-left">Latest run</th><th className="text-right">Status</th></tr></thead>
                  <tbody>{controls.map((control) => (
                    <tr key={control.id}>
                      <td><span className="font-mono text-xs text-emerald-300">{control.id}</span><div className="mt-1 text-sm text-slate-100">{control.title}</div></td>
                      <td className="text-sm text-slate-400">{control.owner}</td>
                      <td className="text-sm text-slate-400">{control.frequency}</td>
                      <td className="text-right font-mono">{control.checked ?? "—"}</td>
                      <td className="text-sm text-slate-400">{control.run_at ? formatDateTime(control.run_at) : "Never"}</td>
                      <td className="text-right"><span className={`status-badge ${statusTone[control.status] ?? statusTone.unknown}`}>{control.status.replaceAll("_", " ")}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </DashboardCard>
          <DashboardCard title="Risk register">
            {registeredRisks.isLoading ? <SkeletonBlock className="h-24" /> : registeredRisks.isError ? (
              <p className="text-sm text-rose-300">Risk register could not be loaded.</p>
            ) : !registeredRisks.data?.risks.length ? (
              <p className="text-sm text-slate-400">No risks registered.</p>
            ) : (
              <>
                <p className="mb-4 text-xs text-slate-400">{registeredRisks.data.method}</p>
                <div className="table-shell"><table className="data-table min-w-[760px]">
                  <thead><tr><th className="text-left">Risk</th><th className="text-left">Owner</th><th className="text-left">Controls</th><th className="text-right">Inherent</th><th className="text-right">Residual</th><th className="text-right">Evidence</th></tr></thead>
                  <tbody>{registeredRisks.data.risks.map((risk) => (
                    <tr key={risk.id}>
                      <td><span className="font-mono text-xs text-emerald-300">{risk.id}</span><div className="mt-1 text-sm text-slate-100">{risk.title}</div></td>
                      <td className="text-sm text-slate-400">{risk.owner}</td>
                      <td className="font-mono text-xs text-slate-300">{risk.controls.join(", ")}</td>
                      <td className="text-right capitalize">{risk.inherent_rating}</td>
                      <td className="text-right capitalize">{risk.residual_rating}</td>
                      <td className="text-right"><span className={`status-badge ${risk.control_health === "effective" ? statusTone.pass : risk.control_health === "failed" ? statusTone.fail : statusTone.no_sample}`}>{risk.control_health}</span></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </>
            )}
          </DashboardCard>
          <DashboardCard title="Role change requests">
            {me.data?.role === "admin" && (
              <form onSubmit={submitRoleRequest} className="mb-4 grid gap-2 sm:grid-cols-4">
                <input name="email" type="email" required placeholder="Account email" aria-label="Account email" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                <select name="role" aria-label="Requested role" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                  <option value="trader">Trader</option><option value="analyst">Analyst</option><option value="compliance_officer">Compliance officer</option><option value="admin">Admin</option><option value="auditor">Auditor</option>
                </select>
                <input name="reason" required minLength={3} maxLength={255} placeholder="Reason" aria-label="Role change reason" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                <button type="submit" disabled={requestMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Request change</button>
              </form>
            )}
            {roleRequests.isLoading ? <SkeletonBlock className="h-24" /> : roleRequests.isError ? (
              <p className="text-sm text-rose-300">Role requests could not be loaded.</p>
            ) : !roleRequests.data?.requests.length ? (
              <p className="text-sm text-slate-400">No role changes requested.</p>
            ) : (
              <div className="table-shell"><table className="data-table min-w-[760px]">
                <thead><tr><th className="text-left">Account</th><th className="text-left">Change</th><th className="text-left">Reason</th><th className="text-left">Status</th><th className="text-right">Action</th></tr></thead>
                <tbody>{roleRequests.data.requests.map((item) => (
                  <tr key={item.id}>
                    <td className="text-sm text-slate-100">{item.email}</td>
                    <td className="font-mono text-xs text-slate-300">{item.old_role} → {item.new_role}</td>
                    <td className="text-sm text-slate-400">{item.reason}</td>
                    <td className="capitalize">{item.status}</td>
                    <td className="text-right">{me.data?.role === "compliance_officer" && item.status === "pending" && item.requested_by_user_id !== me.data.id && (
                      <button type="button" disabled={approvalMutation.isPending} onClick={() => approvalMutation.mutate(item.id)} className="rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-300 disabled:opacity-50">Approve</button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </DashboardCard>
          <DashboardCard title={`Access review ${accessReview.data?.period ?? ""}`}>
            {accessReview.isLoading ? <SkeletonBlock className="h-24" /> : accessReview.isError ? (
              <p className="text-sm text-rose-300">Access review could not be loaded.</p>
            ) : !accessReview.data?.accounts.length ? (
              <p className="text-sm text-slate-400">No accounts to review.</p>
            ) : (
              <div className="table-shell"><table className="data-table min-w-[760px]">
                <thead><tr><th className="text-left">Account</th><th className="text-left">Role</th><th className="text-left">Review</th><th className="text-right">Decision</th></tr></thead>
                <tbody>{accessReview.data.accounts.map((account) => (
                  <tr key={account.user_id}>
                    <td className="text-sm text-slate-100">{account.email}</td>
                    <td className="font-mono text-xs text-slate-300">{account.role}</td>
                    <td className="capitalize">{account.status}</td>
                    <td className="text-right">{account.status === "unreviewed" && me.data && me.data.id !== account.user_id && (me.data.role === "admin" || me.data.role === "compliance_officer") && (
                      <div className="flex justify-end gap-2">
                        <input aria-label={`Review reason for ${account.email}`} value={reviewReasons[account.user_id] ?? ""} onChange={(event) => setReviewReasons((old) => ({ ...old, [account.user_id]: event.target.value }))} placeholder="Review reason" maxLength={255} className="w-36 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100" />
                        {(["retain", "remove"] as const).map((decision) => (
                          <button key={decision} type="button" disabled={reviewMutation.isPending || (reviewReasons[account.user_id] ?? "").trim().length < 3} onClick={() => reviewMutation.mutate({ user_id: account.user_id, decision, reason: reviewReasons[account.user_id] })} className="rounded border border-slate-600 px-2 py-1 text-xs capitalize text-slate-200 disabled:opacity-50">{decision}</button>
                        ))}
                      </div>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </DashboardCard>
          <DashboardCard title="Surveillance">
            {surveillanceRules.isLoading || surveillanceCases.isLoading ? <SkeletonBlock className="h-24" /> : surveillanceRules.isError || surveillanceCases.isError ? (
              <p className="text-sm text-rose-300">Surveillance could not be loaded.</p>
            ) : (
              <>
                {(me.data?.role === "admin" || me.data?.role === "compliance_officer") && (surveillanceRules.data?.rules.length ?? 0) > 0 && (
                  <form onSubmit={submitActivation} className="mb-4 grid gap-2 sm:grid-cols-3">
                    <select name="rule_id" aria-label="Surveillance rule" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                      {surveillanceRules.data?.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.id}</option>)}
                    </select>
                    <input name="reason" required minLength={3} maxLength={255} placeholder="Activation reason" aria-label="Activation reason" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                    <button type="submit" disabled={activationMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Request activation</button>
                  </form>
                )}
                {!surveillanceRules.data?.rules.length ? (
                  <p className="mb-3 text-sm text-slate-400">No surveillance rules loaded.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[640px]">
                    <thead><tr><th className="text-left">Rule</th><th className="text-left">Version</th><th className="text-left">Activation</th><th className="text-right">Action</th></tr></thead>
                    <tbody>{surveillanceRules.data.rules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="text-sm text-slate-100">{rule.title}</td>
                        <td className="font-mono text-xs text-slate-300">{rule.id} v{rule.version}</td>
                        <td className="capitalize">{rule.activation_status}</td>
                        <td className="text-right">{rule.request_id !== null && me.data && (me.data.role === "admin" || me.data.role === "compliance_officer") && rule.requested_by_user_id !== me.data.id && (
                          <button type="button" disabled={activationApprovalMutation.isPending} onClick={() => activationApprovalMutation.mutate(rule.request_id as number)} className="rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-300 disabled:opacity-50">Approve rule</button>
                        )}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {!surveillanceCases.data?.cases.length ? (
                  <p className="text-sm text-slate-400">No surveillance cases.</p>
                ) : (
                  <div className="table-shell"><table className="data-table min-w-[760px]">
                    <thead><tr><th className="text-left">Rule</th><th className="text-left">Symbol</th><th className="text-left">Summary</th><th className="text-left">Status</th><th className="text-right">Due</th></tr></thead>
                    <tbody>{surveillanceCases.data.cases.map((item) => (
                      <tr key={item.id}>
                        <td className="font-mono text-xs text-slate-300">{item.rule_id}</td>
                        <td className="text-sm text-slate-100">{item.symbol}</td>
                        <td className="text-sm text-slate-400">{item.summary}</td>
                        <td className="capitalize">{item.status}</td>
                        <td className="text-right text-sm text-slate-400">{formatDateTime(item.due_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </>
            )}
          </DashboardCard>
          <DashboardCard title="AML and incidents">
            {amlRules.isLoading || amlCases.isLoading || incidents.isLoading || kris.isLoading ? <SkeletonBlock className="h-24" /> : amlRules.isError || amlCases.isError || incidents.isError || kris.isError ? (
              <p className="text-sm text-rose-300">AML and incident data could not be loaded.</p>
            ) : (
              <>
                {(me.data?.role === "admin" || me.data?.role === "compliance_officer") && (amlRules.data?.rules.length ?? 0) > 0 && (
                  <form onSubmit={submitAmlActivation} className="mb-4 grid gap-2 sm:grid-cols-3">
                    <select name="rule_id" aria-label="AML rule" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                      {amlRules.data?.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.id}</option>)}
                    </select>
                    <input name="reason" required minLength={3} maxLength={255} placeholder="Activation reason" aria-label="AML activation reason" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                    <button type="submit" disabled={amlActivationMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Request AML activation</button>
                  </form>
                )}
                {!amlCases.data?.cases.length ? (
                  <p className="mb-3 text-sm text-slate-400">No AML cases.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[640px]">
                    <thead><tr><th className="text-left">Rule</th><th className="text-left">Summary</th><th className="text-left">Status</th><th className="text-right">Due</th></tr></thead>
                    <tbody>{amlCases.data.cases.map((item) => (
                      <tr key={item.id}>
                        <td className="font-mono text-xs text-slate-300">{item.rule_id}</td>
                        <td className="text-sm text-slate-400">{item.summary}</td>
                        <td className="capitalize">{item.status}</td>
                        <td className="text-right text-sm text-slate-400">{formatDateTime(item.due_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {(me.data?.role === "admin" || me.data?.role === "compliance_officer") && (
                  <form onSubmit={submitIncident} className="mb-4 grid gap-2 sm:grid-cols-4">
                    <input name="title" required minLength={3} maxLength={255} aria-label="Incident title" placeholder="Incident title" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                    <select name="severity" aria-label="Incident severity" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
                      <option value="low">low</option>
                      <option value="moderate">moderate</option>
                      <option value="high">high</option>
                    </select>
                    <input name="summary" required minLength={3} maxLength={255} aria-label="Incident summary" placeholder="What was discovered" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
                    <button type="submit" disabled={incidentMutation.isPending} className="rounded bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Open incident</button>
                  </form>
                )}
                {!incidents.data?.incidents.length ? (
                  <p className="mb-3 text-sm text-slate-400">No incidents.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[640px]">
                    <thead><tr><th className="text-left">Title</th><th className="text-left">Severity</th><th className="text-left">Status</th><th className="text-right">Notice due</th></tr></thead>
                    <tbody>{incidents.data.incidents.map((item) => (
                      <tr key={item.id}>
                        <td className="text-sm text-slate-100">{item.title}</td>
                        <td className="capitalize">{item.severity}</td>
                        <td className="capitalize">{item.status}</td>
                        <td className="text-right text-sm text-slate-400">{formatDateTime(item.customer_notice_due_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {!kris.data?.kris.length ? (
                  <p className="mb-3 text-sm text-slate-400">No KRI readings.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[640px]">
                    <thead><tr><th className="text-left">Indicator</th><th className="text-right">Value</th><th className="text-right">Threshold</th><th className="text-left">Status</th></tr></thead>
                    <tbody>{kris.data.kris.map((item) => (
                      <tr key={item.id}>
                        <td className="text-sm text-slate-100">{item.title}</td>
                        <td className="text-right font-mono text-xs text-slate-300">{item.value}</td>
                        <td className="text-right font-mono text-xs text-slate-300">{item.threshold}</td>
                        <td className="capitalize">{item.status.replaceAll("_", " ")}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                <button type="button" onClick={() => { void downloadEvidenceBundle().catch(() => showToast("error", "Evidence bundle could not be downloaded.")); }} className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-100">Download evidence bundle</button>
                {amlRules.data?.rules.some((rule) => rule.request_id !== null && me.data && (me.data.role === "admin" || me.data.role === "compliance_officer") && rule.requested_by_user_id !== me.data.id) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {amlRules.data.rules.filter((rule) => rule.request_id !== null && me.data && rule.requested_by_user_id !== me.data.id).map((rule) => (
                      <button key={rule.id} type="button" disabled={amlApprovalMutation.isPending} onClick={() => amlApprovalMutation.mutate(rule.request_id as number)} className="rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-300 disabled:opacity-50">Approve {rule.id}</button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </DashboardCard>
          <DashboardCard title="Intents, findings, and risk brief">
            {findings.isLoading || riskBrief.isLoading || intents.isLoading ? <SkeletonBlock className="h-24" /> : findings.isError || riskBrief.isError || intents.isError ? (
              <p className="text-sm text-rose-300">Intent and brief data could not be loaded.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-400">Vendor register: Massive, Finnhub, Twelve Data, FRED, and Bluesky are not connected. The file is docs/vendors.md.</p>
                {!intents.data?.intents.length ? (
                  <p className="mb-3 text-sm text-slate-400">No trade intents.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[760px]">
                    <thead><tr><th className="text-left">Symbol</th><th className="text-left">Side</th><th className="text-left">Status</th><th className="text-left">Approver</th><th className="text-right">Decided</th></tr></thead>
                    <tbody>{intents.data.intents.map((item) => (
                      <tr key={item.id}>
                        <td className="text-sm text-slate-100">{item.symbol}</td>
                        <td className="capitalize">{item.side}</td>
                        <td className="capitalize">{item.status}</td>
                        <td className="font-mono text-xs text-slate-300">{item.decided_by_user_id ?? "none"}</td>
                        <td className="text-right text-sm text-slate-400">{item.decided_at ? formatDateTime(item.decided_at) : "pending"}{item.status === "proposed" && me.data && (me.data.role === "admin" || me.data.role === "compliance_officer") ? (
                          <button type="button" disabled={intentApproval.isPending} onClick={() => intentApproval.mutate(item.id)} className="ml-2 rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-300 disabled:opacity-50">Approve intent</button>
                        ) : null}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {!findings.data?.findings.length ? (
                  <p className="mb-3 text-sm text-slate-400">No findings.</p>
                ) : (
                  <div className="table-shell mb-4"><table className="data-table min-w-[640px]">
                    <thead><tr><th className="text-left">Control</th><th className="text-left">Summary</th><th className="text-left">Status</th><th className="text-right">Due</th></tr></thead>
                    <tbody>{findings.data.findings.map((item) => (
                      <tr key={item.id}>
                        <td className="font-mono text-xs text-slate-300">{item.control_id}</td>
                        <td className="text-sm text-slate-400">{item.summary}</td>
                        <td className="capitalize">{item.status}</td>
                        <td className="text-right text-sm text-slate-400">{formatDateTime(item.due_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                {!riskBrief.data?.brief ? (
                  <p className="text-sm text-slate-400">No risk brief.</p>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-slate-300">{riskBrief.data.brief.body}</pre>
                )}
              </>
            )}
          </DashboardCard>
          <DashboardCard title="Access changes">
            {roleChanges.isLoading ? <SkeletonBlock className="h-24" /> : roleChanges.isError ? (
              <p className="text-sm text-rose-300">Role changes could not be loaded.</p>
            ) : !roleChanges.data?.changes.length ? (
              <p className="text-sm text-slate-400">No role changes recorded.</p>
            ) : (
              <div className="table-shell">
                <table className="data-table min-w-[760px]">
                  <thead><tr><th className="text-left">Account</th><th className="text-left">Change</th><th className="text-left">Operator</th><th className="text-left">Reason</th><th className="text-right">When</th></tr></thead>
                  <tbody>{roleChanges.data.changes.map((change) => (
                    <tr key={change.id}>
                      <td className="text-sm text-slate-100">{change.email}</td>
                      <td className="font-mono text-xs text-slate-300">{change.old_role} → {change.new_role}</td>
                      <td className="text-sm text-slate-400">{change.actor}</td>
                      <td className="text-sm text-slate-400">{change.reason}</td>
                      <td className="text-right text-sm text-slate-400">{formatDateTime(change.changed_at)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        </>
      )}
    </div>
  );
}
