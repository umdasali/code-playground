document.getElementById("btn").addEventListener("click", async () => {
  const res = await fetch("/api/hello");
  document.getElementById("out").textContent = `${res.status}\n` + JSON.stringify(await res.json(), null, 2);
});
