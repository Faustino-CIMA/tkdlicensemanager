type Translate = (key: string) => string;

export function humanizeAuditAction(action: string) {
  return action
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function auditActionLabel(action: string, t: Translate) {
  switch (action) {
    case "order.created":
      return t("auditActionOrderCreated");
    case "invoice.created":
      return t("auditActionInvoiceCreated");
    case "licenses.created":
      return t("auditActionLicensesCreated");
    case "licenses.activated":
      return t("auditActionLicensesActivated");
    case "order.paid":
      return t("auditActionOrderPaid");
    case "order.payment_blocked":
      return t("auditActionOrderPaymentBlocked");
    case "payconiq.created":
      return t("auditActionPayconiqCreated");
    case "expense.created":
      return t("auditActionExpenseCreated");
    case "expense.updated":
      return t("auditActionExpenseUpdated");
    case "expense.paid":
      return t("auditActionExpensePaid");
    case "expense.voided":
      return t("auditActionExpenseVoided");
    case "income.created":
      return t("auditActionIncomeCreated");
    case "income.updated":
      return t("auditActionIncomeUpdated");
    case "income.voided":
      return t("auditActionIncomeVoided");
    case "finance_opening.updated":
      return t("auditActionFinanceOpeningUpdated");
    case "club_fee.billed":
      return t("auditActionClubFeeBilled");
    default:
      return humanizeAuditAction(action);
  }
}

export function displayAuditValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
}
