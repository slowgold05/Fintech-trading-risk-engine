import { useId } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLook } from "../../looks/preferences";

type Topic = { id: string; title: string; short: string };
function point(angle: number, radius: number) {
  return [156 + Math.sin(angle) * radius, 156 - Math.cos(angle) * radius];
}
function arc(start: number, end: number, radius: number, reverse = false) {
  return `M${point(start, radius)}A${radius},${radius} 0 0 ${reverse ? 0 : 1} ${point(end, radius)}`;
}

export function TopicIndex({ topics, selected }: { topics: readonly Topic[]; selected: number }) {
  const { prefs } = useLook();
  const location = useLocation();
  const pattern = useId();
  const dial = prefs.look === "dial";
  const step = 2 * Math.PI / topics.length;
  const href = (topic: Topic) => ({ pathname: location.pathname, search: location.search, hash: "#" + topic.id });
  return <nav aria-label="Topics" className="topic-plate" data-centrepiece="true">
    {dial ? <svg viewBox="0 0 312 312" className="topic-wheel">
      <circle cx="156" cy="156" r="148" fill="#191b18" stroke="#565b53"/>
      {Array.from({ length: topics.length * 16 }, (_, i) => {
        const a = i * step / 16 - step / 2;
        return <path key={i} d={`M${point(a, 146)}L${point(a, i % 4 ? 142 : 137)}`} stroke="#afb4a9"/>;
      })}
      {topics.map((topic, i) => {
        const mid = i * step;
        const start = mid - step / 2 + .015, end = mid + step / 2 - .015;
        const reverse = Math.cos(mid) < 0;
        const textId = pattern + i;
        return <Link key={topic.id} to={href(topic)} aria-label={topic.title} aria-current={i === selected ? "location" : undefined}>
          <path d={`${arc(start, end, 131)}L${point(end, 76)}A76,76 0 0 0 ${point(start, 76)}Z`} className="topic-sector"/>
          <path id={textId} d={arc(reverse ? end : start, reverse ? start : end, reverse ? 111 : 105, reverse)} fill="none"/>
          <text className="topic-sector-label"><textPath href={"#" + textId} startOffset="50%" textAnchor="middle">{topic.short}</textPath></text>
          <path d={arc(start, end, 79)} fill="none" className="topic-sector-edge"/>
        </Link>;
      })}
      <circle cx="156" cy="156" r="70" fill="#111310" stroke="#6f746b"/>
      <circle cx="156" cy="156" r="65" fill="none" stroke="#393d37"/>
      <text x="156" y="146" textAnchor="middle" className="topic-hub-label">SELECTED TOPIC</text>
      <text x="156" y="180" textAnchor="middle" className="topic-position">{selected + 1} / {topics.length}</text>
    </svg> : <svg viewBox="0 0 348 290" className="topic-strata">
      {topics.map((topic, i) => {
        const left = i === selected ? 7 : 16, y = 22 + i * 51;
        return <Link key={topic.id} to={href(topic)} aria-label={topic.title} aria-current={i === selected ? "location" : undefined}>
          <path d={`M${left} ${y}l17,-12h295l-17,12Z`} className="topic-top"/>
          <path d={`M${left + 295} ${y}l17,-12v41l-17,12Z`} className="topic-side"/>
          <path d={`M${left} ${y}h295v41h-295Z`} className="topic-spine"/>
          <path d={`M${left + 48} ${y + 3}v35`} className="topic-seam"/>
          <text x={left + 24} y={y + 25} textAnchor="middle" className="topic-ordinal">{String(i + 1).padStart(2, "0")}</text>
          <text x={left + 59} y={y + 26} className="topic-spine-label">{topic.title}</text>
          <path d={`M${left + 269} ${y + 20}h12m-4,-4l4,4l-4,4`} fill="none" stroke="currentColor"/>
        </Link>;
      })}
    </svg>}
  </nav>;
}
