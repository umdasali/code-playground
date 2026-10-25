const posts = document.getElementById("posts");
const detail = document.getElementById("detail");
let current = null;

async function loadPosts() {
  const { data } = await (await fetch("/api/posts")).json();
  posts.innerHTML = data.map((p) => `
    <div class="post" data-slug="${p.slug}">
      <h3>${p.title}</h3>
      <p>${p.excerpt}</p>
      <div class="meta">${p.tags.map((t) => `<span class="tag">${t}</span>`).join("")} ${p.comments_count} comments</div>
    </div>`).join("");
}

async function openPost(slug) {
  current = slug;
  const { data } = await (await fetch(`/api/posts/${slug}`)).json();
  document.getElementById("title").textContent = data.title;
  document.getElementById("body").textContent = data.body;
  document.getElementById("comments").innerHTML = data.comments.map((c) => `<li><strong>${c.author}</strong>: ${c.body} <small>${c.created_at}</small></li>`).join("");
  posts.hidden = true;
  detail.hidden = false;
}

posts.addEventListener("click", (e) => { const el = e.target.closest(".post"); if (el) openPost(el.dataset.slug); });
document.getElementById("back").addEventListener("click", () => { detail.hidden = true; posts.hidden = false; loadPosts(); });
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch(`/api/posts/${current}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
  });
  const json = await res.json();
  document.getElementById("error").textContent = res.status === 422 ? Object.values(json.errors).flat().join(" ") : "";
  if (res.ok) { e.target.reset(); openPost(current); }
});

loadPosts();
