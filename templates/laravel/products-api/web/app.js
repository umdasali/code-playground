// The Laravel API from the Laravel tab answers fetch("/api/...") calls made on this page.
let page = 1;
const rows = document.getElementById("rows");

async function load() {
  const q = document.querySelector("[name=q]").value;
  const inStock = document.querySelector("[name=in_stock]").checked ? 1 : 0;
  const res = await fetch(`/api/products?per_page=5&page=${page}&search=${encodeURIComponent(q)}&in_stock=${inStock}`);
  const json = await res.json();
  if (!res.ok) { console.error(json.message); return; }
  document.getElementById("count").textContent = `(${json.meta.total})`;
  document.getElementById("page").textContent = `page ${json.meta.current_page} of ${json.meta.last_page}`;
  document.getElementById("prev").disabled = page <= 1;
  document.getElementById("next").disabled = page >= json.meta.last_page;
  rows.innerHTML = json.data.map((p) => `
    <tr><td>${p.id}</td><td>${p.name}</td><td>${p.sku}</td><td>${p.price}</td><td>${p.stock}</td>
    <td><button data-id="${p.id}">Delete</button></td></tr>`).join("");
}

rows.addEventListener("click", async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  await fetch(`/api/products/${id}`, { method: "DELETE" });
  load();
});

document.getElementById("search").addEventListener("input", () => { page = 1; load(); });
document.getElementById("prev").addEventListener("click", () => { page--; load(); });
document.getElementById("next").addEventListener("click", () => { page++; load(); });

document.getElementById("create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const res = await fetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  const list = document.getElementById("errors");
  list.innerHTML = "";
  if (res.status === 422) {
    // Laravel validation errors: { message, errors: { field: [messages] } }
    Object.values(json.errors).flat().forEach((m) => list.insertAdjacentHTML("beforeend", `<li>${m}</li>`));
    return;
  }
  e.target.reset();
  load();
});

load();
