const examTypeRules = [
  ["社会招聘考试", "社招"],
];

export function defaultOperationBatchName({ examName, examStart } = {}) {
  const date = parseLocalDate(examStart);
  const sourceName = text(examName);
  if (!date || !sourceName) return "";
  const abbreviatedName = matchedExamType(sourceName, examTypeRules) || sourceName;
  return `${abbreviatedName}_${date.year}年${date.month}月`;
}

export function resolveOperationBatchName(input = {}) {
  const generated = text(input.generatedValue);
  const previous = text(input.previousValue);
  const previousMode = text(input.previousMode);
  const submitted = text(input.submittedValue);
  if (input.restoreAuto) return { value: generated, mode: "auto", autoValue: generated };
  if (previousMode === "manual") {
    return {
      value: text(input.submittedValue || input.previousValue),
      mode: "manual",
      autoValue: generated,
    };
  }
  const edited = previousMode === "auto"
    ? Boolean(submitted && submitted !== previous && submitted !== generated)
    : Boolean(submitted && submitted !== generated);
  return edited
    ? { value: submitted, mode: "manual", autoValue: generated }
    : { value: generated, mode: "auto", autoValue: generated };
}

export function withOperationBatchNameEditorDefaults(task) {
  const config = task?.config;
  const fanweiSource = config?.fanweiSource;
  if (!fanweiSource || typeof fanweiSource !== "object") return task;

  const raw = fanweiSource.raw && typeof fanweiSource.raw === "object" ? fanweiSource.raw : {};
  const fields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const businessRequirement = config.businessRequirement && typeof config.businessRequirement === "object"
    ? config.businessRequirement
    : {};
  const requirements = Array.isArray(config.examRequirements) && config.examRequirements.length
    ? config.examRequirements
    : config.examRequirement ? [config.examRequirement] : [];
  const hasRawBatchName = Object.hasOwn(fields, "批次名称");
  const savedBatchName = text(fields["批次名称"]) || text(businessRequirement.batch_name);
  const batchName = resolveOperationBatchName({
    previousValue: savedBatchName,
    previousMode: fanweiSource.batchNameMode || businessRequirement.batch_name_mode || (savedBatchName ? "manual" : ""),
    generatedValue: defaultOperationBatchName({
      examName: requirements[0]?.fields?.["考试名称"],
      examStart: requirements[0]?.fields?.["考试日期时间"],
    }),
    submittedValue: savedBatchName,
  });
  if (
    hasRawBatchName
    && fields["批次名称"] === batchName.value
    && fanweiSource.batchNameMode === batchName.mode
    && fanweiSource.batchNameAutoValue === batchName.autoValue
  ) return task;

  return {
    ...task,
    config: {
      ...config,
      fanweiSource: {
        ...fanweiSource,
        batchNameMode: batchName.mode,
        batchNameAutoValue: batchName.autoValue,
        raw: {
          ...raw,
          fields: { ...fields, "批次名称": batchName.value },
        },
      },
    },
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function matchedExamType(value, rules) {
  const source = text(value);
  return rules.find(([needle]) => source === needle)?.[1] || "";
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
