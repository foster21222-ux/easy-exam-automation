const customerRules = [
  ["中国邮政集团公司湖北省分公司", "湖北邮政"],
];
const examTypeRules = [
  ["社会招聘考试", "社招"],
];

export function defaultOperationBatchName({ customerName, projectName, examStart } = {}) {
  const date = parseLocalDate(examStart);
  if (!date) return "";
  const customer = mappedOrOriginal(customerName, customerRules);
  const examType = matchedExamType(projectName, examTypeRules);
  const base = `${customer}${examType || removeCustomerPrefix(projectName, customerName)}`.trim();
  return base ? `${base}_${date.year}年${date.month}月` : "";
}

export function resolveOperationBatchName(input = {}) {
  const generated = text(input.generatedValue);
  if (input.restoreAuto || text(input.previousMode) !== "manual") {
    const submitted = text(input.submittedValue);
    const edited = submitted && submitted !== text(input.previousValue);
    return edited
      ? { value: submitted, mode: "manual", autoValue: generated }
      : { value: generated, mode: "auto", autoValue: generated };
  }
  return {
    value: text(input.submittedValue || input.previousValue),
    mode: "manual",
    autoValue: generated,
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function mappedOrOriginal(value, rules) {
  const original = text(value);
  return rules.find(([source]) => source === original)?.[1] || original;
}

function matchedExamType(value, rules) {
  const source = text(value);
  return rules.find(([needle]) => source.includes(needle))?.[1] || "";
}

function removeCustomerPrefix(projectName, customerName) {
  const project = text(projectName);
  const customer = text(customerName);
  return customer && project.startsWith(customer) ? project.slice(customer.length).trim() : project;
}

function parseLocalDate(value) {
  const match = text(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year)
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month };
}
