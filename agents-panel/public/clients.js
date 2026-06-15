const clientSearch = document.getElementById("client-search");
const clientItems = Array.from(document.querySelectorAll(".client-list-item"));

clientSearch?.addEventListener("input", () => {
  const query = clientSearch.value.trim().toLowerCase();
  for (const item of clientItems) {
    item.hidden = query && !item.dataset.search.includes(query);
  }
});
