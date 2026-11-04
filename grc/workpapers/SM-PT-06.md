# SM-PT-06 — Buying-power reservation invariant

**Date:** 2026-11-03
**Control owner:** Trading Operations (first line)
**Status:** Design tested. This check detects a broken reservation. It does not by itself record a rejected order.

## Risk and control

A paper buy must not reserve more cash than the account holds. Order entry rejects that case before a new reservation is stored. This detective check remeasures every account: the cash reserved by open buy orders is compared with `cash_balance`. Any account over the balance fails the control.

## Test of design

Reviewed `reserved_cash` and the order-entry rejection. The automated test starts from a funded account with no open orders, then inserts an open buy whose reservation exceeds the balance and expects a failure naming that account.

## Test of operating effectiveness

On a population where every account is within its cash balance, the check passes. That pass shows the invariant holds at run time. It does not show that an oversized order was submitted and rejected. Endpoint tests cover that rejection. A hosted run with at least one account is the operating sample for the invariant.

## Limits and follow-up

The check counts limit orders with a price. It does not prove the preventive message a trader saw. Keep the order-entry tests alongside this detective check.
