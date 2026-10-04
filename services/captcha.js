/* ============================================================================
   FairDrop — services/captcha.js   (server-side reCAPTCHA check)

   The browser gives us a CAPTCHA token. We send it, together with the SECRET
   key, to Google. Google says whether the token is valid.
   The secret key lives ONLY in .env on the server.
   ============================================================================ */
async function verifyCaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    return { ok: false, status: 500, reason: "Server is missing RECAPTCHA_SECRET_KEY in .env." };
  }
  if (!token) {
    return { ok: false, status: 400, reason: "Please complete the CAPTCHA." };
  }

  try {
    const body = new URLSearchParams({ secret: secret, response: token });
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
      signal: AbortSignal.timeout(6000)
    });
    const result = await response.json();

    if (!result.success) {
      return { ok: false, status: 403, reason: "CAPTCHA verification failed. Please try again." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[captcha] could not reach Google:", err.message);
    return { ok: false, status: 503, reason: "Could not verify CAPTCHA (no internet?). Try again." };
  }
}

module.exports = { verifyCaptcha };
