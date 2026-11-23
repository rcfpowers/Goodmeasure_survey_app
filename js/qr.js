(function () {
  const form = document.getElementById('qr-form');
  const urlInput = document.getElementById('qr-url');
  const venueInput = document.getElementById('qr-venue');
  const error = document.getElementById('qr-error');
  const card = document.getElementById('qr-card');
  const codeBox = document.getElementById('qr-code');
  const venueName = document.getElementById('qr-venue-name');

  form.addEventListener('input', function () { error.hidden = true; });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const url = urlInput.value.trim();
    let parsed;
    try { parsed = new URL(url); } catch (e) { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || !parsed.searchParams.get('t')) {
      error.hidden = false;
      error.textContent = 'Paste the full https link from the Links sheet, including ?t=…';
      return;
    }
    if (typeof QRCode === 'undefined') {
      error.hidden = false;
      error.textContent = 'The QR code tool didn’t load. Check your connection and refresh the page.';
      return;
    }
    codeBox.replaceChildren();
    new QRCode(codeBox, { text: url, width: 320, height: 320, correctLevel: QRCode.CorrectLevel.M });
    venueName.textContent = venueInput.value.trim() || 'this venue';
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('qr-print').addEventListener('click', function () { window.print(); });
})();
