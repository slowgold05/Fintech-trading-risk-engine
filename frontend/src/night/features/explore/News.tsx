import { useState } from "react";
import type { Coverage } from "../../api";
import { Button, Field, Page, Panel, State } from "../../kit";
import { formatUtcDateTime } from "../../../utils/format";
import { sourceUrl, useMarketRead } from "./marketRead";
import { Results } from "./Results";
import "./news.css";

type Article = { id: string; title: string; publisher: string; url: string; published_at: string; symbols: string[] };
type NewsResponse = { coverage: Coverage; as_of: string | null; items: Article[] };

export function News() {
  const [draft, setDraft] = useState("");
  const [symbol, setSymbol] = useState("");
  const query = useMarketRead<NewsResponse>("news", "/night/news", { symbol: symbol || undefined, limit: 20 });
  return <Page className="explore news-page" title="Market news" description="Cached publisher headlines, ordered by publication time." testId="night-news">
    <Panel title="Article tags" className="filters"><form onSubmit={e => { e.preventDefault(); setSymbol(draft.trim().toUpperCase()); }}>
      <Field id="news-symbol" label="Symbol" hint="Only explicit publisher tags match. Leave blank for all headlines.">
        <input value={draft} maxLength={20} placeholder="All symbols" onChange={e => setDraft(e.target.value)} />
      </Field><Button type="submit" variant="primary">Filter headlines</Button>
    </form></Panel>
    <Panel title={symbol ? `Headlines tagged ${symbol}` : "Latest stored headlines"}>
      <Results query={query} label="market headlines">{data => {
        const articles = data.items.filter(article => sourceUrl(article.url));
        return <div data-testid="news-sources">
          <p className="context">Cache coverage · {data.coverage}{data.as_of && ` · Observed ${formatUtcDateTime(data.as_of) ?? "at an unavailable time"}`}</p>
          {articles.length ? <><p className="context">{articles.length} sourced headlines · up to 20 per selection</p>
            <ol className="headline-list">{articles.map(a => <li key={a.id}>
              <div className="headline-byline"><span>{a.publisher}</span><time dateTime={a.published_at}>{formatUtcDateTime(a.published_at) ?? "Publication time unavailable"}</time></div>
              <a href={sourceUrl(a.url)!} target="_blank" rel="noopener noreferrer">{a.title}</a>
              {a.symbols.length > 0 && <p className="context">Tagged {a.symbols.join(", ")}</p>}
            </li>)}</ol></> : <State kind="unavailable" title={symbol ? `No sourced headlines tagged ${symbol}` : "No sourced market headlines"} detail="The stored articles have no matching publisher links for this selection." />}
        </div>;
      }}</Results>
    </Panel>
  </Page>;
}
