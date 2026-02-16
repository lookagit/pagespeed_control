export async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "lead-pipeline/1.0" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
}
