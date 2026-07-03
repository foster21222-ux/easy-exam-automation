import { AutoConfigLogs } from "../components/auto-config/AutoConfigLogs.mjs";
import { AutoConfigProgress } from "../components/auto-config/AutoConfigProgress.mjs";
import { ConfigPreview } from "../components/auto-config/ConfigPreview.mjs";
import { FinalScreenshot } from "../components/auto-config/FinalScreenshot.mjs";
import { RequirementUpload } from "../components/auto-config/RequirementUpload.mjs";

export function AutoConfigPage({ documentObject = document }) {
  const root = documentObject.querySelector("#autoWorkbench");
  const components = [
    RequirementUpload(documentObject),
    AutoConfigProgress(documentObject),
    ConfigPreview(documentObject),
    FinalScreenshot(documentObject),
    AutoConfigLogs(documentObject),
  ];
  return {
    name: "auto-config",
    roots: [
      documentObject.querySelector("#autoTopbar"),
      documentObject.querySelector("#autoConfigStack"),
      root,
    ],
    components,
    enter: async () => {},
  };
}
