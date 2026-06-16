const clientSearch = document.getElementById("client-search");
const clientItems = Array.from(document.querySelectorAll(".client-list-item"));

function matchScore(item, query) {
  const searchText = item.dataset.search || "";
  if (!query || !searchText.includes(query)) return -1;

  const fields = searchText.split(" ").filter(Boolean);
  const startsWithField = fields.some((field) => field.startsWith(query));
  const startsWithText = searchText.startsWith(query);
  const index = searchText.indexOf(query);

  return (startsWithText ? 300 : 0) + (startsWithField ? 200 : 0) + Math.max(0, 100 - index) + query.length;
}

clientSearch?.addEventListener("input", () => {
  const query = clientSearch.value.trim().toLowerCase();
  let bestItem = null;
  let bestScore = -1;

  for (const item of clientItems) {
    item.classList.remove("is-search-selected");
    const score = matchScore(item, query);
    item.hidden = Boolean(query) && score < 0;
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (query && bestItem) {
    bestItem.classList.add("is-search-selected");
  }
});
