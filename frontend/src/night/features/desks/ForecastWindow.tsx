import { useId, useState } from "react";
import type { ForecastModel } from "../../../types/schemas";
import { RankedRow, RestInstrument } from "../../inner";
import { useLook } from "../../looks/preferences";
import { polar, sector } from "../../inner/geometry";

const sessions = (n: number) => n.toLocaleString("en-US");

function WindowScale({ model }: { model: ForecastModel }) {
  const dial = useLook().prefs.look === "dial";
  const [focus, setFocus] = useState<"Lookback" | "Horizon">("Horizon");
  const hatch = useId();
  const parts = [{name:"Lookback",value:model.max_lookback},{name:"Horizon",value:model.max_horizon}] as const;
  const total = model.max_lookback + model.max_horizon;
  if (!(model.max_lookback > 0 && model.max_horizon > 0)) return <RestInstrument label="Session window" status={{kind:"unavailable",title:"Positive lookback and horizon limits are required to size the window."}}/>;
  const boundary = model.max_lookback / total;
  const x = 18 + 506 * boundary;
  const angle = boundary * 2 * Math.PI;
  const selected = focus === "Lookback" ? model.max_lookback : model.max_horizon;
  const label = `Maximum input of ${model.max_lookback} observed sessions followed by ${model.max_horizon} generated sessions`;
  return <div className="forecast-window" data-centrepiece="true">
    <svg role="img" aria-label={label} viewBox={dial ? "0 0 320 320" : "0 0 578 162"}>
      <defs><pattern id={hatch} patternUnits="userSpaceOnUse" width="7" height="7">
        <rect width="7" height="7" fill="#353932"/><path d="M-2 2L2 -2M0 7L7 0M5 9L9 5" stroke="#7e8378" strokeWidth=".9"/>
      </pattern></defs>
      {dial ? <>
        <circle cx="160" cy="160" r="148" fill="#171a16" stroke="#62665c"/>
        {Array.from({length:96},(_,i) => <path key={i} d={`M${polar(i*Math.PI/48,144)}L${polar(i*Math.PI/48,i%4===0?132:138)}`} stroke="#a6aa9f"/>)}
        <path d={sector(0,angle,93,130)} fill={'url(#'+hatch+')'} onClick={() => setFocus("Lookback")}/>
        <path d={sector(angle,Math.PI*2-.004,93,130)} fill={focus === "Horizon" ? "var(--accent)" : "#9da296"} onClick={() => setFocus("Horizon")}/>
        <path d={`M${polar(angle,89)}L${polar(angle,145)}`} stroke="var(--accent)" strokeWidth="2"/>
        <text x="160" y="140" textAnchor="middle">{focus.toUpperCase()}</text>
        <text className="forecast-scale-number" x="160" y="173" textAnchor="middle">{sessions(selected)}</text>
        <text x="160" y="192" textAnchor="middle">SESSIONS</text>
      </> : <>
        <path d="M18 92l36-25h506l-36 25Z" fill="#777c72" stroke="#999d94"/>
        <path d={`M18 92H${x}v31H18Z`} fill={'url(#'+hatch+')'} stroke="#4e544b"/>
        <path d={`M${x} 92l36-25H560l-36 25Z`} fill="#b9b9a7"/>
        <path d={`M${x} 92H524v31H${x}Z`} fill={focus === "Horizon" ? "var(--accent)" : "#929a88"}/>
        <path d="M524 92l36-25v31l-36 25Z" fill="#545b4e"/>
        {Array.from({length:49},(_,i) => <path key={i} d={`M${18+i*506/48} 92l36-25`} stroke="#454c42" strokeWidth=".75"/>)}
        <path d={`M${x} 135v-43l36-25V54`} fill="none" stroke="var(--accent)" strokeWidth="2"/>
        <text x="18" y="36">{focus.toUpperCase()}</text>
        <text className="forecast-scale-number" x="18" y="67">{sessions(selected)}</text>
        <text textAnchor="end" x="559" y="36">SESSION LIMITS</text>
        <text x="18" y="151">−{sessions(model.max_lookback)}</text>
        <text x={x} y="151" textAnchor="middle">0</text>
        <text x="559" y="151" textAnchor="end">+{sessions(model.max_horizon)}</text>
      </>}
    </svg>
    <div className="forecast-register"><small>Session window</small>
      {parts.map(part => <RankedRow key={part.name} name={part.name} value={part.value} max={total}
        display={sessions(part.value)} selected={focus === part.name} onSelect={() => setFocus(part.name)} />)}
    </div>
  </div>;
}

export function ForecastWindow({ models }: { models: ForecastModel[] }) {
  const [selected, setSelected] = useState<string>();
  const model = models.find(row => row.id === selected) ?? models.find(row => row.enabled) ?? models[0];
  if (!model) return <RestInstrument label="Session window" status={{kind:"unavailable",title:"No forecast model is configured."}}/>;
  return <>
    <div className="forecast-model-record">
      <div><span className="desk-meta">Model name</span><h3>{model.model_name}</h3></div>
      <span className="forecast-availability" data-enabled={model.enabled}>{model.enabled ? "enabled" : "disabled"}</span>
      {models.length > 1 && <select aria-label="Inspect forecast model" value={model.id} onChange={e => setSelected(e.target.value)}>
        {models.map(row => <option key={row.id} value={row.id}>{row.model_name}</option>)}
      </select>}
    </div>
    <WindowScale model={model}/>
    <div className="forecast-limits" aria-label="Server limits">
      <p>Max lookback <strong>{model.max_lookback}</strong><small>observed sessions</small></p>
      <p>Max horizon <strong>{model.max_horizon}</strong><small>generated sessions</small></p>
      <p>Max sample count <strong>{model.max_sample_count}</strong><small>paths per run</small></p>
    </div>
    <p className="forecast-footnote">Server limits for a single forecast request.</p>
  </>;
}
