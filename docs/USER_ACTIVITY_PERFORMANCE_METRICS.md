# User Activity and Performance Metrics

This document defines the values shown on **Reports > User Activity & Performance**.

## Measurement scope

- A record belongs to the user in its `created_by` field. The report does not reassign an order, bill, or transaction to the person who edited it later.
- The date/time filter uses each record's `created_at` timestamp. Custom values are interpreted in the application's configured timezone and converted to UTC for the database query.
- Deleted orders, bills, and transactions are excluded. A deleted user remains visible only when that user still has matching activity in the selected range.
- Amounts, paid amounts, and statuses are the current values of records created in the selected range. For example, an order created in the range and completed later appears under Completed with its current paid amount.
- Capability-disabled groups are hidden in the report UI. Sales controls order/customer values, Purchases controls bill/vendor values, and Banking controls transaction values.

## Report-wide indicators

| Metric | Meaning and calculation |
| --- | --- |
| Users Included | Number of users matching the User, Role, Activity, search, and date/time filters. |
| Active users | Included users who created at least one matching order, bill, or transaction. |
| Orders Captured | Number of non-deleted orders created by the included users in the selected period. |
| Bills Captured | Number of non-deleted bills created by the included users in the selected period. |
| Finance Entries | Number of non-deleted transactions created by the included users in the selected period. This includes Income, Expense, and Transfer entries regardless of approval state. |
| Gross Order Value | Sum of the current `total` of all captured orders, including orders whose current outcome is returned or cancelled. |

## Per-user summary cards

| Metric | Meaning and calculation |
| --- | --- |
| Orders Created | Count of matching orders whose creator is the user. |
| Completed | Orders currently in `Completed` or `Exchange delivered`. |
| Cancelled | Orders currently in `Cancelled` or `Exchange cancelled`. |
| Order Value | Sum of the current total of the user's matching orders. |
| Collected | Sum of the current paid amount of the user's matching orders. |
| Bills Created | Count of matching bills whose creator is the user. |
| Purchase Value | Sum of the current total of the user's matching bills. |
| Transactions Posted | Count of matching Income, Expense, and Transfer records whose creator is the user. |

## Performance indicators

| Metric | Meaning and calculation |
| --- | --- |
| Active days | Number of distinct local calendar dates on which the user created at least one matching order, bill, or transaction. Multiple records on one day count as one active day. |
| Unique customers served | Number of distinct, non-empty customer references across the user's matching orders. |
| Items handled in orders | Sum of line-item quantities across the user's matching orders. Fractional quantities are preserved. |
| Average order value | `Order Value / Orders Created`. It is zero when no orders match. |
| Completion rate | `Completed / Orders Created x 100`. This is a current-outcome rate for orders created in the period, not the percentage completed during the period. |
| Collection rate | `Collected / Order Value x 100`. It is zero when Order Value is zero. Because both values cover all matching orders, returned and cancelled records remain in the gross base. |
| Completed order value | Sum of current order totals for orders currently in `Completed` or `Exchange delivered`. |
| Purchase settlement rate | `Bills Paid Amount / Purchase Value x 100`. It is zero when Purchase Value is zero. Both values cover all matching bills. |
| Income entries | Count and amount sum of the user's matching transactions whose type is `Income`. |
| Expense entries | Count and amount sum of the user's matching transactions whose type is `Expense`. |
| Transfer entries | Count and amount sum of the user's matching transactions whose type is `Transfer`. A transfer is counted once and its amount is not doubled for the destination account. |
| Last activity | Latest `created_at` among the user's matching orders, bills, and transactions. |

## Order status distribution

Every current order status is assigned to one displayed group:

| Group | Included current statuses |
| --- | --- |
| On Hold | `On Hold`, plus legacy `Created` records |
| Processing | `Processing`, `Courier assigned`, `Exchange processing` |
| Picked | `Picked`, `Exchange picked` |
| Completed | `Completed`, `Exchange delivered` |
| Returned | `Returned`, `Exchange returned` |
| Cancelled | `Cancelled`, `Exchange cancelled` |

Each percentage is `Status group count / Orders Created x 100`.

## Purchasing and activity details

| Metric | Meaning and calculation |
| --- | --- |
| Unique vendors handled | Number of distinct, non-empty vendor references across the user's matching bills. |
| Bills paid amount | Sum of the current paid amount of the user's matching bills. |
| First tracked activity | Earliest `created_at` among the user's matching orders, bills, and transactions. |
| Tracked activities | `Orders Created + Bills Created + Transactions Posted`. |

The expandable activity log uses the same creator and date/time rules. It displays one row per matching order, bill, or transaction and is not a separate source for the summary calculations.
