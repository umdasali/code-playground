const grid = document.getElementById("grid");

async function loadCategories() {
  const cats = await (await fetch("/api/categories")).json();
  document.getElementById("category").insertAdjacentHTML("beforeend",
    cats.map((c) => `<option>${c.name}</option>`).join(""));
}

async function loadProducts() {
  const category = document.getElementById("category").value;
  const sort = document.getElementById("sort").value;
  const products = await (await fetch(`/api/products?category=${encodeURIComponent(category)}&sort=${sort}`)).json();
  grid.innerHTML = products.map((p) => `
    <div class="card"><b>${p.name}</b><small>${p.category.name}</small>
    <div class="price">$${p.price}</div><small>${p.stock} in stock</small></div>`).join("");
}

async function loadRevenue() {
  const rows = await (await fetch("/api/reports/revenue-by-category")).json();
  document.getElementById("revenue").innerHTML =
    "<tr><th>Category</th><th>Revenue</th></tr>" + rows.map((r) => `<tr><td>${r.category}</td><td>$${r.revenue}</td></tr>`).join("");
}

document.getElementById("category").addEventListener("change", loadProducts);
document.getElementById("sort").addEventListener("change", loadProducts);
loadCategories().then(loadProducts);
loadRevenue();
