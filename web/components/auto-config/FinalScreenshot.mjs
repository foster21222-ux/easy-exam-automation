export function FinalScreenshot(documentObject = document) {
  return { name: "FinalScreenshot", element: documentObject.querySelector("#captureGrid")?.closest(".capture-panel") };
}
