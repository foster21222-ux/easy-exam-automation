export function CandidateImportPage({ root, topbar, loadContext = async () => {} }) {
  return { name: "candidate-import", roots: [topbar, root], enter: () => loadContext() };
}
