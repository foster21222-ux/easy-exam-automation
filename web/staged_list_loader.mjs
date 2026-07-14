export function createStagedListLoader({
  loadInitial,
  getDetailItems,
  loadDetail,
  applyInitial,
  applyDetails,
}) {
  let generation = 0;

  return async function loadList() {
    const currentGeneration = ++generation;
    const initial = await loadInitial();
    if (currentGeneration !== generation) return;

    applyInitial(initial);
    const detailItems = getDetailItems(initial);
    void Promise.all(detailItems.map((item) => loadDetail(item))).then(
      (details) => {
        if (currentGeneration !== generation) return;
        applyDetails(details, initial);
      },
      () => {},
    );
  };
}
