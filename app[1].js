
document.addEventListener("DOMContentLoaded", () => {
  const objectSearch = document.getElementById("objectSearch");
  const objects = [...document.querySelectorAll(".object")];
  const visible = document.getElementById("visibleObjects");
  const resultText = document.getElementById("resultText");
  const noResults = document.getElementById("noResults");

  if (objectSearch) {
    objectSearch.addEventListener("input", () => {
      const q = objectSearch.value.trim().toLowerCase();
      let count = 0;
      objects.forEach(card => {
        const name = card.querySelector(".objectName").textContent.toLowerCase();
        const match = name.includes(q);
        card.style.display = match ? "" : "none";
        if (match) count++;
      });
      visible.textContent = count;
      resultText.textContent = `${count} ${count === 1 ? "object" : "objects"}`;
      noResults.style.display = count ? "none" : "block";
    });
  }

  const conjSearch = document.getElementById("conjSearch");
  const conjRows = [...document.querySelectorAll("#conjTable tbody tr")];
  const conjNo = document.getElementById("conjNo");

  if (conjSearch) {
    conjSearch.addEventListener("input", () => {
      const q = conjSearch.value.trim().toLowerCase();
      let count = 0;
      conjRows.forEach(row => {
        const match = row.textContent.toLowerCase().includes(q);
        row.style.display = match ? "" : "none";
        if (match) count++;
      });
      conjNo.style.display = count ? "none" : "block";
    });
  }
});
