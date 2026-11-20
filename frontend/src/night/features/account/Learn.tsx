import { Link, useLocation } from "react-router-dom";
import { Page, Panel } from "../../inner";
import { TopicIndex } from "./TopicIndex";
import "./learn.css";

const lessons = [
  {id:"chart-basis", short:"Chart basis", title:"Chart basis", question:"Which price am I looking at?",
    text:"A raw close is the stored price for a particular market session. A split-adjusted series rescales earlier prices so a stock split does not create an artificial jump.",
    check:"Read the session date, provider and adjustment beside the chart. A cache read time tells you when the data was retrieved. A paper execution uses its own pricing evidence."},
  {id:"benchmark", short:"SPY benchmark", title:"SPY benchmark", question:"Did the market move with my account?",
    text:"SPY tracks the S&P 500. Its price return divides the ending observation by the starting observation, then subtracts one. It excludes dividends.",
    check:"Today compares SPY on the same two priced dates as the account. A missing SPY endpoint makes that comparison unavailable. The most recent SPY quote can belong to a different interval."},
  {id:"cash-flow", short:"Cash flow", title:"Cash-flow-adjusted return", question:"How much did the holdings earn?",
    text:"A deposit increases account value even when prices stay flat. For a priced interval, subtract net deposits from ending value, divide by starting value, then subtract one. Withdrawals count as negative deposits.",
    check:"At a $1,000 starting close, a $100 deposit and a $1,120 ending close give a 2% return. The $20 gain excludes the deposit. A first close or zero starting capital cannot establish an interval return."},
  {id:"concentration", short:"Concentration", title:"Position concentration", question:"How much depends on one holding?",
    text:"Divide a position’s marked value by total account value, including cash. A $250 position in a $1,000 account carries 25% of the account’s value.",
    check:"A larger weight increases the account’s exposure to that holding’s moves. Missing marks can make the denominator incomplete. Concentration alone does not measure volatility or predict a loss."},
  {id:"preview", short:"Order previews", title:"Order previews", question:"What can change after I preview?",
    text:"The ticket estimates filled and remaining shares, buying power and the change in portfolio weight. Price, funding, trading controls and available liquidity are checked again when you confirm.",
    check:"An eligible preview can still lead to a partial fill, resting order or rejection. Read the receipt for the actual quantity, price and order status. Open orders may reserve cash or shares."},
] as const;

export function Learn() {
  const { hash } = useLocation();
  const selected = Math.max(0, lessons.findIndex(item => "#" + item.id === hash));
  return <Page title="Learn" testId="night-learn" description="A field guide to the numbers in a paper portfolio." className="field-guide"
    actions={<Link className="nk-button" to="/market">Explore markets</Link>}>
    <Page.Full className="guide-spread">
      <Panel className="guide-index" title="Topic index" actions={<small>{lessons.length} topics</small>}>
        <TopicIndex topics={lessons} selected={selected}/>
      </Panel>
      {lessons.map((item, i) => <Panel key={item.id} id={item.id} className={selected === i ? "guide-reading" : "guide-entry"}
        title={item.title} subtitle={selected === i ? `Topic ${i + 1} of ${lessons.length}` : undefined}>
        <div className="guide-answer"><h3>{item.question}</h3><p>{item.text}</p>
          <details open={selected === i} data-testid={'learn-' + item.id}><summary>Interpret this metric</summary><p>{item.check}</p></details>
        </div>
      </Panel>)}
    </Page.Full>
  </Page>;
}
