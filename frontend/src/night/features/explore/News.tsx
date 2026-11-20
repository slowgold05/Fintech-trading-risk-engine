import { useMemo, useState } from "react";
import type { Coverage } from "../../api";
import { Button, Field, Page, Panel, RestInstrument, type InstrumentStatus } from "../../inner";
import { formatUtcDateTime } from "../../../utils/format";
import { errorDetail, sourceUrl, useMarketRead } from "./marketRead";
import { PublisherMix } from "./PublisherMix";
import "./news.css";

type Article = { id: string; title: string; publisher: string; url: string; published_at: string; symbols: string[] };
type NewsResponse = { coverage: Coverage; as_of: string | null; items: Article[] };

function Story({ article }: { article: Article }) {
  return <>
    <div className="news-byline"><span>{article.publisher}</span>
      <time dateTime={article.published_at}>{formatUtcDateTime(article.published_at) ?? "Publication time unavailable"}</time>
    </div>
    <a className="news-title" href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a>
    {article.symbols.length > 0 && <p className="news-tags">Tagged {article.symbols.join(", ")}</p>}
  </>;
}

export function News() {
  const [draft, setDraft] = useState("");
  const [symbol, setSymbol] = useState("");
  const [publisher, setPublisher] = useState<string>();
  const query = useMarketRead<NewsResponse>("news", "/night/news", { symbol: symbol || undefined, limit: 20 });
  const articles = useMemo(() => (query.data?.items ?? []).flatMap(article => {
    const url = sourceUrl(article.url);
    return url ? [{ ...article, url }] : [];
  }), [query.data]);
  const parts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { publisher } of articles) counts.set(publisher, (counts.get(publisher) ?? 0) + 1);
    return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [articles]);
  const status: InstrumentStatus | undefined = query.isError ? {
    kind: "error", role: "alert", title: "Could not load market headlines",
    action: <><p>{errorDetail(query.error)}</p><Button onClick={() => void query.refetch()}>Retry</Button></>,
  } : query.isPending ? { kind: "loading", title: "Loading market headlines…" } : !articles.length ? {
    kind: "unavailable", title: symbol ? `No sourced headlines tagged ${symbol}` : "No sourced market headlines",
    action: <p>The stored articles have no matching publisher links for this selection.</p>,
  } : undefined;
  const latest = articles.find(article => article.publisher === publisher) ?? articles[0];
  return <Page className="news-page" title="Market news" testId="night-news"
    description="Cached publisher headlines, newest first.">
    <Page.Full className="news-selection">
      <form onSubmit={event => { event.preventDefault(); setSymbol(draft.trim().toUpperCase()); }}>
        <Field id="news-symbol" label="Symbol">
          <input value={draft} maxLength={20} placeholder="All symbols" aria-describedby="news-tag-hint" onChange={event => setDraft(event.target.value)} />
        </Field><Button type="submit">Filter headlines</Button>
      </form>
      <p id="news-tag-hint">Only explicit publisher tags match. Leave blank for all headlines.</p>
    </Page.Full>
    <Page.Full className="news-edition" data-testid={query.isSuccess ? "news-sources" : undefined}>
      <Panel className="news-mix" title="Publisher share" subtitle={symbol ? `Headlines tagged ${symbol}` : "Latest stored headlines"}>
        {status ? <RestInstrument label="Publisher share" status={status}/> :
          <PublisherMix parts={parts} selected={latest.publisher} onSelect={setPublisher}/>}
        {!status && <p className="news-basis">{articles.length} sourced headlines · {parts.length} {parts.length === 1 ? "publisher" : "publishers"} · limit 20</p>}
      </Panel>
      {!status && latest && <Panel className="news-lead" title="Latest from this publisher"><Story article={latest}/></Panel>}
      {query.isSuccess && <p className="news-stamp">Cache coverage · {query.data.coverage}{query.data.as_of && ` · Observed ${formatUtcDateTime(query.data.as_of) ?? "at an unavailable time"}`}</p>}
      {!status && articles.length > 1 && <Panel className="news-wire" title="Remaining headlines">
        <ol>{articles.filter(article => article.id !== latest.id).map(article => <li key={article.id}><Story article={article}/></li>)}</ol>
      </Panel>}
    </Page.Full>
  </Page>;
}
