const invoiceButton = document.querySelector("[data-invoice-url]");
const invoiceModal = document.getElementById("invoice-modal");
const invoiceFrame = document.getElementById("invoice-frame");
const invoiceDownload = document.getElementById("invoice-download");
const invoiceClose = document.querySelector("[data-invoice-close]");

invoiceButton?.addEventListener("click", () => {
  const url = invoiceButton.dataset.invoiceUrl;
  invoiceFrame.src = url;
  invoiceDownload.href = url;
  invoiceModal.classList.add("is-visible");
  invoiceModal.setAttribute("aria-hidden", "false");
});

invoiceClose?.addEventListener("click", () => {
  invoiceModal.classList.remove("is-visible");
  invoiceModal.setAttribute("aria-hidden", "true");
  invoiceFrame.src = "about:blank";
});

invoiceModal?.addEventListener("click", (event) => {
  if (event.target === invoiceModal) {
    invoiceClose.click();
  }
});
