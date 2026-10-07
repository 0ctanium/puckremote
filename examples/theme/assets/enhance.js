// Client-side enhancement shipped as a static asset (Shopify-style). Runs in the browser, never on the host.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-enhance="cta"]')
  if (a) a.dataset.clicked = String(Number(a.dataset.clicked || 0) + 1)
})
document.documentElement.dataset.enhanced = 'true'
