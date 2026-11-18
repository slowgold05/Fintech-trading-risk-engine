import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "@phosphor-icons/react";
import { Broadcast, NewspaperClipping } from "./terrainIcons";
import { Card, Skeleton, EmptyState } from "../../design/primitives";
import { fetchMarketNews } from "../../api/market";
import { formatUtcDateTime } from "../../utils/format";
import { compactWidth, useMaxWidth } from "./compactLayout";

function WireRhythm({ times }: { times: string[] }) {
  const hours = times.map((t) => Math.floor(Date.parse(t) / 3600000)).filter(Number.isFinite);
  if (!hours.length) return null;
  const start = Math.max(...hours) - 23;
  const counts = Array<number>(24).fill(0);
  for (const hour of hours) if (hour >= start) counts[hour - start]++;
  const peak = Math.max(...counts);
  const count = counts.reduce((a, b) => a + b, 0);
  return (
    <div className="wire-timeline">
      <svg
        viewBox="0 0 240 24"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${count} cached stories in the latest 24 hourly bins`}
      >
        <path d="M2 22h236" stroke="#505255" strokeDasharray="6 4" />
        <path
          d={counts
            .map((v, i) => (v ? `M${i * 10 + 2} 21v${(-v * 18) / peak}h6v${(v * 18) / peak}z` : ""))
            .join(" ")}
          fill="#adada9"
        />
      </svg>
      <span>
        {count} stories
        <br />
        24 hours
      </span>
    </div>
  );
}

export function MarketNews() {
  const compact = useMaxWidth(compactWidth);
  const [expanded, expand] = useState(false);
  const news = useQuery({
    queryKey: ["market", "news"],
    queryFn: fetchMarketNews,
    refetchInterval: 300000,
    retry: false,
  });
  const articles = news.data?.articles ?? [];
  const previewCount = compact ? 2 : 5;
  return (
    <Card className="news-panel">
      <div className="paper-head">
        <div>
          <div className="eyebrow">
            <Broadcast size={14} /> News wire
          </div>
          <h2 id="market-news">Market news</h2>
        </div>
        <NewspaperClipping size={22} />
      </div>
      <p className="section-note">Cached headlines for the major index ETFs.</p>
      {news.isRefetchError && articles.length > 0 && (
        <p className="data-note">Showing previously cached headlines.</p>
      )}
      {articles.length > 0 && <WireRhythm times={articles.map((a) => a.published_at)} />}
      <div className="news-region" aria-labelledby="market-news" role="region" tabIndex={0}>
        {articles.length ? (
          <ul id="wire-headlines" aria-label="Market headlines">
            {(expanded ? articles : articles.slice(0, previewCount)).map((a, i) => (
              <li key={`${a.url}-${a.published_at}-${i}`}>
                <small>
                  <span>{a.source}</span> ·{" "}
                  <time dateTime={a.published_at}>{formatUtcDateTime(a.published_at) ?? a.published_at}</time>
                </small>
                <a href={a.url} rel="noopener noreferrer" target="_blank">
                  {a.headline}
                  <ArrowUpRight size={15} />
                </a>
                {a.summary && <p>{a.summary}</p>}
              </li>
            ))}
          </ul>
        ) : news.isLoading ? (
          <Skeleton label="Loading market news" />
        ) : (
          <EmptyState
            message={news.isError ? "Market news unavailable" : "No market headlines"}
            detail={
              news.isError
                ? "The news feed could not be loaded."
                : "New stories will appear here when the feed updates."
            }
          />
        )}
      </div>
      {articles.length > previewCount && (
        <button className="expand-rows" aria-controls="wire-headlines" aria-expanded={expanded} onClick={() => expand(!expanded)}>
          {expanded ? "Show fewer headlines" : "All " + articles.length + " headlines"}
        </button>
      )}
    </Card>
  );
}
